# RayuCode SDK demo app

A standalone Node application that launches a private rayu agent, streams its
reply, reports tool calls, and cleans up the private instance on exit.

## Run it

Install [RayuCode](https://rayucode.com), sign in to at least one model provider, then:

```bash
npm install
npm start -- "Summarize this project"
```

The SDK inherits your existing rayu provider logins by default. The private
instance has separate sessions and state, and `client.close()` removes it when
the application exits.

Set `RAYU_BINARY=/full/path/to/rayu` when testing a particular local build.
For a production application, handle permission requests explicitly instead of
using `autoApprove: true`.
