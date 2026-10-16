# Testing strategy and Railway live-test limit

## User constraint

The project has a budget of **one live Railway end-to-end test total**, not one per day, browser, contributor, or development session. This includes the Railway/dev.new temporary-sandbox flow. Do not use live sandbox provisioning as a development fixture.

Project attempts used as of 2026-10-15: **0 of 1**. This records work performed by this project; it makes no claim about the user's other Railway activity.

No automatic live retries are allowed. Before any real SSH connection or provisioning attempt to the sandbox entry point, mark the attempt as reserved in the project record. Once the attempt starts, count it as consumed even if it fails, times out, or has an uncertain provisioning outcome. Inspect local diagnostics afterward instead of reconnecting. A daily quota reset does not reset the project's test budget. Another live attempt requires the user to explicitly change this limit.

The one allowed run is a final end-to-end acceptance check after the local checks below pass. This policy does not instruct anyone to create a sandbox now. Keep live Railway connections out of CI, browser matrices, health probes, automated examples, startup recipes, and reconnect loops.

## Development checks: local fixtures

Use controlled, unchanged SSH servers on the development machine or in local containers/VMs for repeated tests. Do not require a web transport listener on the fixture. Cover:

- Extension/native-host registration, origin and destination grants, protocol versions, and missing-connector behavior.
- Raw byte transport, DNS, custom ports, IPv4/IPv6, cancellation, bounded queues, and clean shutdown.
- SSH host-key verification and changed-key rejection.
- Software-key login, encrypted-key prompts, password and keyboard-interactive authentication where available.
- Terminal input/output, Ctrl-C, resize, Unicode, full-screen programs, output floods, and disconnects.
- Startup actions and explicit reconnect behavior using local endpoints only.
- Server-observed source address against a native direct-connection baseline, with browser/native routing differences tested separately.
- Browser compatibility using the same local fixtures.

A local simulated onboarding/preview flow can exercise link handling and session UI. Label it as a fixture; it does not prove live Railway interoperability.

## Final live acceptance check

Use the same locally validated extension, connector, and browser build. Disable automatic reconnect and retries for the live profile. Exercise the real SSH entry point once, verify authentication/onboarding and terminal behavior, and inspect the preview or claim flow within that single sandbox session as permitted by the user.

Record the browser/OS/build versions, transport mode, timestamps, result, and redacted diagnostics. Never commit private keys, claim tokens, or private preview URLs. If the result is inconclusive, record it as inconclusive and return to local testing; do not spend another attempt automatically.
