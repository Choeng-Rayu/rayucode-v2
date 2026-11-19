//! Native Nari streaming transcription.
//!
//! Capability checks never open a microphone. Call `MicrophoneRecording::start` only
//! after an explicit user action. Capture is opt-in via the `voice-capture` feature.
//! `NariRecording` combines confirmed network setup and native capture for desktop
//! clients. `NariSession` and `nari_pcm_channel` accept bounded mono 16 kHz PCM16
//! from any source without the capture feature. Nari requires a caller-supplied
//! provider key.
//!
//! Disable default features for a transport-only client with caller-owned PCM.
//! The default `desktop-config` feature adds desktop settings, hotkeys, and
//! recorder processes. `voice-capture` also enables `desktop-config`.
use std::{fmt, time::Duration};

#[cfg(feature = "desktop-config")]
pub mod dictation;
#[cfg(feature = "desktop-config")]
pub mod global;
mod nari;
pub mod timing;
pub use nari::{
    NARI_PCM_CHUNK_SAMPLES, NARI_USD_PER_AUDIO_HOUR, NariEvent, NariSession, correct_transcript,
    estimated_transcription_usd, nari_api_key, nari_pcm_channel, recognition_prompt,
};
#[cfg(feature = "desktop-config")]
mod command_capture;
#[cfg(any(feature = "voice-capture", test))]
mod resample;
#[cfg(feature = "desktop-config")]
mod streaming_capture;
#[cfg(feature = "desktop-config")]
pub use command_capture::{RecorderCommand, detect_recorders};
#[cfg(feature = "desktop-config")]
pub use streaming_capture::{NariRecording, PcmRecording};

/// Native (cpal) microphone capture is compiled in. Without it, voice input
/// records through an external recorder process.
pub const NATIVE_CAPTURE: bool = cfg!(feature = "voice-capture");
pub const MAX_AUDIO_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_RECORDING_DURATION: Duration = Duration::from_secs(5 * 60);
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

/// Deliberately retains no URLs, credentials, provider errors, or response bodies.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceError {
    NariNotConfigured,
    NariCreditsExhausted,
    NariRejected,
    InvalidAudio,
    Timeout,
    Network,
    Http(u16),
    InvalidResponse,
    ResponseTooLarge,
    MicrophoneUnavailable,
    CaptureFailed,
    Cancelled,
}
impl fmt::Display for VoiceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NariNotConfigured => {
                f.write_str("Configure a valid Nari API key to use voice transcription")
            }
            Self::NariCreditsExhausted => {
                f.write_str("Nari credits are exhausted. Add credits before retrying")
            }
            Self::NariRejected => f.write_str(
                "Nari rejected the voice session. Check your key, credits, and settings",
            ),
            Self::InvalidAudio => {
                f.write_str("Audio must be a nonempty mono PCM16 WAV, at most 5 minutes and 10 MiB")
            }
            Self::Timeout => f.write_str("Voice transcription request timed out"),
            Self::Network => f.write_str("Unable to reach the voice transcription service"),
            Self::Http(status) => write!(f, "Voice transcription service returned HTTP {status}"),
            Self::InvalidResponse => f.write_str("Invalid voice transcription response"),
            Self::ResponseTooLarge => {
                f.write_str("Voice transcription response exceeds the size limit")
            }
            Self::MicrophoneUnavailable => {
                f.write_str("No supported microphone is available. Check microphone permissions")
            }
            Self::CaptureFailed => f.write_str("Microphone recording failed"),
            Self::Cancelled => f.write_str("Microphone recording was cancelled"),
        }
    }
}
impl std::error::Error for VoiceError {}

/// Validate the PCM16 mono WAV format emitted by capture, including duration.
#[cfg(all(feature = "desktop-config", any(feature = "voice-capture", test)))]
fn validate_wav(bytes: &[u8]) -> Result<(), VoiceError> {
    let invalid = || VoiceError::InvalidAudio;
    if bytes.len() < 44
        || bytes.len() > MAX_AUDIO_BYTES
        || &bytes[..4] != b"RIFF"
        || &bytes[8..12] != b"WAVE"
    {
        return Err(invalid());
    }
    let u32_at =
        |pos| u32::from_le_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]);
    if u32_at(4) as usize != bytes.len() - 8 {
        return Err(invalid());
    }
    let mut pos = 12;
    let mut rate = None;
    let mut data_len = None;
    while pos + 8 <= bytes.len() {
        let len = u32_at(pos + 4) as usize;
        let start = pos + 8;
        let end = start
            .checked_add(len)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(invalid)?;
        match &bytes[pos..pos + 4] {
            b"fmt " => {
                if rate.is_some()
                    || len < 16
                    || bytes[start..start + 4] != [1, 0, 1, 0]
                    || bytes[start + 12..start + 16] != [2, 0, 16, 0]
                {
                    return Err(invalid());
                }
                let sample_rate = u32_at(start + 4);
                if !(8000..=192000).contains(&sample_rate) || u32_at(start + 8) != sample_rate * 2 {
                    return Err(invalid());
                }
                rate = Some(sample_rate);
            }
            b"data" => {
                if data_len.is_some() || len == 0 || !len.is_multiple_of(2) {
                    return Err(invalid());
                }
                data_len = Some(len);
            }
            _ => {}
        }
        pos = end + len % 2;
    }
    if pos != bytes.len()
        || data_len.ok_or_else(invalid)? as u64
            > rate.ok_or_else(invalid)? as u64 * 2 * MAX_RECORDING_DURATION.as_secs()
    {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(all(feature = "desktop-config", any(feature = "voice-capture", test)))]
fn encode_wav(samples: &[i16], sample_rate: u32) -> Result<Vec<u8>, VoiceError> {
    let len = samples
        .len()
        .checked_mul(2)
        .filter(|len| *len <= MAX_AUDIO_BYTES - 44)
        .ok_or(VoiceError::InvalidAudio)? as u32;
    let mut wav = Vec::with_capacity(44 + len as usize);
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36 + len).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes()); // PCM
    wav.extend_from_slice(&1u16.to_le_bytes()); // mono
    wav.extend_from_slice(&sample_rate.to_le_bytes());
    wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&len.to_le_bytes());
    for sample in samples {
        wav.extend_from_slice(&sample.to_le_bytes());
    }
    validate_wav(&wav)?;
    Ok(wav)
}

#[cfg(feature = "voice-capture")]
pub use capture::MicrophoneRecording;

#[cfg(feature = "voice-capture")]
mod capture {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    };

    enum Command {
        Stop,
        Cancel,
    }
    /// Owns a native microphone stream on a dedicated thread. No temporary files.
    /// Start only on explicit user interaction. Stop, cancel, drop, device failure,
    /// the byte cap, or the five-minute deadline releases the microphone.
    pub struct MicrophoneRecording {
        command: mpsc::Sender<Command>,
        cancel: Arc<AtomicBool>,
        worker: Option<std::thread::JoinHandle<Result<Vec<u8>, VoiceError>>>,
    }
    impl MicrophoneRecording {
        pub fn start() -> Result<Self, VoiceError> {
            Self::start_cancellable(Arc::new(AtomicBool::new(false)))
        }
        /// Set `cancel` to true when the initiating UI action becomes stale.
        /// This is checked after native permission/setup calls before starting input.
        /// Run this blocking constructor off the UI thread.
        pub fn start_cancellable(cancel: Arc<AtomicBool>) -> Result<Self, VoiceError> {
            if cancel.load(Ordering::SeqCst) {
                return Err(VoiceError::Cancelled);
            }
            let worker_cancel = cancel.clone();
            let (command, rx) = mpsc::channel();
            let (ready, started) = mpsc::sync_channel(1);
            let worker = std::thread::spawn(move || {
                let result = run(rx, &ready, worker_cancel);
                // If setup failed, return a redacted setup error to start().
                if let Err(error) = &result
                    && ready.try_send(Err(error.clone())).is_err()
                {
                    eprintln!(
                        "Microphone setup error could not reach the startup receiver: {error}"
                    );
                }
                result
            });
            match started.recv() {
                Ok(Ok(())) => Ok(Self {
                    command,
                    cancel,
                    worker: Some(worker),
                }),
                Ok(Err(error)) => {
                    if worker.join().is_err() {
                        return Err(VoiceError::CaptureFailed);
                    }
                    Err(error)
                }
                _ => {
                    if worker.join().is_err() {
                        return Err(VoiceError::CaptureFailed);
                    }
                    Err(VoiceError::MicrophoneUnavailable)
                }
            }
        }
        pub fn is_finished(&self) -> bool {
            self.worker
                .as_ref()
                .is_none_or(|worker| worker.is_finished())
        }
        /// Finish capture and return its WAV without cancelling the caller's
        /// shared operation token. Any cancellation already requested is preserved.
        pub fn stop(mut self) -> Result<Vec<u8>, VoiceError> {
            if self.command.send(Command::Stop).is_err() {
                eprintln!("Microphone worker already stopped before the stop request");
            }
            self.worker
                .take()
                .ok_or(VoiceError::CaptureFailed)?
                .join()
                .map_err(|_| VoiceError::CaptureFailed)?
        }
        pub fn cancel(self) {
            drop(self);
        }
    }
    impl Drop for MicrophoneRecording {
        fn drop(&mut self) {
            // stop() takes and joins the worker itself. Its consumed handle must
            // not cancel the shared recording/transcription operation afterward.
            if let Some(worker) = self.worker.take() {
                self.cancel.store(true, Ordering::SeqCst);
                if self.command.send(Command::Cancel).is_err() {
                    eprintln!("Microphone worker already stopped before cancellation");
                }
                match worker.join() {
                    Ok(Ok(_)) | Ok(Err(VoiceError::Cancelled)) => {}
                    Ok(Err(error)) => eprintln!("Microphone worker failed during cleanup: {error}"),
                    Err(_) => eprintln!("Microphone worker panicked during cleanup"),
                }
            }
        }
    }

    struct Buffer {
        samples: Vec<i16>,
        failed: bool,
        full: bool,
    }
    fn run(
        command: mpsc::Receiver<Command>,
        ready: &mpsc::SyncSender<Result<(), VoiceError>>,
        cancelled: Arc<AtomicBool>,
    ) -> Result<Vec<u8>, VoiceError> {
        if cancelled.load(Ordering::SeqCst) {
            return Err(VoiceError::Cancelled);
        }
        let device = cpal::default_host()
            .default_input_device()
            .ok_or(VoiceError::MicrophoneUnavailable)?;
        let supported = device
            .default_input_config()
            .map_err(|_| VoiceError::MicrophoneUnavailable)?;
        let format = supported.sample_format();
        let config: cpal::StreamConfig = supported.into();
        let rate = config.sample_rate.0;
        if config.channels == 0 || !(8000..=192000).contains(&rate) {
            return Err(VoiceError::MicrophoneUnavailable);
        }
        let max_samples = ((rate as u64 * MAX_RECORDING_DURATION.as_secs()) as usize)
            .min((MAX_AUDIO_BYTES - 44) / 2);
        let buffer = Arc::new(Mutex::new(Buffer {
            samples: Vec::with_capacity(max_samples),
            failed: false,
            full: false,
        }));
        macro_rules! build {
            ($ty:ty) => {
                build::<$ty>(&device, &config, buffer.clone(), max_samples)?
            };
        }
        let stream = match format {
            cpal::SampleFormat::I8 => build!(i8),
            cpal::SampleFormat::I16 => build!(i16),
            cpal::SampleFormat::I32 => build!(i32),
            cpal::SampleFormat::I64 => build!(i64),
            cpal::SampleFormat::U8 => build!(u8),
            cpal::SampleFormat::U16 => build!(u16),
            cpal::SampleFormat::U32 => build!(u32),
            cpal::SampleFormat::U64 => build!(u64),
            cpal::SampleFormat::F32 => build!(f32),
            cpal::SampleFormat::F64 => build!(f64),
            _ => return Err(VoiceError::MicrophoneUnavailable),
        };
        if cancelled.load(Ordering::SeqCst) {
            return Err(VoiceError::Cancelled);
        }
        stream
            .play()
            .map_err(|_| VoiceError::MicrophoneUnavailable)?;
        if cancelled.load(Ordering::SeqCst) {
            return Err(VoiceError::Cancelled);
        }
        let deadline = std::time::Instant::now() + MAX_RECORDING_DURATION;
        ready.send(Ok(())).map_err(|_| VoiceError::Cancelled)?;
        let mut cancel = false;
        loop {
            if cancelled.load(Ordering::SeqCst) {
                cancel = true;
                break;
            }
            match command.recv_timeout(Duration::from_millis(20)) {
                Ok(Command::Stop) => break,
                Ok(Command::Cancel) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                    cancel = true;
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let state = buffer.lock().map_err(|_| VoiceError::CaptureFailed)?;
            if state.failed || state.full || std::time::Instant::now() >= deadline {
                break;
            }
        }
        drop(stream);
        let state = buffer.lock().map_err(|_| VoiceError::CaptureFailed)?;
        if cancel || cancelled.load(Ordering::SeqCst) {
            return Err(VoiceError::Cancelled);
        }
        if state.failed {
            return Err(VoiceError::CaptureFailed);
        }
        encode_wav(&state.samples, rate)
    }

    fn append_samples<T>(state: &mut Buffer, data: &[T], channels: usize, max_samples: usize)
    where
        T: cpal::SizedSample,
        f32: cpal::FromSample<T>,
    {
        for frame in data.chunks_exact(channels) {
            if state.samples.len() == max_samples {
                break;
            }
            let mono = frame
                .iter()
                .map(|sample| <f32 as cpal::FromSample<T>>::from_sample_(*sample))
                .sum::<f32>()
                / channels as f32;
            state
                .samples
                .push((mono.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16);
        }
        state.full = state.samples.len() == max_samples;
    }

    fn build<T>(
        device: &cpal::Device,
        config: &cpal::StreamConfig,
        buffer: Arc<Mutex<Buffer>>,
        max_samples: usize,
    ) -> Result<cpal::Stream, VoiceError>
    where
        T: cpal::SizedSample,
        f32: cpal::FromSample<T>,
    {
        let errors = buffer.clone();
        let channels = config.channels as usize;
        device
            .build_input_stream(
                config,
                move |data: &[T], _| {
                    let Ok(mut state) = buffer.lock() else { return };
                    append_samples(&mut state, data, channels, max_samples);
                },
                move |_| {
                    if let Ok(mut state) = errors.lock() {
                        state.failed = true;
                    }
                },
                None,
            )
            .map_err(|_| VoiceError::MicrophoneUnavailable)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn downmix_and_cap_without_microphone_access() {
            let mut state = Buffer {
                samples: Vec::new(),
                full: false,
                failed: false,
            };
            append_samples(&mut state, &[1.0f32, -1.0, 0.5, 0.5, 1.0, 1.0], 2, 2);
            assert_eq!(state.samples, [0, 16384]);
            assert!(state.full);
            append_samples(&mut state, &[1.0f32, 1.0], 2, 2);
            assert_eq!(state.samples.len(), 2);
        }

        fn fake_recording(
            expect_stop: bool,
        ) -> (MicrophoneRecording, Arc<std::sync::atomic::AtomicBool>) {
            let completed = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let observed = completed.clone();
            let (command, rx) = mpsc::channel();
            let worker = std::thread::spawn(move || {
                let result = match (
                    rx.recv_timeout(Duration::from_secs(1)).unwrap(),
                    expect_stop,
                ) {
                    (Command::Stop, true) => Ok(vec![42]),
                    (Command::Cancel, false) => Ok(Vec::new()),
                    _ => panic!("wrong capture command"),
                };
                observed.store(true, std::sync::atomic::Ordering::SeqCst);
                result
            });
            (
                MicrophoneRecording {
                    command,
                    cancel: Arc::new(AtomicBool::new(false)),
                    worker: Some(worker),
                },
                completed,
            )
        }

        #[test]
        fn cancelled_start_never_opens_a_device() {
            assert!(matches!(
                MicrophoneRecording::start_cancellable(Arc::new(AtomicBool::new(true))),
                Err(VoiceError::Cancelled)
            ));
        }

        #[test]
        fn stop_joins_and_returns_audio() {
            let (recording, completed) = fake_recording(true);
            let cancel = recording.cancel.clone();
            assert_eq!(recording.stop().unwrap(), [42]);
            assert!(completed.load(Ordering::SeqCst));
            assert!(
                !cancel.load(Ordering::SeqCst),
                "successful stop must allow transcription"
            );
        }

        #[test]
        fn cancel_and_drop_signal_worker_and_join() {
            // Dedicated fake worker checks the command without opening a device.
            let (recording, completed) = fake_recording(false);
            let cancel = recording.cancel.clone();
            recording.cancel();
            assert!(cancel.load(Ordering::SeqCst));
            assert!(completed.load(std::sync::atomic::Ordering::SeqCst));
            let (recording, completed) = fake_recording(false);
            let cancel = recording.cancel.clone();
            drop(recording);
            assert!(cancel.load(Ordering::SeqCst));
            assert!(completed.load(std::sync::atomic::Ordering::SeqCst));
        }
    }
}

#[cfg(all(test, feature = "desktop-config"))]
mod tests {
    use super::*;

    fn wav() -> Vec<u8> {
        encode_wav(&[0, -100, 100, i16::MAX], 16000).unwrap()
    }

    #[test]
    fn wav_encoding_and_bounds() {
        let bytes = wav();
        assert_eq!(bytes.len(), 52);
        assert_eq!(&bytes[44..], &[0, 0, 156, 255, 100, 0, 255, 127]);
        assert!(validate_wav(&bytes).is_ok());
        for end in 0..bytes.len() {
            assert_eq!(validate_wav(&bytes[..end]), Err(VoiceError::InvalidAudio));
        }
        assert_eq!(encode_wav(&[], 16000), Err(VoiceError::InvalidAudio));
        assert!(encode_wav(&vec![0; 8000 * 300], 8000).is_ok());
        assert_eq!(
            encode_wav(&vec![0; 8000 * 300 + 1], 8000),
            Err(VoiceError::InvalidAudio)
        );
        assert_eq!(
            encode_wav(&vec![0; MAX_AUDIO_BYTES / 2], 48000),
            Err(VoiceError::InvalidAudio)
        );
        for offset in [4, 16, 40] {
            let mut bad = bytes.clone();
            bad[offset..offset + 4].copy_from_slice(&u32::MAX.to_le_bytes());
            assert_eq!(validate_wav(&bad), Err(VoiceError::InvalidAudio));
        }
        let mut bad = bytes;
        bad[22] = 2;
        assert_eq!(validate_wav(&bad), Err(VoiceError::InvalidAudio));
    }
}
