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
fn user_question_sdk_event_and_response_round_trip() {
    use rayucode_sdk::{QUESTION_CAPABILITY, Question, QuestionOption, QuestionResponse};

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
        assert!(matches!(frame.request, ApiRequest::Ping));
        write_frame(&mut writer, &ServerFrame::reply(frame.id, ApiEvent::Pong)).unwrap();
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
        let response: ClientFrame = read_frame(&mut reader).unwrap();
        assert!(matches!(response.request, ApiRequest::QuestionResponse {
            session_id, request_id, response: QuestionResponse::Declined,
        } if session_id == "s1" && request_id == "q1"));
        write_frame(&mut writer, &ServerFrame::reply(response.id, ApiEvent::Ok)).unwrap();
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
    let events = client.events(Some("s1"));
    client.ping().unwrap();
    let Some(ApiEvent::QuestionRequest {
        session_id,
        request_id,
        questions,
        ..
    }) = events.next_timeout(Duration::from_secs(5))
    else {
        panic!("expected question event")
    };
    assert_eq!(questions[0].header, "Choice");
    client
        .respond_to_question(&session_id, &request_id, QuestionResponse::Declined)
        .unwrap();
    server.join().unwrap();
}
