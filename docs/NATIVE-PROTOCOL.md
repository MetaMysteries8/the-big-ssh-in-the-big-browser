# Local connector protocol v1

The extension's native host is `io.bigssh.connector`. Chrome starts it on demand with stdio pipes. It exposes no listening service, does not invoke programs, and does not implement SSH. The browser WASM worker owns SSH, credentials, and host-key verification. Windows registration is per user and allows only the stable development extension ID.

Every native message is a four-byte unsigned little-endian JSON byte length followed by that many UTF-8 bytes. Frames must contain one JSON object and be 1–65,536 bytes. The host rejects unknown JSON fields, invalid/truncated frames, and trailing JSON. Stdout is exclusively this protocol; errors returned to the process supervisor are generic and contain no payload or credentials.

The extension first sends `{ "type": "hello", "protocol": 1 }`. The host returns `ready` with `protocol`, `version`, `window: 262144`, and `chunkSize: 32768`. An unsupported protocol exits without dialing.

The page bridge uses an opaque random channel for routing, and the extension uses the browser-supplied sender URL, tab, and frame ID for authorization. The channel is not an authentication secret against scripts in the authorized origin. Only the top frame of an exactly paired HTTP(S) origin may use the broker. A host/port must have a corresponding extension-owned grant before `open` reaches the native process. Remote app origins require HTTPS and explicit browser host permission. Removing a grant blocks future opens; disconnect active sessions explicitly.

Operations after the handshake:

- `open`: `id`, `host`, `port`. One connection attempt per process. The host validates the target, then makes a cancellable TCP dial with a ten-second timeout. `opened` returns the request `id`, `localAddress`, and `remoteAddress`. DNS and routing are the native OS's. A profile's textual hostname grant does not pin DNS results; SSH host-key verification supplies server identity.
- `credit`: positive `bytes` up to 262,144. The host never reads more than its available credit or 32,768 bytes per socket read. Outstanding credit cannot exceed 262,144; overflow terminates the process. Data replies contain `type: data` and base64 `data`, with arbitrary chunk boundaries. The page issues initial credit after opening and replenishes it only as the WASM worker consumes bytes.
- `write`: `id` and strict base64 `data` encoding 1–32,768 bytes. Only one TCP write may be pending per process. `written` echoes `id` and the byte count after the complete TCP write. Socket writes have a fifteen-second deadline. The browser serializes chunks and waits for each acknowledgment.
- `close`: optional `id`. Cancels a pending dial, closes TCP, replies `closed`, and ends the process. Closing the page's runtime port also disconnects its native host; stdin EOF closes TCP. There is no reconnect.

`error` includes `id` when associated with a request and a human-readable `message`. TCP read termination produces `eof`; queued bytes are consumed before the browser transport returns EOF. Transport loss or framing failure ends the session rather than choosing another route. A two-minute browser SSH handshake deadline closes its transport; users can cancel trust/authentication prompts through Disconnect.

The native receive window bounds that layer's queued bytes, not all memory in the browser or SSH library. The SSH engine and xterm output callbacks provide additional flow control; the one MiB output fixture exercises that full path. Exact message limits and states are enforced in `internal/connector`, `apps/extension/background.js`, and `apps/web/transport.js`.

`BIGSSH_TEST_LOOPBACK_ONLY=1` is a harness guard: only literal loopback IPs or `localhost` may be opened. `localhost` is dialed as `127.0.0.1`; other hostnames are rejected before DNS resolution. It is always enabled in automated browser tests. Production use leaves it unset so approved real SSH destinations can be reached.
