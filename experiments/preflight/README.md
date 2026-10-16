# Prepared-CORS and SSH parsing lab

This follows the [ordinary-tab wire probes](../direct-tab/README.md). It asks whether a cached CORS permission lets an SSH-shaped HTTP method reach a real SSH daemon, what breaks next, and whether a Service Worker can replace the cooperating HTTP endpoint.

The measured result is **no usable browser SSH stream**. The cached method reaches both daemons as an acceptable SSH identification, but HTTP headers corrupt the following binary packet. Browser response parsing also prevents reading the SSH reply. See the [results and evidence](../../docs/results/preflight-lab.md).

## Reproduce

Requirements: Node.js 24, Go 1.26.5 on PATH, Docker with Linux containers, npm dependencies, and a matching Playwright browser. No extension or native-host installation is used.

```powershell
npm ci
npx playwright install chromium
npm run lab:preflight
```

The default runs Chromium against OpenSSH and Dropbear. Select one daemon with `npm run lab:preflight -- chromium dropbear`. Firefox uses the same cases:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.bigssh/browser-runtime'
npx playwright install firefox
npm run lab:preflight -- firefox
```

The cache environment variable also affects subsequent Chromium runs; install Chromium there too or remove that variable before using its default cache. The runner accepts `webkit` with a matching installed runtime, but no WebKit or Safari result is claimed here.

Only `127.0.0.1:2225` is an SSH destination. If that port is occupied, the lab stops without changing its owner. A random loopback HTTP port serves the experiment page. Docker builds `bigssh-preflight-lab:dev` with real OpenSSH and Dropbear; it publishes the selected daemon on loopback. Passive tcpdump observes its interface. No application component forwards browser bytes to SSH.

## Sequence and controls

1. Serve an owned HTTP endpoint at the exact destination URL. Accept a CORS preflight for `SSH-2.0-BigSSH_Lab`, then return a readable control body for that method. Repeat it and check that only one OPTIONS request occurred. Try suppressing Host/Connection headers and record what arrived.
2. Fully stop that HTTP service. Start the real SSH daemon at the same address and port. Retain the browser process, page origin, and preflight cache.
3. Capture the cached browser request, a fresh unprimed browser request, and a Service Worker attempt. The worker must first synthesize a control response unavailable from the asset server. It tries to answer OPTIONS locally and forwards the actual method.
4. Compare native identification-only probes with a real Go SSH key exchange. The native client uses both its normal identification and the browser's exact first line. It deliberately has no credentials and must reach authentication without logging in.
5. Replay the browser's complete first HTTP payload natively, then compare invalid HTTP and synthetic framed-STUN prefixes. These separate server parsing from browser response filtering. They are native controls, not browser SSH successes.

There are ten captured cases per daemon plus HTTP preparation controls. The native client is fixed to the loopback fixture and accepts its disposable host key only for this control. It does not replace production host-key verification. Merely receiving KEXINIT is insufficient: Dropbear can send it before rejecting an invalid identification.

Owned browsers, HTTP listeners, packet observer, and SSH containers stop in cleanup on success or failure. Docker image caches and ignored `.bigssh/preflight/` evidence remain. Successful results use `<browser>.json`; failures use `<browser>-failure.json`. Raw per-daemon PCAPs remain ignored. The bounded packet parser is not a general TCP stream reassembler.

This requires temporary control of the target's address and port. It cannot prepare an unchanged third-party endpoint such as railway.new. Neither a relay nor a target-side WebSocket bridge runs during the SSH phase. No browser security flags are disabled. Railway/dev.new live attempts remain **0 of 1**.
