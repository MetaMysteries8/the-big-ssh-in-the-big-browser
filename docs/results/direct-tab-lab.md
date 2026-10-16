# Ordinary-tab experiments: first wire-level results

Source tested: `43536614f62e76a57593921b27cd223602b26138`, with clean working trees at both runs. Windows; Playwright Chromium 156.0.8078.4 and Firefox 157.0; OpenSSH 10.2p1 / OpenSSL 3.5.8 in the local Alpine fixture. Exact timestamps and individual results are in [Chromium JSON](direct-tab-chromium.json) and [Firefox JSON](direct-tab-firefox.json). A later runner cleanup guard does not change the probes or these observations.

All **23 probes completed in each browser**, including the three positive controls. No probe established an application-readable raw TCP stream or a helper-free SSH session. This is a measured result for these environments, not a proof about all future browsers or every imaginable technique. Reproduce with the [lab instructions](../../experiments/direct-tab/README.md).

## The most useful findings

**Chromium ICE-TCP really reached sshd.** The packet observer saw a TCP handshake, then a client payload beginning `00 64 00 01 00 50 21 12 a4 42 …`; the server replied `SSH-2.0-OpenSSH_10.2`. The client bytes are consistent with a length-framed STUN Binding request, not an SSH identification. JavaScript's data channel remained `connecting`, ICE stayed `checking`, and no candidate pair succeeded. Firefox did not establish that TCP connection within the three-second observation window. This distinguishes TCP reachability from permission to use an arbitrary byte stream. [ICE-TCP protocol](https://www.rfc-editor.org/rfc/rfc6544.html), [STUN header](https://www.rfc-editor.org/rfc/rfc8489.html#section-5).

**Firefox's Fetch result differed from Chromium's.** A no-CORS GET or POST to the alternate SSH port resolved in Firefox as an opaque response: status 0, no readable body, and empty text. The capture still showed an HTTP request and an SSH server banner. Chromium rejected the response as invalid HTTP. A normal CORS GET did not expose the SSH bytes in either browser. The observed Firefox result does not establish why its internal parser resolved that particular request, or make the response readable. [Fetch response filtering and CORS](https://fetch.spec.whatwg.org/).

**The POST trick sent SSH text, but in the wrong place.** Both captures contained the `SSH-2.0-BigSSH_Lab` string in a POST payload, after `POST … HTTP/1.1` and HTTP headers. The first client payload did not start with SSH. The browser did not expose an SSH stream. This is why searching a capture for the word SSH alone would be a false positive. [SSH identification exchange](https://www.rfc-editor.org/rfc/rfc4253.html#section-4.2).

**An SSH-shaped HTTP method hit preflight first.** Using `SSH-2.0-BigSSH_Lab` as the method produced an `OPTIONS` request to sshd, with the requested method in an HTTP header. No-CORS rejected that method before sending TCP data. CONNECT was also rejected before TCP. [Fetch methods](https://fetch.spec.whatwg.org/#methods).

**Port choice changed reachability, not the peer protocol.** Fetch/WebSocket on port 22 sent no application data; Chromium reported `ERR_UNSAFE_PORT`. The alternate port allowed HTTP/WebSocket requests to reach the real daemon, but WebSocket still began with `GET` and an Upgrade request. Declaring an SSH-shaped WebSocket subprotocol changed a header, not that first line. WSS sent TLS handshake bytes to a plain SSH peer. [Port blocking](https://fetch.spec.whatwg.org/#port-blocking), [WebSocket opening handshake](https://websockets.spec.whatwg.org/#opening-handshake).

**WebTransport emitted UDP/QUIC in these runs.** Both browsers sent UDP packets to the published SSH port and timed out; there were no TCP payloads for that probe. The daemon has no QUIC peer. This result does not imply WebTransport can never support HTTP/2: the current specification also describes that transport, which still requires a cooperating WebTransport endpoint. [WebTransport specification](https://www.w3.org/TR/webtransport/).

**COOP/COEP did not grant socket APIs.** Both isolated pages and workers reported `crossOriginIsolated: true`, while `TCPSocket` and `UDPSocket` remained undefined. The ordinary tab and worker likewise lacked them. Direct Sockets' `IsolatedContext` requirement is distinct from merely enabling cross-origin isolation. [Direct Sockets interface requirements](https://wicg.github.io/direct-sockets/).

## Controls and interpretation

The native control exchanged real SSH identifications, and the observer captured both directions. The HTTP control returned a readable banner-shaped body through a cooperating HTTP endpoint. Two local WebRTC peers exchanged bytes using host/host UDP candidates with no STUN/TURN service. Those controls validate parts of the apparatus; the latter two are not SSH servers or SSH successes.

The lab serves static files over HTTP and passively observes the daemon's container interface. It does not forward browser traffic into sshd, run an extension, or load the native connector. SSH target addresses are fixed loopback fixtures. Every case uses a new browser process; this eliminated a delayed QUIC retry that survived Firefox context teardown during harness development.

Raw PCAPs remain under ignored `.bigssh/direct-tab/`; published JSON contains bounded packet prefixes and no real user credentials. Packet counts are observations, not reassembled stream lengths. Three-second timeouts bound several probes and cannot establish that no later event was possible. No full browser SSH authentication was attempted by this lab; the separate extension/local-connector prototype remains the working path.

Next: a cooperating preflight-cache warmup control, SSH implementation comparisons, and more browser releases. Those hypotheses and their limitations are in the [lab backlog](../../experiments/direct-tab/README.md#next-experiments-worth-distinguishing).

Railway/dev.new live attempts: **0 of 1**. All experiment traffic targeted the owned local fixtures.
