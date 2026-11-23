use std::path::Path;
use std::time::Duration;

use anyhow::{Result, bail, ensure};
use rayucode_base::telegram::remote::{Mode, PollFailure, Transport};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::protocol::{Request, ServerEvent};
use super::question;
use rayucode_tool_types::questions::QuestionResponse;
use crate::transport::{ReadHalf, WriteHalf};

const TURN_TIMEOUT: Duration = Duration::from_secs(1800);
const MESSAGE_LIMIT: usize = 3800;

pub(super) enum Control {
    Cancel,
    Answer(String),
    Question { request_id: String, response: QuestionResponse },
}

struct Socket {
    lines: Lines<BufReader<ReadHalf>>,
    writer: WriteHalf,
}

impl Socket {
    async fn call(&mut self, request: Request) -> Result<()> {
        let mut line = serde_json::to_vec(&request)?;
        line.push(b'\n');
        self.writer.write_all(&line).await?;
        Ok(())
    }

    async fn event(&mut self) -> Result<ServerEvent> {
        let line = self
            .lines
            .next_line()
            .await?
            .ok_or_else(|| anyhow::anyhow!("Rayu daemon disconnected"))?;
        let event = serde_json::from_str(&line)?;
        Ok(event)
    }
}

pub(super) async fn run(
    socket: &Path,
    transport: &Transport,
    chat: i64,
    generation: Uuid,
    session: String,
    content: String,
    images: Vec<(String, String)>,
    mut control: mpsc::Receiver<Control>,
    questions: mpsc::UnboundedSender<question::Event>,
) -> Result<()> {
    let stream = super::super::connect_socket(socket).await?;
    let (reader, writer) = stream.into_split();
    let mut client = Socket {
        lines: BufReader::new(reader).lines(),
        writer,
    };
    client
        .call(Request::Subscribe {
            id: 1,
            system_prompt: None,
            supports_pdf_panels: false,
            supports_user_response: false,
            supports_user_questions: true,
            supports_permissions: false,
            supports_server_failover: false,
            supports_turn_identity: false,
            supports_bash_progress: false,
            working_dir: None,
            selfdev: None,
            target_session_id: Some(session.clone()),
            client_instance_id: None,
            client_has_local_history: false,
            history_base: None,
            allow_session_takeover: false,
            crash_on_disconnect: false,
            continue_on_disconnect: false,
            terminal_env: Vec::new(),
            client_name: Some("rayu-telegram".into()),
        })
        .await?;
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match client.event().await? {
                ServerEvent::SessionId { session_id } if session_id == session => return Ok(()),
                ServerEvent::Error { id: 1, .. } => {
                    bail!("Rayu could not attach to the selected session")
                }
                _ => {}
            }
        }
    })
    .await??;

    let mut output = Output {
        message: None,
        text: String::new(),
        changed: false,
    };
    let mut next_id = 3;
    let mut prompt = None;
    let mut question_reply = None;
    let mut accepted = false;
    let mut cancel_requested = false;
    let mut timer = tokio::time::interval(Duration::from_millis(1400));
    timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let deadline = tokio::time::sleep(TURN_TIMEOUT);
    tokio::pin!(deadline);
    client
        .call(Request::Message {
            id: 2,
            content,
            images,
            system_reminder: Some(crate::telegram_remote::ticket(&session, generation)),
            active_skill: None,
            no_reply: false,
        })
        .await?;
    loop {
        tokio::select! {
            _ = &mut deadline => {
                if accepted { let _ = client.call(Request::Cancel { id: next_id }).await; }
                bail!("Telegram turn timed out");
            }
            action = control.recv() => {
                match action {
                    Some(Control::Cancel) if accepted => client.call(Request::Cancel { id: next_id }).await?,
                    Some(Control::Cancel) => cancel_requested = true,
                    Some(Control::Answer(input)) => {
                        if let Some(request_id) = prompt.take() {
                            client.call(Request::StdinResponse { id: next_id, request_id, input }).await?;
                        } else {
                            transport.send(chat, "No Rayu question is waiting for an answer.", None).await?;
                        }
                    }
                    Some(Control::Question { request_id, response }) => {
                        client.call(Request::QuestionResponse {
                            id: next_id, session_id: session.clone(), request_id: request_id.clone(), response,
                        }).await?;
                        question_reply = Some((next_id, request_id));
                    }
                    None => bail!("Telegram disconnected"),
                }
                next_id += 1;
            }
            _ = timer.tick() => {
                if let Err(error) = output.flush(transport, chat).await {
                    crate::logging::warn(&format!("Telegram stream update delayed: {error}"));
                }
            }
            event = client.event() => {
                match event? {
                    ServerEvent::RuntimeCommandResult { id: 2, command, .. } if command == "telegram_turn_accepted" => {
                        accepted = true;
                        if cancel_requested {
                            client.call(Request::Cancel { id: next_id }).await?;
                            next_id += 1;
                        }
                    }
                    ServerEvent::Error { id: 2, message, .. } => {
                        if message == "The selected session is busy" {
                            transport.send(chat, &message, None).await?;
                            return Ok(());
                        }
                        output.flush(transport, chat).await?;
                        bail!("Rayu could not complete the turn. Check the local session for details.");
                    }
                    _ if !accepted => {},
                    ServerEvent::TextDelta { text } => {
                        output.text.push_str(&text);
                        output.changed = true;
                        if output.text.encode_utf16().count() >= MESSAGE_LIMIT {
                            if let Err(error) = output.flush(transport, chat).await {
                                crate::logging::warn(&format!("Telegram stream update delayed: {error}"));
                            }
                        }
                    }
                    ServerEvent::TurnStopped { reason: crate::protocol::TurnStopReason::Interrupted, .. } => {
                        output.flush(transport, chat).await?;
                        transport.send(chat, "Turn interrupted.", None).await?;
                        return Ok(());
                    }
                    ServerEvent::Done { id: 2 } => {
                        output.flush(transport, chat).await?;
                        if output.message.is_none() {
                            transport.send(chat, "Turn finished.", None).await?;
                        }
                        return Ok(());
                    }
                    ServerEvent::QuestionRequest { session_id, request_id, questions: items, .. }
                        if session_id == session => {
                        let _ = questions.send(question::Event::Open { request_id, questions: items });
                    }
                    ServerEvent::QuestionClosed { session_id, request_id, reason }
                        if session_id == session => {
                        let _ = questions.send(question::Event::Close { request_id, reason });
                    }
                    ServerEvent::Error { id, message, .. }
                        if question_reply.as_ref().is_some_and(|(reply, _)| *reply == id) => {
                        if let Some((_, request_id)) = question_reply.take() {
                            let _ = questions.send(question::Event::Rejected { request_id, message });
                        }
                    }
                    ServerEvent::StdinRequest { request_id, prompt: question, is_password, .. } => {
                        if is_password {
                            transport.send(chat, "A command requested a password. Run that command in a local terminal.", None).await?;
                            client.call(Request::Cancel { id: next_id }).await?;
                            next_id += 1;
                        } else {
                            let question: String = question.chars().take(1600).collect();
                            transport.send(chat, &format!("{question}\nReply with /answer followed by your answer."), None).await?;
                            prompt = Some(request_id);
                        }
                    }
                    ServerEvent::GeneratedImage { path, .. } => {
                        if let Err(error) = send_generated(transport, chat, &path).await {
                            crate::logging::warn(&format!("Telegram generated image delivery: {error}"));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

async fn send_generated(transport: &Transport, chat: i64, path: &str) -> Result<()> {
    if matches!(transport.mode, Mode::Hosted { .. }) {
        transport
            .send(
                chat,
                "Rayu generated an image. View it in the local session.",
                None,
            )
            .await?;
        return Ok(());
    }
    let root = std::env::current_dir()?
        .join(".rayu/generated-images")
        .canonicalize()?;
    let path = Path::new(path).canonicalize()?;
    ensure!(
        path.parent() == Some(&root) && path.is_file(),
        "Image is outside the generated image directory"
    );
    use tokio::io::AsyncReadExt;
    let mut bytes = Vec::new();
    let mut file = tokio::fs::File::open(&path)
        .await?
        .take(10 * 1024 * 1024 + 1);
    file.read_to_end(&mut bytes).await?;
    ensure!(
        bytes.len() <= 10 * 1024 * 1024,
        "Generated image is too large"
    );
    transport
        .upload(chat, bytes, "rayu-generated-image.png", false)
        .await
}

struct Output {
    message: Option<i64>,
    text: String,
    changed: bool,
}

impl Output {
    async fn flush(&mut self, transport: &Transport, chat: i64) -> Result<()> {
        if !self.changed {
            return Ok(());
        }
        while !self.text.is_empty() {
            let length = chunk_end(&self.text, MESSAGE_LIMIT);
            let chunk = &self.text[..length];
            if !chunk.trim().is_empty() {
                if let Some(message) = self.message {
                    if let Err(error) = transport.edit(chat, message, chunk).await {
                        if !error
                            .downcast_ref::<PollFailure>()
                            .is_some_and(|failure| failure.status == 400)
                        {
                            return Err(error);
                        }
                        self.message = Some(transport.send(chat, chunk, None).await?);
                    }
                } else {
                    self.message = Some(transport.send(chat, chunk, None).await?);
                }
            }
            if length == self.text.len() {
                break;
            }
            self.text.drain(..length);
            self.message = None;
        }
        self.changed = false;
        Ok(())
    }
}

fn chunk_end(text: &str, limit: usize) -> usize {
    let mut units = 0;
    for (at, character) in text.char_indices() {
        units += character.len_utf16();
        if units > limit {
            return at;
        }
    }
    text.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_use_utf16_units_without_splitting_emoji() {
        assert_eq!(chunk_end("a🙂b", 2), 1);
        assert_eq!(chunk_end("a🙂b", 3), 5);
    }
}
