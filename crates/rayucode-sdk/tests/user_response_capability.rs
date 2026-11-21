#![cfg(unix)]

use rayucode_harness_api::{
    API_VERSION_MAJOR, ApiEvent, ApiRequest, ClientFrame, ServerFrame, read_frame, write_frame,
};
use rayucode_sdk::{ConnectOptions, RayucodeClient, SshConnectOptions, Transport};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::time::Duration;

struct PairTransport(UnixStream);
impl Transport for PairTransport {
    fn split(
        self: Box<Self>,
    ) -> rayucode_sdk::Result<(Box<dyn BufRead + Send>, Box<dyn Write + Send>)> {
        let writer = self.0.try_clone().unwrap();
        Ok((Box::new(BufReader::new(self.0)), Box::new(writer)))
    }
}

#[test]
fn user_response_capability_is_sent_only_when_client_opts_in() {
    assert!(!ConnectOptions::default().supports_user_response);
    assert!(!SshConnectOptions::new("test-host").supports_user_response);
    for enabled in [false, true] {
        let (ours, theirs) = UnixStream::pair().unwrap();
        let server = std::thread::spawn(move || {
            let mut reader = BufReader::new(theirs.try_clone().unwrap());
            let mut writer = theirs;
            let frame: ClientFrame = read_frame(&mut reader).unwrap();
            let ApiRequest::Hello {
                supports_user_response,
                ..
            } = frame.request
            else {
                panic!("first frame must be Hello")
            };
            assert_eq!(supports_user_response, enabled);
            write_frame(
                &mut writer,
                &ServerFrame::reply(
                    frame.id,
                    ApiEvent::HelloOk {
                        version: API_VERSION_MAJOR,
                        server: "capability-test".into(),
                        capabilities: vec![],
                    },
                ),
            )
            .unwrap();
        });
        let client = RayucodeClient::connect_with(
            Box::new(PairTransport(ours)),
            ConnectOptions {
                supports_user_response: enabled,
                supports_user_questions: false,
                ensure_runtime: false,
                request_timeout: Some(Duration::from_secs(5)),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(client.server, "capability-test");
        server.join().unwrap();
    }
}

#[test]
fn user_question_waits_for_human_even_when_sdk_auto_approves() {
    use rayucode_sdk::{
        LaunchOptions, QUESTION_CAPABILITY, Question, QuestionOption, QuestionResponse, RunOptions,
    };
    use std::io::ErrorKind;
    use std::sync::mpsc;

    assert!(!LaunchOptions::default().supports_user_questions);
    assert!(!SshConnectOptions::new("test-host").supports_user_questions);
    let (ready_tx, ready_rx) = mpsc::channel();

    let (ours, theirs) = UnixStream::pair().unwrap();
    let server = std::thread::spawn(move || {
        let mut reader = BufReader::new(theirs.try_clone().unwrap());
        let mut writer = theirs;
        let frame: ClientFrame = read_frame(&mut reader).unwrap();
        assert!(matches!(
            frame.request,
            ApiRequest::Hello {
                supports_user_questions: true,
                ..
            }
        ));
        write_frame(
            &mut writer,
            &ServerFrame::reply(
                frame.id,
                ApiEvent::HelloOk {
                    version: API_VERSION_MAJOR,
                    server: "question-test".into(),
                    capabilities: vec![QUESTION_CAPABILITY.into()],
                },
            ),
        )
        .unwrap();
        let frame: ClientFrame = read_frame(&mut reader).unwrap();
        assert!(matches!(frame.request, ApiRequest::SendMessage { .. }));
        write_frame(
            &mut writer,
            &ServerFrame::event(ApiEvent::MessageAccepted {
                session_id: "s1".into(),
            }),
        )
        .unwrap();
        write_frame(
            &mut writer,
            &ServerFrame::event(ApiEvent::QuestionRequest {
                session_id: "s1".into(),
                request_id: "q1".into(),
                tool_call_id: "call".into(),
                questions: vec![Question {
                    question: "Which?".into(),
                    header: "Choice".into(),
                    multi_select: false,
                    options: vec![
                        QuestionOption {
                            label: "A".into(),
                            description: "First".into(),
                            preview: None,
                        },
                        QuestionOption {
                            label: "B".into(),
                            description: "Second".into(),
                            preview: None,
                        },
                    ],
                }],
            }),
        )
        .unwrap();
        // Give the client's auto-approval loop time to react before the
        // test supplies a human reply. The socket must stay silent.
        reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_millis(80)))
            .unwrap();
        assert!(matches!(reader.fill_buf(), Err(error)
            if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut)));
        reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        ready_tx.send(()).unwrap();
        let response: ClientFrame = read_frame(&mut reader).unwrap();
        assert!(matches!(response.request, ApiRequest::QuestionResponse {
            session_id, request_id, response: QuestionResponse::Declined,
        } if session_id == "s1" && request_id == "q1"));
        write_frame(&mut writer, &ServerFrame::reply(response.id, ApiEvent::Ok)).unwrap();
        write_frame(
            &mut writer,
            &ServerFrame::event(ApiEvent::TurnDone {
                session_id: "s1".into(),
                pending_soft_interrupts: None,
            }),
        )
        .unwrap();
    });
    let client = RayucodeClient::connect_with(
        Box::new(PairTransport(ours)),
        ConnectOptions {
            supports_user_questions: true,
            request_timeout: Some(Duration::from_secs(5)),
            ..Default::default()
        },
    )
    .unwrap();
    let (question_tx, question_rx) = mpsc::channel();
    let turn_client = client.clone();
    let turn = std::thread::spawn(move || {
        turn_client.run(
            "s1",
            "Choose",
            RunOptions {
                auto_approve: true,
                on_event: Some(Box::new(move |event| {
                    if let ApiEvent::QuestionRequest {
                        session_id,
                        request_id,
                        questions,
                        ..
                    } = event
                    {
                        question_tx
                            .send((
                                session_id.clone(),
                                request_id.clone(),
                                questions[0].header.clone(),
                            ))
                            .unwrap();
                    }
                })),
                ..Default::default()
            },
        )
    });
    let (session_id, request_id, header) =
        question_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(header, "Choice");
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    client
        .respond_to_question(&session_id, &request_id, QuestionResponse::Declined)
        .unwrap();
    turn.join().unwrap().unwrap();
    server.join().unwrap();
}
