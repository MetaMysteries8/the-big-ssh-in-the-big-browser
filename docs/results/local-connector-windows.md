# Local connector prototype: Windows/Chromium

Result: **passed**, 2026-10-15 MDT (2026-10-16T00:17:45Z). This proves the installed local-helper path, not helper-free browser TCP.

Environment: Windows, Node.js 24.14.1, Go 1.26.5, Playwright 1.64.1 / Chromium 156.0.8078.4, Docker Desktop, unchanged OpenSSH 10.2 from Alpine 3.23. The pinned Alpine image and sshd configuration are in `tests/fixtures/openssh/Dockerfile`. No server-side browser protocol bridge is present.

Reproduce with [DEVELOPMENT.md](../DEVELOPMENT.md): `npm ci`, `npm run build`, install the Chromium native host, then `npm run test:e2e` with Docker running. The harness refuses remote destinations using the native host's loopback-only test mode. Its connection path is browser WASM SSH → extension → native stdio host → TCP `127.0.0.1:2222` → container sshd. The HTTP server only serves static assets.

The [machine-readable result](windows-chromium.json) records 13 passing checks: extension absence, destination denial before TCP, first-use host-key rejection, password login, terminal output/source address, PTY resize, Unicode/one MiB flow, Ctrl-C, disconnect, Ed25519 login, credential-free onboarding, changed-host-key blocking, and unpaired-origin denial. The source-address check compares the target's observed peer with a native TCP baseline; Docker's bridge NAT is expected here. This is not a general browser HTTPS/native egress equivalence claim.

Native Go tests separately cover framed JSON validation, binary integrity/partial writes, target isolation, receive-credit limits and overflow, dial cancellation, protocol rejection, and socket closure on native-messaging EOF. Node tests enforce origin/frame/destination grants and inert startup defaults. `npm audit` reported zero known npm vulnerabilities at this run; this is not a security audit of the application or its Go dependencies.

Unverified: other browser/OS native integrations, remote routing differences, IPv6/DNS interoperability, encrypted-key and keyboard-interactive flows, other SSH servers/authentication mechanisms, full-screen applications, long sessions, and the live Railway flow. The isolated JavaScript recipe VM, relay/IWA adapters, and release packaging are not part of this prototype.

Railway/dev.new attempts used: **0 of 1**. Local fixture retries do not spend that live budget.
