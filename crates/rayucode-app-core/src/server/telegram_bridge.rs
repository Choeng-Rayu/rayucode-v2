//! Runs one interactive Telegram poller for the profile's shared daemon.

mod question;
mod turn;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static BRIDGE_TASK_SPAWNED: AtomicBool = AtomicBool::new(false);
static BRIDGE_POLLING_ACTIVE: AtomicBool = AtomicBool::new(false);

use anyhow::{Result, ensure};
use rayucode_base::telegram::remote::{Callback, Delivery, Message, Mode, PollFailure, Transport};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::task::JoinSet;

use super::SessionAgents;
use crate::safety::telegram as permissions;
use crate::telegram_remote::{self, Cursor, Link};
use turn::Control;

const HELP: &str = "/sessions — choose a session\n/status — show the selected session\n/model — choose a model\n/provider — inspect providers\n/connect — set up a provider on the host\n/interrupt — cancel the current Telegram turn\n/stop — disconnect Telegram";
const INBOUND_WAIT: Duration = Duration::from_secs(2);

pub(super) async fn run(socket: PathBuf, sessions: SessionAgents, server_name: String) {
    BRIDGE_TASK_SPAWNED.store(true, Ordering::Relaxed);
    loop {
        let outcome = async {
            let Some(link) = telegram_remote::load()? else {
                BRIDGE_POLLING_ACTIVE.store(false, Ordering::Relaxed);
                return Ok(());
            };
            let Some(_leader) = telegram_remote::claim_polling()? else {
                BRIDGE_POLLING_ACTIVE.store(false, Ordering::Relaxed);
                return Ok(());
            };
            BRIDGE_POLLING_ACTIVE.store(true, Ordering::Relaxed);
            let res =
                Bridge::run(socket.clone(), sessions.clone(), link, server_name.clone()).await;
            BRIDGE_POLLING_ACTIVE.store(false, Ordering::Relaxed);
            res
        }
        .await;
        if let Err(error) = outcome {
            crate::logging::warn(&format!("Telegram remote: {error}"));
        }
        tokio::time::sleep(INBOUND_WAIT).await;
    }
}

/// True when a Telegram polling loop is active either inside this daemon process
/// or in another daemon sharing the same `RAYU_HOME` (indicated by the advisory
/// `telegram-remote.poll.lock` file being held).
pub(super) fn is_polling_active_or_spawned() -> bool {
    if BRIDGE_POLLING_ACTIVE.load(Ordering::Relaxed) || BRIDGE_TASK_SPAWNED.load(Ordering::Relaxed) {
        return true;
    }
    matches!(telegram_remote::claim_polling(), Ok(None))
}

struct Bridge {
    socket: PathBuf,
    server_name: String,
    sessions: SessionAgents,
    link: Link,
    transport: Transport,
    outbound: JoinSet<Result<()>>,
    control: Option<mpsc::Sender<Control>>,
    question_events: Option<mpsc::UnboundedReceiver<question::Event>>,
    question: Option<question::Card>,
    shown: HashMap<String, Option<ApprovalCard>>,
    album: Vec<Message>,
    album_at: Option<tokio::time::Instant>,
    cursor: Cursor,
    session_choices: Vec<String>,
    model_choices: Vec<crate::provider::RouteSelection>,
    model_menu: String,
    uninstall: Option<Confirmation>,
}

struct ApprovalCard {
    message_id: i64,
    text: String,
}

impl Bridge {
    async fn run(
        socket: PathBuf,
        sessions: SessionAgents,
        mut link: Link,
        server_name: String,
    ) -> Result<()> {
        if link.expired() || !link.active_account() {
            tokio::time::sleep(Duration::from_secs(10)).await;
            return Ok(());
        }
        if let Mode::BotFather { bot_id, .. } = &link.mode {
            telegram_remote::validate_bot(*bot_id)?;
        }
        let transport = Transport::new(link.mode.clone())?;
        if matches!(link.mode, Mode::Hosted { .. }) {
            let remote = transport.link().await?;
            let owner = remote
                .chat_id
                .as_deref()
                .filter(|_| remote.linked)
                .and_then(|id| id.parse::<i64>().ok())
                .filter(|id| *id > 0);
            match (link.owner, owner) {
                (None, Some(owner)) => {
                    link.owner = Some(owner);
                    if !telegram_remote::replace(Some(link.generation), Some(&link))? {
                        return Ok(());
                    }
                    transport
                        .send(
                            owner,
                            "Rayu is linked. Use /sessions to choose a session.",
                            None,
                        )
                        .await?;
                }
                (None, None) => return Ok(()),
                (Some(local), Some(remote)) if local == remote => {}
                (Some(_), _) => {
                    telegram_remote::replace(Some(link.generation), None)?;
                    return Ok(());
                }
            }
        }
        let cursor = Cursor::load(&link)?;
        let mut bridge = Self {
            socket,
            server_name,
            sessions,
            link,
            transport,
            outbound: JoinSet::new(),
            control: None,
            question_events: None,
            question: None,
            shown: HashMap::new(),
            album: Vec::new(),
            album_at: None,
            cursor,
            session_choices: Vec::new(),
            model_choices: Vec::new(),
            model_menu: String::new(),
            uninstall: None,
        };
        bridge.service().await
    }

    async fn service(&mut self) -> Result<()> {
        let (updates_tx, mut updates_rx) = mpsc::channel(1);
        let transport = Transport::new(self.link.mode.clone())?;
        let generation = self.link.generation;
        let polling = poll(transport, self.cursor.clone(), updates_tx);
        tokio::pin!(polling);
        let mut clock = tokio::time::interval(Duration::from_millis(400));
        let mut snapshot = tokio::time::interval(Duration::from_secs(55));
        let mut registered = false;
        loop {
            tokio::select! {
                result = &mut polling => return result,
                _ = clock.tick() => {
                    let Some(latest) = telegram_remote::load()?.filter(|link| {
                        link.generation == generation && !link.expired() && link.active_account()
                    }) else {
                        return Ok(());
                    };
                    if self.link.selected != latest.selected {
                        self.link.selected = latest.selected;
                        self.model_choices.clear();
                    }
                    if self.album_at.is_some_and(|at| at.elapsed() >= Duration::from_millis(900)) {
                        self.finish_album().await?;
                    }
                    if self.link.owner.is_some() {
                        self.approvals().await?;
                    }
                }
                _ = snapshot.tick(), if matches!(self.link.mode, Mode::Hosted { .. }) => {
                    if let Err(error) = self.snapshot(&mut registered).await {
                        crate::logging::warn(&format!("Telegram Mini App snapshot: {error}"));
                    }
                }
                Some(Batch { linked, updates, cursor, ack }) = updates_rx.recv() => {
                    if !linked || !telegram_remote::load()?.is_some_and(|link| link.generation == generation) {
                        return Ok(());
                    }
                    self.cursor = cursor;
                    for delivery in updates {
                        if !telegram_remote::load()?.is_some_and(|link| link.generation == generation && link.active_account()) {
                            return Ok(());
                        }
                        if delivery.id <= self.cursor.after {
                            continue;
                        }
                        self.cursor.advance(delivery.id)?;
                        if let Err(error) = self.dispatch(delivery).await {
                            crate::logging::warn(&format!("Telegram update: {error}"));
                            if let Some(chat) = self.link.owner {
                                let _ = self.transport.send(chat, "Rayu could not handle that request. See the daemon log.", None).await;
                            }
                        }
                    }
                    let _ = ack.send(self.cursor.clone());
                }
                Some(event) = async {
                    match &mut self.question_events {
                        Some(events) => events.recv().await,
                        None => std::future::pending().await,
                    }
                } => {
                    if let Some(chat) = self.link.owner
                        && let Err(error) = self.render_question_event(chat, event).await
                    {
                        crate::logging::warn(&format!("Telegram question card: {error}"));
                    }
                }
                Some(result) = self.outbound.join_next(), if !self.outbound.is_empty() => {
                    self.control = None;
                    // Read any final disposition before clearing the card.
                    if let Some(mut events) = self.question_events.take() {
                        while let Ok(event) = events.try_recv() {
                            if let Some(chat) = self.link.owner {
                                let _ = self.render_question_event(chat, event).await;
                            }
                        }
                    }
                    if let Some(chat) = self.link.owner {
                        self.close_question(chat, rayucode_tool_types::questions::QuestionCloseReason::Cancelled).await;
                    }
                    if let Some(chat) = self.link.owner {
                        match result {
                            Ok(Ok(())) => {}
                            Ok(Err(error)) => {
                                crate::logging::warn(&format!("Telegram turn: {error}"));
                                let _ = self.transport.send(chat, "The Telegram turn ended early. Check the local Rayu session.", None).await;
                            }
                            Err(error) => crate::logging::warn(&format!("Telegram turn task ended: {error}")),
                        }
                    }
                }
            }
        }
    }

    async fn dispatch(&mut self, delivery: Delivery) -> Result<()> {
        let Some(update) = delivery.update else {
            return Ok(());
        };
        if let Some(message) = update.message {
            if let Some(chat) = self.link.owner {
                if message.chat.admits(message.from.as_ref(), chat) {
                    self.handle_message(message).await?;
                }
            } else if message.chat.admits(message.from.as_ref(), message.chat.id)
                && let Some(code) = message.text.as_deref().and_then(|text| {
                    text.strip_prefix("/start ")
                        .or_else(|| text.strip_prefix("/link "))
                })
                && self.link.accepts_code(code)
            {
                let chat = message.chat.id;
                self.link.owner = Some(chat);
                self.link.pending = None;
                if telegram_remote::replace(Some(self.link.generation), Some(&self.link))? {
                    self.transport
                        .send(
                            chat,
                            "Rayu is linked. Use /sessions to choose a session.",
                            None,
                        )
                        .await?;
                } else {
                    self.link.owner = None;
                }
            }
        } else if let Some(callback) = update.callback_query
            && let Some(chat) = self.link.owner
            && callback
                .message
                .as_ref()
                .is_some_and(|message| message.chat.admits(Some(&callback.from), chat))
        {
            let _ = self.transport.answer(&callback.id).await;
            self.handle_callback(chat, callback).await?;
        }
        Ok(())
    }

    async fn handle_message(&mut self, message: Message) -> Result<()> {
        let chat = message.chat.id;
        if let Some(text) = message
            .text
            .as_deref()
            .map(str::trim)
            .filter(|text| text.starts_with('/'))
        {
            let (command, arg) = text.split_once(char::is_whitespace).unwrap_or((text, ""));
            let command = command.split('@').next().unwrap_or(command);
            let arg = arg.trim();
            return match command {
                "/uninstall" => self.uninstall(chat, arg).await,
                "/start" | "/link" | "/help" => self.say(chat, HELP).await,
                "/sessions" | "/session" | "/switch" if arg.is_empty() => self.picker(chat).await,
                "/session" | "/switch" => {
                    let id = arg.parse::<usize>().ok()
                        .and_then(|n| n.checked_sub(1))
                        .and_then(|index| self.session_choices.get(index)).cloned();
                    self.select(chat, id.as_deref().unwrap_or(arg)).await
                },
                "/status" => self.status(chat).await,
                "/model" | "/models" if arg.is_empty() => self.models(chat, None).await,
                "/model" => self.model(chat, arg).await,
                "/provider" | "/providers" => self.models(chat, Some(arg)).await,
                "/connect" | "/login" => self.say(chat, "On the linked host, run rayu login and select a provider. Enter credentials in the local prompt. Do not send keys or tokens in Telegram.").await,
                "/stop" | "/disconnect" | "/disconnect-telegram" | "/disconnect_telegram" => {
                    self.outbound.abort_all();
                    self.control = None;
                    self.close_question(chat, rayucode_tool_types::questions::QuestionCloseReason::Cancelled).await;
                    self.say(chat, "Telegram is disconnecting from this Rayu host.").await?;
                    telegram_remote::disconnect(&self.link).await
                }
                "/cancel" | "/interrupt" => self.control(chat, Control::Cancel).await,
                "/answer" if !arg.is_empty() && self.question_text(chat, arg).await? => Ok(()),
                "/answer" if !arg.is_empty() => self.answer(chat, arg).await,
                "/answer" => self.say(chat, "Usage: /answer followed by your answer.").await,
                _ => self.say(chat, "Unknown command. Use /help to see Telegram controls.").await,
            };
        }
        if let Some(text) = &message.text
            && self.question_text(chat, text).await?
        {
            return Ok(());
        }
        if let Some(group) = &message.media_group_id {
            if self
                .album
                .first()
                .and_then(|message| message.media_group_id.as_ref())
                .is_some_and(|id| id != group)
            {
                self.finish_album().await?;
            }
            if self.album.len() < 10 {
                self.album.push(message);
            }
            self.album_at = Some(tokio::time::Instant::now());
            return Ok(());
        }
        self.start_turn(chat, vec![message]).await
    }

    async fn handle_callback(&mut self, chat: i64, callback: Callback) -> Result<()> {
        let Some(data) = callback.data.as_deref() else {
            return Ok(());
        };
        if data.starts_with("question:") {
            if let Some(card) = &mut self.question
                && callback.message.as_ref().is_some_and(|message| message.message_id == card.message_id)
            {
                let action = card.callback(data);
                self.question_action(chat, action).await?;
            }
            return Ok(());
        }
        if let Some(session) = data.strip_prefix("session:") {
            return self.select(chat, session).await;
        }
        if let Some(raw) = data.strip_prefix("model:") {
            if let Some((menu, index)) = raw.split_once(':')
                && menu == self.model_menu
                && let Ok(index) = index.parse::<usize>()
                && let Some(route) = self.model_choices.get(index).cloned()
            {
                return self.apply_route(chat, route).await;
            }
            return self
                .say(chat, "That model picker expired. Open /model again.")
                .await;
        }
        if let Some(raw) = data.strip_prefix("provider:") {
            if let Some((menu, index)) = raw.split_once(':')
                && menu == self.model_menu
                && let Ok(index) = index.parse::<usize>()
                && let Some(route) = self.model_choices.get(index).cloned()
            {
                return self.models(chat, Some(&route.provider_label)).await;
            }
            return self
                .say(chat, "That provider picker expired. Open /provider again.")
                .await;
        }
        if let Some((decision, id)) = data.split_once(':')
            && matches!(decision, "allow" | "deny")
            && permissions::manages(id)
        {
            let card = self.shown.get(id).and_then(Option::as_ref);
            if !callback.message.as_ref().is_some_and(|message| {
                card.is_some_and(|card| card.message_id == message.message_id)
            }) {
                return self
                    .say(chat, "This permission request has already closed.")
                    .await;
            }
            let outcome = permissions::decide(
                id,
                decision == "allow",
                "telegram",
                None,
                Some(self.link.generation),
            );
            return self
                .say(
                    chat,
                    if outcome.is_ok() {
                        "Decision recorded."
                    } else {
                        "This permission request has already closed."
                    },
                )
                .await;
        }
        Ok(())
    }

    async fn uninstall(&mut self, chat: i64, argument: &str) -> Result<()> {
        use telegram_remote::uninstall::Plan;

        if !telegram_remote::uninstall::enabled() {
            self.uninstall = None;
            return self.say(chat, "Remote uninstall is disabled. Enable it on the linked host with rayu telegram uninstall enable.").await;
        }
        let device = format!("rayu-{}", self.link.generation.simple());
        if let Some(code) = argument.strip_prefix("confirm ") {
            let Some(pending) = self.uninstall.as_mut() else {
                return self
                    .say(chat, "No uninstall confirmation is pending.")
                    .await;
            };
            if pending.chat != chat || pending.created.elapsed() > Duration::from_secs(90) {
                self.uninstall = None;
                return self.say(chat, "This uninstall confirmation expired.").await;
            }
            if pending.code != code.trim() {
                pending.attempts += 1;
                if pending.attempts >= 3 {
                    self.uninstall = None;
                }
                return self
                    .say(chat, "Incorrect uninstall confirmation code.")
                    .await;
            }
            let pending = self.uninstall.take().expect("checked pending confirmation");
            let guard = telegram_remote::file_lock("telegram-remote.uninstall.lock")?;
            guard.try_lock()?;
            if !self.outbound.is_empty()
                || self
                    .sessions
                    .read()
                    .await
                    .keys()
                    .any(|id| crate::turn_cancel_registry::has_active_turn(id))
            {
                return self.say(chat, "An active Rayu turn is still running. Start a new uninstall request when it finishes.").await;
            }
            ensure!(
                telegram_remote::load()?.is_some_and(|link| link.owner == Some(chat)
                    && link.generation == self.link.generation
                    && link.active_account()),
                "Telegram link has closed"
            );
            let Some(_idle) = crate::runtime_activity::global().try_idle() else {
                return self
                    .say(
                        chat,
                        "Rayu became busy. Request a new uninstall confirmation when it is idle.",
                    )
                    .await;
            };
            self.say(chat, "Removing the confirmed Rayu CLI installation. Session data and project files will be kept.").await?;
            pending.plan.execute()?;
            let _ = telegram_remote::uninstall::set_enabled(false);
            let _ = telegram_remote::disconnect(&self.link).await;
            let _ = telegram_remote::replace(Some(self.link.generation), None);
            super::lifecycle::drain_session_saves_before_exit().await;
            let _ = crate::registry::unregister_server(&self.server_name).await;
            super::socket::cleanup_socket_pair(&self.socket);
            super::socket::cleanup_held_daemon_lock();
            std::process::exit(0);
        }
        if argument == "cancel" {
            self.uninstall = None;
            return self.say(chat, "Uninstall cancelled.").await;
        }
        if argument != device {
            return self
                .say(
                    chat,
                    &format!("To request uninstall of this host, send /uninstall {device}"),
                )
                .await;
        }
        let plan = match Plan::current() {
            Ok(plan) => plan,
            Err(error) => return self.say(chat, &error.to_string()).await,
        };
        let code = format!("{:08X}", rand::random::<u32>());
        let message = format!(
            "Remove {} Send /uninstall confirm {code} within 90 seconds, or /uninstall cancel.",
            plan.label()
        );
        self.uninstall = Some(Confirmation {
            chat,
            code,
            created: tokio::time::Instant::now(),
            attempts: 0,
            plan,
        });
        self.say(chat, &message).await
    }

    async fn answer(&self, chat: i64, text: &str) -> Result<()> {
        let pending = permissions::pending();
        let mut questions = pending.iter().filter(|entry| {
            entry.generation == self.link.generation
                && entry.request.action == "ask_user"
                && self.shown.contains_key(&entry.request.id)
        });
        let Some(question) = questions.next() else {
            return self.control(chat, Control::Answer(text.into())).await;
        };
        let (id, answer) = if let Some((id, answer)) = text.split_once(' ')
            && permissions::manages(id)
        {
            (id, answer.trim())
        } else if questions.next().is_none() {
            (question.request.id.as_str(), text)
        } else {
            return self.say(chat, "More than one question is pending. Include the question ID from its Telegram message.").await;
        };
        if answer.is_empty()
            || !pending.iter().any(|entry| {
                entry.generation == self.link.generation
                    && entry.request.action == "ask_user"
                    && entry.request.id == id
                    && self.shown.contains_key(id)
            })
        {
            return self
                .say(chat, "That question is closed or the answer is empty.")
                .await;
        }
        let recorded = permissions::decide(
            id,
            true,
            "telegram",
            Some(answer.into()),
            Some(self.link.generation),
        );
        self.say(
            chat,
            if recorded.is_ok() {
                "Answer sent."
            } else {
                "The question has closed."
            },
        )
        .await
    }

    async fn control(&self, chat: i64, control: Control) -> Result<()> {
        match &self.control {
            Some(send) if send.try_send(control).is_ok() => Ok(()),
            _ => self.say(chat, "No Telegram turn is accepting input.").await,
        }
    }

    async fn say(&self, chat: i64, text: &str) -> Result<()> {
        self.transport.send(chat, text, None).await?;
        Ok(())
    }

    async fn eligible(&self, id: &str) -> bool {
        if !safe_session_id(id) {
            return false;
        }
        let agent = self.sessions.read().await.get(id).cloned();
        if let Some(agent) = agent
            && let Ok(agent) = agent.try_lock()
        {
            return SessionRow::new(agent.session_for_history(), true).is_some();
        }
        let id = id.to_owned();
        tokio::task::spawn_blocking(move || {
            crate::session::Session::load_startup_stub(&id)
                .ok()
                .is_some_and(|session| SessionRow::new(&session, false).is_some())
        })
        .await
        .unwrap_or(false)
    }

    async fn select(&mut self, chat: i64, session: &str) -> Result<()> {
        if !self.outbound.is_empty() {
            return self
                .say(
                    chat,
                    "Finish or interrupt the current turn before switching sessions.",
                )
                .await;
        }
        if !self.eligible(session).await {
            return self
                .say(
                    chat,
                    "Session not found. Use /sessions to choose a session on this host.",
                )
                .await;
        }
        self.link.selected = Some(session.into());
        self.model_choices.clear();
        ensure!(
            telegram_remote::replace(Some(self.link.generation), Some(&self.link))?,
            "Telegram link has closed"
        );
        self.say(
            chat,
            &format!("Selected {session}. Send a message to begin a turn."),
        )
        .await
    }

    async fn picker(&mut self, chat: i64) -> Result<()> {
        let sessions = self.session_rows().await?;
        if sessions.is_empty() {
            return self
                .say(
                    chat,
                    "No sessions found. Open a Rayu session on this host first.",
                )
                .await;
        }
        self.session_choices = sessions.iter().take(12).map(|row| row.id.clone()).collect();
        let buttons: Vec<_> = sessions.iter().take(self.session_choices.len()).enumerate().map(|(index, row)| {
            let title: String = row.title.chars().take(44).collect();
            json!([{ "text": format!("{}. {title}", index + 1), "callback_data": format!("session:{}", row.id) }])
        }).collect();
        self.transport
            .send(
                chat,
                "Choose a Rayu session on this host.",
                Some(json!(buttons)),
            )
            .await?;
        Ok(())
    }

    async fn status(&self, chat: i64) -> Result<()> {
        let selected = self.link.selected.as_deref().unwrap_or("none");
        let state = if self.outbound.is_empty() {
            "idle"
        } else {
            "running"
        };
        let target = self.selected_agent().await;
        let current_model = target
            .as_ref()
            .and_then(|agent| agent.try_lock().ok())
            .map(|agent| {
                format!(
                    "\nProvider: {}\nModel: {}",
                    agent.provider_name(),
                    agent.provider_model()
                )
            })
            .unwrap_or_default();
        self.say(chat, &format!("Rayu is linked.\nSession: {selected}\nTelegram turn: {state}{current_model}\nDevice: rayu-{device}", device = self.link.generation.simple())).await
    }

    async fn selected_agent(
        &self,
    ) -> Option<std::sync::Arc<tokio::sync::Mutex<crate::agent::Agent>>> {
        let selected = self.link.selected.as_deref()?;
        self.sessions.read().await.get(selected).cloned()
    }

    async fn models(&mut self, chat: i64, provider: Option<&str>) -> Result<()> {
        let Some(agent) = self.selected_agent().await else {
            return self
                .say(
                    chat,
                    "Select an open session with /sessions to change its model.",
                )
                .await;
        };
        let (current, mut routes) = match agent.try_lock() {
            Ok(agent) => (agent.provider_model(), agent.model_routes()),
            Err(_) => {
                return self
                    .say(chat, "The session is busy. Try again after the turn.")
                    .await;
            }
        };
        routes.retain(|route| route.available);
        let providers = provider == Some("");
        if let Some(provider) = provider.filter(|value| !value.is_empty()) {
            routes.retain(|route| route.provider.eq_ignore_ascii_case(provider));
        }
        if providers {
            let mut seen = HashSet::new();
            routes.retain(|route| seen.insert(route.provider.clone()));
        }
        self.model_choices = routes
            .iter()
            .take(16)
            .map(crate::provider::RouteSelection::from_model_route)
            .collect();
        self.model_menu = uuid::Uuid::new_v4().simple().to_string();
        if self.model_choices.is_empty() {
            return self
                .say(
                    chat,
                    "No configured routes match. Use /connect to configure a provider locally.",
                )
                .await;
        }
        let buttons: Vec<_> = self.model_choices.iter().enumerate().map(|(index, route)| {
            let label = if providers { route.provider_label.clone() } else { format!("{} · {}", route.model, route.provider_label) };
            let label: String = label.chars().take(55).collect();
            let kind = if providers { "provider" } else { "model" };
            json!([{ "text": label, "callback_data": format!("{kind}:{}:{index}", self.model_menu) }])
        }).collect();
        let text = if providers {
            "Choose a provider to see its models. Use /connect to add a provider.".into()
        } else {
            format!("Current model: {current}\nChoose a configured model.")
        };
        self.transport
            .send(chat, &text, Some(json!(buttons)))
            .await?;
        Ok(())
    }

    async fn model(&self, chat: i64, name: &str) -> Result<()> {
        let Some(agent) = self.selected_agent().await else {
            return self.say(chat, "Select an open session first.").await;
        };
        let route = match agent.try_lock() {
            Ok(agent) => agent
                .model_routes()
                .into_iter()
                .find(|route| route.available && route.model == name),
            Err(_) => {
                return self
                    .say(chat, "The session is busy. Try again after the turn.")
                    .await;
            }
        };
        if let Some(route) = route {
            self.apply_route(
                chat,
                crate::provider::RouteSelection::from_model_route(&route),
            )
            .await
        } else {
            self.say(
                chat,
                "This model is unavailable. Use /model for configured models.",
            )
            .await
        }
    }

    async fn apply_route(
        &self,
        chat: i64,
        selection: crate::provider::RouteSelection,
    ) -> Result<()> {
        let Some(agent) = self.selected_agent().await else {
            return self.say(chat, "Select an open session first.").await;
        };
        let status = match agent.try_lock() {
            Ok(mut agent) => match agent.set_route_selection(&selection) {
                Ok(()) => {
                    agent.reset_provider_session();
                    format!("Model: {}", agent.provider_model())
                }
                Err(_) => {
                    "This route is unavailable. Use /connect to configure providers locally.".into()
                }
            },
            Err(_) => "The session is busy. Try again after the turn.".into(),
        };
        self.say(chat, &status).await
    }

    async fn approvals(&mut self) -> Result<()> {
        let Some(chat) = self.link.owner else {
            return Ok(());
        };
        let pending: Vec<_> = permissions::pending()
            .into_iter()
            .filter(|entry| entry.generation == self.link.generation)
            .collect();
        let mut closed_cards = Vec::new();
        self.shown.retain(|id, card| {
            if pending.iter().any(|entry| &entry.request.id == id) {
                return true;
            }
            closed_cards.extend(card.take());
            false
        });
        for card in closed_cards {
            let text = format!("{}\n\nRequest closed.", card.text);
            if let Err(error) = self.transport.edit(chat, card.message_id, &text).await {
                crate::logging::warn(&format!("Could not close Telegram approval card: {error}"));
            }
        }
        for entry in pending {
            let request = entry.request;
            if self.shown.contains_key(&request.id) {
                continue;
            }
            let visible_input = request.description.encode_utf16().count() <= 3200;
            let (text, buttons) = if request.action == "ask_user" {
                (
                    format!(
                        "{}\n\nUse /answer {} <your answer> to reply. Keep passwords and credentials local.",
                        request.description, request.id
                    ),
                    Some(
                        json!([[{"text": "Decline to answer", "callback_data": format!("deny:{}", request.id)}]]),
                    ),
                )
            } else if visible_input {
                (
                    format!(
                        "Rayu requests permission for {}\n\n{}",
                        request.action, request.description
                    ),
                    Some(
                        json!([[{"text": "Allow once", "callback_data": format!("allow:{}", request.id)},
                    {"text": "Deny", "callback_data": format!("deny:{}", request.id)}]]),
                    ),
                )
            } else {
                (
                    format!(
                        "Rayu requests permission for {}. Review the full input locally with rayu permissions.",
                        request.action
                    ),
                    None,
                )
            };
            let has_buttons = buttons.is_some();
            let message_id = self.transport.send(chat, &text, buttons).await?;
            self.shown.insert(
                request.id,
                has_buttons.then_some(ApprovalCard { message_id, text }),
            );
        }
        Ok(())
    }

    async fn finish_album(&mut self) -> Result<()> {
        self.album_at = None;
        let messages = std::mem::take(&mut self.album);
        if let Some(chat) = self.link.owner {
            self.start_turn(chat, messages).await?;
        }
        Ok(())
    }

    async fn start_turn(&mut self, chat: i64, messages: Vec<Message>) -> Result<()> {
        if !self.outbound.is_empty() {
            return self
                .say(
                    chat,
                    "A Telegram turn is running. Use /interrupt to stop it.",
                )
                .await;
        }
        let Some(session) = self.link.selected.clone() else {
            return self.picker(chat).await;
        };
        if !self.eligible(&session).await {
            return self.picker(chat).await;
        }
        let mut content = String::new();
        let mut images = Vec::new();
        for message in messages {
            if let Some(text) = message.text.or(message.caption) {
                if !content.is_empty() {
                    content.push('\n');
                }
                content.push_str(&text);
            }
            if let Some(photo) = message.photo.last().or_else(|| {
                message.document.as_ref().filter(|doc| {
                    doc.mime_type
                        .as_deref()
                        .is_some_and(|mime| mime.starts_with("image/"))
                })
            }) {
                images.push(self.transport.image(photo).await?);
            }
        }
        if content.trim().is_empty() && images.is_empty() {
            return self
                .say(chat, "Send text or a supported image to start a turn.")
                .await;
        }
        if content.trim().is_empty() {
            content = "Please look at the attached images.".into();
        }
        let (tx, rx) = mpsc::channel(8);
        let (question_tx, question_rx) = mpsc::unbounded_channel();
        self.question_events = Some(question_rx);
        let transport = Transport::new(self.link.mode.clone())?;
        let generation = self.link.generation;
        let socket = self.socket.clone();
        self.outbound.spawn(async move {
            turn::run(
                &socket, &transport, chat, generation, session, content, images, rx, question_tx,
            )
            .await
        });
        self.control = Some(tx);
        Ok(())
    }

    async fn question_text(&mut self, chat: i64, text: &str) -> Result<bool> {
        let Some(card) = &mut self.question else { return Ok(false) };
        let action = card.text(text);
        if matches!(action, question::Action::Ignore) {
            return Ok(false);
        }
        self.question_action(chat, action).await?;
        Ok(true)
    }

    async fn question_action(&mut self, chat: i64, action: question::Action) -> Result<()> {
        let Some(card) = &mut self.question else { return Ok(()) };
        match action {
            question::Action::Ignore => {}
            question::Action::Redraw => {
                let (text, buttons) = card.render();
                self.transport.edit_with_buttons(chat, card.message_id, &text, buttons).await?;
            }
            question::Action::Submit(response) => {
                let Some(control) = &self.control else { return Ok(()) };
                control.try_send(Control::Question { request_id: card.request_id.clone(), response })?;
                card.submitting = true;
            }
        }
        Ok(())
    }

    async fn render_question_event(&mut self, chat: i64, event: question::Event) -> Result<()> {
        use question::Event;
        match event {
            Event::Open { request_id, questions } => {
                let mut card = question::Card::new(request_id, questions);
                let (text, buttons) = card.render();
                match self.transport.send(chat, &text, Some(buttons)).await {
                    Ok(message_id) => {
                        card.message_id = message_id;
                        self.question = Some(card);
                    }
                    Err(error) => {
                        // Release the waiting turn if Telegram cannot present the form.
                        if let Some(control) = &self.control {
                            let _ = control.try_send(Control::Cancel);
                        }
                        return Err(error);
                    }
                }
            }
            Event::Close { request_id, reason } => {
                if self.question.as_ref().is_some_and(|card| card.request_id == request_id) {
                    self.close_question(chat, reason).await;
                }
            }
            Event::Rejected { request_id, message } => {
                if let Some(card) = &mut self.question
                    && card.request_id == request_id
                {
                    card.submitting = false;
                    self.say(chat, &message).await?;
                }
            }
        }
        Ok(())
    }

    async fn close_question(&mut self, chat: i64, reason: rayucode_tool_types::questions::QuestionCloseReason) {
        use rayucode_tool_types::questions::QuestionCloseReason;
        if let Some(card) = self.question.take() {
            let text = match reason {
                QuestionCloseReason::Answered => format!("Answers sent\n\n{}", card.summary()),
                QuestionCloseReason::Declined => "Question declined.".into(),
                QuestionCloseReason::Cancelled => "Question closed.".into(),
            };
            if let Err(error) = self.transport.edit(chat, card.message_id, &text).await {
                crate::logging::warn(&format!("Telegram question close: {error}"));
            }
        }
    }

    async fn session_rows(&self) -> Result<Vec<SessionRow>> {
        let live: Vec<_> = self.sessions.read().await.values().cloned().collect();
        let mut live_rows = Vec::new();
        for agent in live {
            if let Ok(agent) = agent.try_lock()
                && let Some(row) = SessionRow::new(agent.session_for_history(), true)
            {
                live_rows.push(row);
            }
        }
        tokio::task::spawn_blocking(move || recent_rows(live_rows)).await?
    }

    async fn snapshot(&self, registered: &mut bool) -> Result<()> {
        let device = format!("rayu-{}", self.link.generation.simple());
        if !*registered {
            let device_name = std::env::var("HOSTNAME").unwrap_or_else(|_| "RayuCode".into());
            let device_name: String = device_name.chars().take(100).collect();
            self.transport
                .device(&device_name, &device, env!("CARGO_PKG_VERSION"))
                .await?;
            *registered = true;
        }
        let rows = self.session_rows().await?;
        let payload: Vec<_> = rows
            .into_iter()
            .map(|row| {
                json!({
                    "sessionId": row.id,
                    "title": row.title,
                    "cwd": row.cwd,
                    "status": row.status,
                    "startedAt": row.started_at,
                    "attached": row.attached,
                })
            })
            .collect();
        if let Err(error) = self.transport.snapshot(&device, payload).await {
            *registered = false;
            return Err(error);
        }
        Ok(())
    }
}

struct Confirmation {
    chat: i64,
    code: String,
    created: tokio::time::Instant,
    attempts: u8,
    plan: telegram_remote::uninstall::Plan,
}

struct SessionRow {
    id: String,
    title: String,
    cwd: String,
    attached: bool,
    status: String,
    started_at: i64,
    updated_at: i64,
}

impl SessionRow {
    fn new(session: &crate::session::Session, attached: bool) -> Option<Self> {
        if !safe_session_id(&session.id) || session.is_debug || session.parent_id.is_some() {
            return None;
        }
        Some(Self {
            id: session.id.clone(),
            title: session.display_title_or_name().chars().take(180).collect(),
            cwd: session
                .working_dir
                .as_deref()
                .unwrap_or_default()
                .chars()
                .take(500)
                .collect(),
            attached,
            status: session.status.display().chars().take(24).collect(),
            started_at: session.created_at.timestamp_millis().max(0),
            updated_at: session.updated_at.timestamp_millis(),
        })
    }
}

fn recent_rows(mut rows: Vec<SessionRow>) -> Result<Vec<SessionRow>> {
    let directory = crate::storage::rayu_dir()?.join("sessions");
    if let Ok(entries) = std::fs::read_dir(directory) {
        let mut entries: Vec<_> = entries
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if path.extension()?.to_str()? != "json" {
                    return None;
                }
                Some((entry.metadata().ok()?.modified().ok()?, path))
            })
            .collect();
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.0));
        for (_, path) in entries.into_iter().take(50) {
            if let Some(id) = path
                .file_stem()
                .and_then(|s| s.to_str())
                .filter(|id| safe_session_id(id))
                && !rows.iter().any(|row| row.id == id)
                && let Ok(session) = crate::session::Session::load_startup_stub(id)
                && let Some(row) = SessionRow::new(&session, false)
            {
                rows.push(row);
            }
        }
    }
    rows.sort_by_key(|row| std::cmp::Reverse(row.updated_at));
    rows.truncate(50);
    Ok(rows)
}

fn safe_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 56
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_-".contains(&c))
}

struct Batch {
    linked: bool,
    updates: Vec<Delivery>,
    cursor: Cursor,
    ack: tokio::sync::oneshot::Sender<Cursor>,
}

async fn poll(transport: Transport, mut cursor: Cursor, send: mpsc::Sender<Batch>) -> Result<()> {
    let mut backoff = 1;
    loop {
        cursor = cursor.for_poll(&transport.mode, chrono::Utc::now().timestamp());
        match transport.updates(cursor.after, 18).await {
            Ok((linked, mut updates)) => {
                updates.sort_by_key(|update| update.id);
                let (ack, received) = tokio::sync::oneshot::channel();
                if send
                    .send(Batch {
                        linked,
                        updates,
                        cursor,
                        ack,
                    })
                    .await
                    .is_err()
                {
                    return Ok(());
                }
                let Ok(next) = received.await else {
                    return Ok(());
                };
                cursor = next;
                backoff = 1;
            }
            Err(error) => {
                let response = error.downcast_ref::<PollFailure>();
                let wait = response
                    .and_then(|response| response.retry_after)
                    .unwrap_or_else(|| {
                        if response.is_some_and(|error| error.status == 409) {
                            60
                        } else {
                            backoff
                        }
                    });
                crate::logging::warn(&format!("Telegram polling paused: {error}"));
                tokio::time::sleep(Duration::from_secs(wait.clamp(1, 300))).await;
                backoff = (backoff * 2).min(30);
            }
        }
    }
}

pub(super) fn keeps_daemon_alive() -> bool {
    telegram_remote::load()
        .is_ok_and(|link| link.is_some_and(|link| !link.expired() && link.active_account()))
}

pub(super) fn enabled(socket: &Path) -> bool {
    super::socket::is_shared_socket(socket)
        && super::lifecycle::temporary_server_policy_from_env().is_none()
}
