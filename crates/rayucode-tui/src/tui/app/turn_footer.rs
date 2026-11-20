use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::{Duration, Instant};

use super::{App, DisplayMessage};
use crate::tui::{TurnFooterOutcome, TurnFooterSnapshot};

#[derive(Clone, Copy, Default)]
struct Usage {
    input: Option<u64>,
    output: Option<u64>,
}

impl Usage {
    fn plus(self, rhs: Self) -> Self {
        fn sum(a: Option<u64>, b: Option<u64>) -> Option<u64> {
            match (a, b) {
                (Some(a), Some(b)) => a.checked_add(b),
                (a, b) => a.or(b),
            }
        }
        Self {
            input: sum(self.input, rhs.input),
            output: sum(self.output, rhs.output),
        }
    }
}

#[derive(Default)]
pub(super) struct TurnFooterState {
    started: Option<Instant>,
    committed: Usage,
    round: Usage,
    last: Option<TurnFooterSnapshot>,
    finished_for: Option<Instant>,
    round_start_tps: (u64, Duration),
}

impl App {
    fn turn_footer_started(&self) -> Option<Instant> {
        self.visible_turn_started.or(self.processing_started)
    }

    fn sync_turn_footer_round(&mut self) {
        let started = self.turn_footer_started();
        if self.turn_footer.started != started {
            self.turn_footer.started = started;
            self.turn_footer.committed = Usage::default();
            self.turn_footer.round = Usage::default();
        }
    }

    pub(super) fn advance_turn_footer_round(&mut self) {
        self.sync_turn_footer_round();
        let usage = std::mem::take(&mut self.turn_footer.round);
        self.turn_footer.committed = self.turn_footer.committed.plus(usage);
        self.turn_footer.round_start_tps = (
            self.streaming.streaming_total_output_tokens,
            self.current_streaming_tps_elapsed(),
        );
    }

    pub(super) fn record_turn_footer_usage(&mut self, input: Option<u64>, output: Option<u64>) {
        self.sync_turn_footer_round();
        let round = &mut self.turn_footer.round;
        round.input = input.or(round.input);
        round.output = output.or(round.output);
    }

    pub(super) fn rollback_turn_footer_round(&mut self) {
        self.turn_footer.round = Usage::default();
        let (tokens, elapsed) = self.turn_footer.round_start_tps;
        self.streaming.streaming_total_output_tokens = tokens;
        self.streaming.streaming_tps_elapsed = elapsed;
        self.streaming.streaming_tps_start = None;
        self.streaming.streaming_tps_collect_output = false;
        self.snapshot_streaming_tps();
    }

    pub(super) fn resume_turn_footer_retry(&mut self) -> bool {
        let Some(started) = self.turn_footer.started else {
            return false;
        };
        self.visible_turn_started = Some(started);
        self.streaming.response_output.reset();
        self.rollback_turn_footer_round();
        true
    }

    pub(super) fn current_turn_footer(&self) -> TurnFooterSnapshot {
        let started = self.turn_footer_started();
        let mut seed = DefaultHasher::new();
        started.hash(&mut seed);
        let usage = if started == self.turn_footer.started {
            self.turn_footer.committed.plus(self.turn_footer.round)
        } else {
            Usage::default()
        };
        TurnFooterSnapshot {
            outcome: TurnFooterOutcome::Running,
            verb: seed.finish() as usize,
            elapsed: self
                .elapsed()
                .or_else(|| started.map(|start| start.elapsed())),
            output_tps: self.compute_streaming_tps(),
            input_tokens: usage.input,
            output_tokens: usage.output,
            credits: self.streaming.streaming_rayu_credits.total_credits(),
        }
    }

    pub(super) fn pinned_turn_footer(&self) -> Option<TurnFooterSnapshot> {
        if self.is_processing || self.rate_limit_reset.is_some() {
            Some(self.current_turn_footer())
        } else {
            self.turn_footer.last
        }
    }

    pub(super) fn finish_turn_footer(&mut self, outcome: TurnFooterOutcome) {
        let started = self.turn_footer_started();
        if started.is_some() && self.turn_footer.finished_for == started {
            return;
        }
        self.turn_footer.finished_for = started;
        let mut snapshot = self.current_turn_footer();
        snapshot.outcome = outcome;
        self.turn_footer.last = Some(snapshot);
        let mut fields = Vec::new();
        fields.extend(super::super::ui::turn_footer_metrics(snapshot, false));
        fields.extend(super::super::ui::input_ui::turn_cache_metrics(
            self.streaming.streaming_cache_read_tokens,
            self.streaming.streaming_cache_creation_tokens,
        ));
        if !fields.is_empty() {
            self.push_display_message(DisplayMessage::turn_metrics(fields.join(" · ")));
        }
    }

    pub(super) fn restore_turn_footer(&mut self, messages: &[DisplayMessage]) {
        self.turn_footer.last = messages
            .iter()
            .rev()
            .find_map(DisplayMessage::response_stats)
            .map(|stats| TurnFooterSnapshot::from_response_stats(&stats));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turn_footer_accumulates_rounds_and_freezes_the_reported_credit_total() {
        let mut app = super::super::tests::create_test_app();
        app.is_processing = true;
        app.visible_turn_started = Some(Instant::now() - Duration::from_secs(33));
        app.advance_turn_footer_round();
        app.record_turn_footer_usage(Some(1_000), Some(75));
        app.record_turn_footer_usage(Some(1_000), Some(100));
        app.streaming.streaming_rayu_credits.sync_turn_total(1.25);
        app.advance_turn_footer_round();
        app.record_turn_footer_usage(Some(9_000), Some(400));
        let original_verb = app.current_turn_footer().verb;
        app.visible_turn_started = None;
        assert!(app.resume_turn_footer_retry());
        assert_eq!(app.current_turn_footer().verb, original_verb);
        assert_eq!(app.current_turn_footer().input_tokens, Some(1_000));
        app.record_turn_footer_usage(Some(3_000), Some(404));
        app.streaming.streaming_rayu_credits.sync_turn_total(3.75);
        app.streaming.streaming_rayu_credits.sync_turn_total(3.75);
        let running = app.current_turn_footer();
        app.finish_turn_footer(TurnFooterOutcome::Completed);
        app.is_processing = false;
        app.streaming.streaming_rayu_credits.reset();

        let completed = app.pinned_turn_footer().unwrap();
        assert_eq!(completed.outcome, TurnFooterOutcome::Completed);
        assert_eq!(completed.verb, running.verb);
        assert_eq!(completed.input_tokens, Some(4_000));
        assert_eq!(completed.output_tokens, Some(504));
        assert_eq!(completed.credits, Some(3.75));
        assert_eq!(
            super::super::super::ui::turn_footer_metrics(completed, false).as_deref(),
            Some("33s · ↑4k ↓504 · Credits: 3.75")
        );
        assert!(app.display_messages.last().unwrap().is_turn_metrics());

        app.visible_turn_started = Some(Instant::now());
        app.is_processing = true;
        assert!(app.pinned_turn_footer().unwrap().credits.is_none());
        assert!(app.pinned_turn_footer().unwrap().input_tokens.is_none());
    }

    #[test]
    fn turn_footer_restores_saved_credits_without_fabricating_timing() {
        let mut app = super::super::tests::create_test_app();
        let message = DisplayMessage::assistant("done").with_response_stats(Some(
            rayucode_session_types::ResponseStats {
                rayu_credits: Some(3.75),
                input_tokens: Some(4_000),
                ..Default::default()
            },
        ));
        app.replace_display_messages(vec![message]);
        let snapshot = app.pinned_turn_footer().unwrap();
        assert_eq!(snapshot.credits, Some(3.75));
        assert_eq!(snapshot.input_tokens, Some(4_000));
        assert!(snapshot.elapsed.is_none());
        assert!(snapshot.output_tps.is_none());
    }
}
