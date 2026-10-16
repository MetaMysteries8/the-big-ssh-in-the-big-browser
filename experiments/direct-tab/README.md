# Ordinary-tab SSH protocol lab

This is a runnable research track alongside the working extension/local-connector client. It probes what an ordinary tab actually sends to a real OpenSSH daemon. It loads no extension or native connector, configures no remote relay, and uses no external STUN or TURN service.

It has not produced helper-free browser SSH. A TCP connection, an opaque Fetch response, a banner-shaped HTTP body, or a successful WebRTC echo is not a completed SSH negotiation.

## Run it

Requirements: Node.js 24, the repository's npm dependencies, Docker running Linux containers, and a matching Playwright browser. No Go build or native-host installation is needed for this lab.

```powershell
npm ci
npx playwright install chromium
npm run lab:direct
```

For Firefox, a project-local browser cache avoids changing normal browser profiles:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.bigssh/browser-runtime'
npx playwright install firefox
npm run lab:direct -- firefox
```

The runner also accepts `webkit` when its matching Playwright runtime is installed. This is not evidence of shipping Safari behavior. `--executable PATH` can select an explicitly chosen test binary; old Playwright builds can fail automation-protocol setup and must not be counted as failed networking experiments. The recorded browser version and `customExecutable` field identify the runtime actually used.

All SSH destinations are fixed to `127.0.0.1:2224` and optionally `127.0.0.1:22`; the browser probes reject other destinations. If port 2224 is occupied, the lab stops. If port 22 is occupied or unavailable, those two controls are skipped without touching the existing service. The HTTP asset/control server binds a random loopback port. WebRTC's positive control uses two peers on the same device with no external ICE servers.

The lab builds `bigssh-protocol-lab:dev`, runs a disposable named container, and passively captures its `eth0` packets with tcpdump. The SSH process is ordinary OpenSSH; there is no WebSocket listener, TCP-to-SSH application bridge, or SSH protocol modification. Docker's local port publishing is fixture infrastructure. The observer does not forward or terminate sessions.

Each probe gets a fresh browser process. This matters: an in-progress QUIC handshake was observed continuing briefly after a Firefox browser context closed, which could otherwise contaminate the next case. Browser processes, the HTTP server, and the owned SSH container are closed on completion or failure. The built Docker image and ignored evidence remain for reuse.

Outputs are `.bigssh/direct-tab/<browser>.json` and `<browser>.pcap`. Harness failures use `-failure` filenames; compare their timestamps rather than treating older artifacts as current. Raw captures remain ignored by Git. The packet reader supports the bounded Ethernet/IPv4 TCP/UDP capture used here; it is not a general PCAP analyzer or TCP stream reassembler. It keeps UDP separate from TCP and stores bounded payload prefixes, not whole sessions.

## Hypotheses exercised

- Native SSH identification, HTTP banner-body, and direct local WebRTC echo controls.
- Socket API exposure in an ordinary secure tab and dedicated worker, followed by an actual `TCPSocket` attempt if exposed.
- Fetch and WebSocket to the default SSH port versus a browser-allowed alternate port.
- No-CORS Fetch, ordinary CORS Fetch, SSH identification in a POST body, and streaming upload bodies.
- HTTP CONNECT, an SSH-shaped custom HTTP method, and the same custom method with no-CORS.
- WebSocket handshake, SSH-shaped subprotocol header, and WSS against plain SSH.
- WebTransport against the SSH port, with TCP and UDP recorded independently.
- An ICE-TCP passive candidate pointing directly at sshd, with no other remote candidates.
- COOP/COEP-isolated tab and worker exposure, and a direct-socket attempt in that isolated tab.

These are 23 probes when both port-22 controls are available, including three positive controls. Negative results are recorded as observations rather than hardcoded expected failures. The native identification, readable HTTP body, WebRTC echo, and COOP/COEP controls must work for a run to complete. `npm test` tests the packet observer's byte order, partial records, direction, payload classification, and distinction between SSH text inside HTTP and an actual SSH first payload.

## First measured result

On Windows with Chromium 156.0.8078.4 and Firefox 157.0 against OpenSSH 10.2, all 23 cases completed in each browser. See the [result record](../../docs/results/direct-tab-lab.md) and published JSON there for source revision, environment, console errors, and observed wire prefixes.

## Next experiments worth distinguishing

1. **Preflight-cache priming control — measured:** [the follow-up lab](../preflight/README.md) got an SSH-shaped first line through after cooperating preparation, but HTTP headers broke binary packet parsing and responses remained unreadable. An active Service Worker did not intercept browser-generated preflight. [Chromium/Firefox results](../../docs/results/preflight-lab.md).
2. **SSH implementation differences — partially measured:** the follow-up compared OpenSSH and Dropbear identification, full native key exchange, exact HTTP replay, and invalid prefixes. Dropbear sends KEXINIT even before rejecting invalid identification; this is not a negotiation pass. The complete original suite against Dropbear or another SSH library remains untested.
3. **Browser release differences:** run supported installed browsers and the latest stable releases with the same controls. Preserve versioned negative results; reopen a hypothesis when a concrete API or implementation changes.
4. **Permissioned socket reference:** test an actual IWA or deliberately modified browser separately to validate the existing WASM engine over a true socket API. This would be a different runtime from the ordinary-tab experiment.

Do not weaken certificate validation, disable browser web security, or enable networking capability flags in the ordinary-tab baseline; those would invalidate its claimed environment. If a different runtime is explored, label it separately. Never substitute Railway/dev.new for the local fixture. Its project-wide live budget remains **0 of 1** used.
