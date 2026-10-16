# Development setup

The first implemented path is a normal browser tab → extension → native-messaging connector → unchanged SSH server. SSH runs inside the tab's WASM worker; the connector only opens TCP and forwards bytes. No project backend or remote relay is involved.

## Windows setup

Requirements: Node.js 24, Go 1.26.5, and desktop Chrome/Chromium or Edge. The installer registers a native host for the current user; it needs no administrator account and starts no background service. Keep this checkout in place while using its registered binary.

From the repository in PowerShell:

```powershell
npm ci
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-connector.ps1 -Browser Chrome
npm run preview
```

Use `-Browser Edge` or `-Browser Chromium` for those browsers. In `chrome://extensions` or `edge://extensions`, turn on Developer mode, choose **Load unpacked**, and select the absolute `dist/extension` directory. The development extension ID is `knpoojnkejjdmoanfjjhmhfbgjhppepi`; its public manifest key is only a stable development identity, not a secret signing key.

Open `http://127.0.0.1:4173`. Enter host, port, username, and authentication. The first connection request opens the extension's settings before making any TCP connection. Approve the exact web origin and host/port there, return to the terminal, and connect again. On the first SSH handshake, compare and approve the server fingerprint. A changed fingerprint blocks the connection.

The extension action also opens its settings. Pair a remotely hosted copy using its exact HTTPS origin and a destination grant, then reload that web page to load the content script. Host permission patterns cannot distinguish ports, so the broker independently enforces the complete origin including its port. Only pair application code you trust with your SSH session and credentials.

To remove this checkout's native registration:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-connector.ps1 -Browser Chrome -Uninstall
```

Then remove the unpacked extension in the browser. The script refuses to overwrite/remove a native-host registration belonging to a different checkout. Rebuild after code changes; reload the unpacked extension after extension changes. `npm run dev` serves the UI at port 5173 with hot reload after an initial build of the WASM assets.

## Local verification

```powershell
npm test
npm run build
npx playwright install chromium
powershell -NoProfile -ExecutionPolicy Bypass -File tools/install-connector.ps1 -Browser Chromium
npm run test:e2e
```

The end-to-end harness needs Docker Desktop running Linux containers and port 2222 and 4173 available. It builds a local OpenSSH container, publishes SSH only on `127.0.0.1:2222`, starts a static asset server, and launches an isolated Chromium profile with the extension. It tears down its browser, container, and HTTP servers afterward. Profiles and evidence stay under ignored `.bigssh/`; they contain synthetic fixture accounts, never real server credentials.

The harness forces `BIGSSH_TEST_LOOPBACK_ONLY=1` on the browser/native-host process tree. In that mode the connector refuses non-loopback destinations without resolving their DNS names. Do not remove this guard or replace the fixture with a live provider. The `bigssh` / `bigssh-test-password` account and password-free `onboarding` account exist only inside the disposable loopback container. Never use its test sshd configuration on a publicly reachable host.

Evidence is written to `.bigssh/evidence/e2e.json`, `welcome.png`, `connected.png`, and `mobile-layout.png`. Failed runs also capture `failure.png` and `failure.txt` using synthetic fixture data. Node policy tests and Go connector tests run in CI on Windows and Linux. Native-messaging browser tests currently run locally on Windows; CI does not yet claim that coverage.

## Measured coverage and limits

On Windows with Chromium 156.0.8078.4 and OpenSSH 10.2, the local harness verifies:

- Missing-extension errors, exact-origin and destination gating before TCP opens.
- Rejected first-use and changed SSH host keys.
- Password and imported Ed25519 private-key login with the browser WASM engine; credential-free onboarding when the fixture explicitly permits it.
- Real terminal commands, Unicode paste/output, a one MiB output flood, Ctrl-C, PTY resize, and disconnect.
- The server's observed source IP against a native TCP baseline on the same machine. Docker's NAT address is expected inside the fixture; this does not prove equality with browser HTTPS egress on every VPN or proxy.
- Desktop and narrow-screen layout without horizontal page overflow. A narrow viewport is not evidence of mobile connector support.

The Go core also implements encrypted key parsing and keyboard-interactive prompts, but those authentication paths need fixture coverage. Key generation is local to the worker. This milestone does not establish compatibility with all SSH algorithms, servers, certificates, hardware keys, agents, full-screen applications, forwarding, or SFTP. Linux/macOS native-host installers, Firefox and Safari builds, mobile integration, release signing, and store distribution remain open. Compilation on another OS alone is not native-host integration testing.

There is no optional relay or IWA adapter yet. The helper-free ordinary-tab objective remains a separate browser-platform research problem.

## Startup configuration

Edit `apps/web/workspace.js`, then rebuild. It currently supports a default host/port/user, terminal appearance, optional connect-on-open, and one command after authentication and PTY readiness. Defaults never auto-connect. Railway/dev.new auto-connect is blocked. Previously saved connection fields take precedence over build defaults; clear this app origin's `bigssh.profile` local-storage item to use new defaults.

This module is trusted application source and can run code at import time. Do not load untrusted modules into it. The capability-limited JavaScript recipe VM, lifecycle-hook kit, profile import/export, and safe retry controls described in the plan are not implemented yet. No command is automatically replayed after a disconnect.

## Build outputs

- `dist/web`: static browser assets, `ssh.wasm`, worker, and matching Go `wasm_exec.js`.
- `dist/extension`: unpacked development extension.
- `dist/connector`: native connector for the build host's OS/architecture.
- `dist/licenses`: runtime dependency licenses; keep these with distributions.

Go dependencies and compiler cache are stored under ignored `.bigssh/`. Exact npm dependencies are pinned by `package-lock.json`; Go dependencies by `go.mod` and `go.sum`. Build sources are `cmd/sshwasm`, `cmd/connector`, and `internal/connector`. No generated binaries or private fixture keys belong in Git.

## Railway acceptance budget

**0 of 1 live attempts used.** All checks above use the local fixture. The single Railway/dev.new test is reserved for a later deliberate acceptance run under [TESTING.md](TESTING.md), with no automatic retry.
