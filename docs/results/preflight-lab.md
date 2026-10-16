# Prepared preflight cache, Service Workers, and real SSH parsers

Tested source: `3a2664417f16e442c4cd23b0494a035fbfab7da0`, clean working trees. Runs occurred October 15, 2026 in America/Denver; JSON timestamps are October 16 UTC. Windows, Node 24.14.1, Go 1.26.5, Playwright Chromium 156.0.8078.4 and Firefox 157.0. Local fixtures: OpenSSH 10.2p1 and Dropbear 2025.88. Exact image ID, observed banners, errors, wire prefixes, controls, and server logs are in [Chromium JSON](preflight-chromium.json) and [Firefox JSON](preflight-firefox.json).

Both browsers completed both daemon sequences: **40 captured cases**, including native controls, plus HTTP preparation controls. No case produced a browser-readable SSH stream. [Reproduction instructions and data path](../../experiments/preflight/README.md).

## Hypothesis and intervention

The original custom-method probe hit OPTIONS before reaching SSH. This experiment first serves a cooperating HTTP endpoint at the exact destination, primes permission for the method `SSH-2.0-BigSSH_Lab`, verifies a readable response and a cached repeat, then fully stops that service. An ordinary SSH daemon takes the same port while the browser retains its origin and cache. There is no byte-forwarding component. This is target preparation, so it does not satisfy unchanged third-party server requirements. [Fetch preflight cache](https://fetch.spec.whatwg.org/#cors-preflight-cache).

## What changed on the wire

In all four browser/daemon combinations, the prepared browser skipped OPTIONS and sent this first line:

```text
SSH-2.0-BigSSH_Lab /primed HTTP/1.1
```

The line is also a valid SSH identification with a comment. A real native Go SSH client using that exact identification completed cryptographic key exchange, observed the fixture host key, and reached user authentication with both daemons. It deliberately failed authentication with no credentials; it did not log in or open a shell. The same control with a normal identification also reached authentication. This isolates the first line from the remaining HTTP bytes. [SSH identification syntax](https://www.rfc-editor.org/rfc/rfc4253.html#section-4.2).

The browser then sent HTTP headers where SSH expects a binary packet. Replaying its complete HTTP payload natively caused OpenSSH to report packet length `1215263604`, the four ASCII bytes `Host` interpreted as a big-endian length. Dropbear reported bad packet size `1215263608`, four bytes larger. Both closed. Trying to set Host and Connection to empty strings left the real Host header present in both browsers' HTTP controls. These are forbidden application-controlled headers under Fetch. [Forbidden request headers](https://fetch.spec.whatwg.org/#forbidden-request-header), [SSH binary packet format](https://www.rfc-editor.org/rfc/rfc4253.html#section-6).

Neither browser exposed the daemon's reply: Chromium rejected the invalid HTTP response, and Firefox returned a network/CORS error. Priming removes the initial preflight exchange; it does not turn Fetch into a raw response stream. A fresh browser process still sent OPTIONS to SSH and failed.

## Can a Service Worker supply the missing permission?

The worker claimed the unprimed page and synthesized `LOCAL_SW_CONTROL` from a URL the asset server would otherwise answer with 404. This establishes that the worker was active. It then tried to answer OPTIONS locally while forwarding the SSH-shaped method.

In all four combinations, its event log contained only `SSH-2.0-BigSSH_Lab`; the packet observer captured `OPTIONS /primed HTTP/1.1` reaching sshd. The request failed. Browser-generated preflight was not delivered to this worker, so this did not remove the target-preparation requirement. The Fetch preflight algorithm performs an HTTP-network-or-cache fetch, consistent with the observation. [CORS preflight algorithm](https://fetch.spec.whatwg.org/#cors-preflight-fetch).

## A false positive avoided

Dropbear sent a banner and KEXINIT even for the invalid HTTP and framed-STUN prefix controls, then closed. Counting that first SSH packet as successful negotiation would be wrong. Its upstream session implementation explicitly sends initial KEXINIT before reading the peer identification. The real native handshake controls establish much more than a banner or a type-20 packet, while still remaining separate from browser and authenticated-session results. [Dropbear session source](https://github.com/mkj/dropbear/blob/main/src/common-session.c).

## Decision and remaining scope

Park this Fetch/custom-method family unless a concrete new mechanism addresses all three barriers: authorization without target preparation, application control over bytes after identification, and readable bidirectional SSH responses. Another method spelling or header value alone does not address the observed failures. This is evidence about these implementations and conditions, not a proof of universal impossibility.

The daemon comparison covered these parsing controls, not the entire earlier 23-probe suite against Dropbear. Timeouts bound observations; the capture reader records bounded packet prefixes rather than reassembled streams. No browser login, Safari/mobile coverage, browser vulnerability, or unmodified all-browser TCP capability is claimed. More browser releases and an explicitly privileged socket runtime remain distinct experiments in the [backlog](../../experiments/direct-tab/README.md#next-experiments-worth-distinguishing).

Railway/dev.new live attempts: **0 of 1**. All traffic targeted owned loopback fixtures; raw captures remain under ignored `.bigssh/preflight/`.
