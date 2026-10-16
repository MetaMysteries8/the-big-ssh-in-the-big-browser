# Third-party notices

Project-authored code is MIT licensed. Dependencies retain their own licenses.

- Go compiler runtime and `wasm_exec.js`: BSD-style Go license, https://go.dev/LICENSE.
- `golang.org/x/crypto` v0.58.0 and `golang.org/x/sys` v0.49.0: BSD-style licenses in their source modules.
- `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, and `@xterm/addon-web-links` 0.12.0: MIT licenses in their packages.
- Build/test tooling includes Vite and Playwright under their respective package licenses. These tools are not shipped as browser runtime libraries.

`npm run build` copies the Go, x/crypto, x/sys, and xterm runtime license texts into `dist/licenses`. Preserve that directory when distributing a complete build. The OpenSSH/Alpine fixture is a local test container, not shipped with the application.
