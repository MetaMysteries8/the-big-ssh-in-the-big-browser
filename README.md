# The Big SSH in the Big Browser

An open-source browser SSH terminal with a long-term goal: **direct SSH, zero relays, in an ordinary browser tab across browsers.**

Users should be able to choose their own compatibility transports, including relays and Isolated Web Apps (IWAs), and configure their workspace with a JavaScript setup kit.

## Status

**Early research and repository setup. There is no working SSH client yet.**

Ordinary browser tabs currently lack arbitrary TCP access to unchanged SSH servers. Running an SSH engine in WebAssembly does not remove that network restriction. Direct, relay-free operation in every browser remains an unresolved research objective. Optional transports will be labeled by their actual requirements and will not count as completion of that objective.

See the [engineering plan](docs/PLAN.md) for evidence, architecture, experiments, and milestone acceptance criteria.

## Planned components

- An ordinary-tab terminal interface with profiles, local host-key verification, and credential storage.
- An SSH engine running in the browser, initially evaluating the existing OpenSSH WebAssembly port.
- Explicit transport adapters: user-supplied relay compatibility, optional IWA direct connections, and a research track for ordinary-tab direct access.
- A JavaScript setup kit for startup connections, terminal layouts, lifecycle hooks, and manual actions.
- A tested browser/server/authentication compatibility matrix.

## Start here

- [Engineering plan and roadmap](docs/PLAN.md)
- [Transport research and experiment backlog](docs/TRANSPORT-RESEARCH.md)
- [32-option transport catalog with primary sources](docs/transport-options.json)
- [Proposed startup API](docs/startup-api.example.mjs) — design sketch, not an implemented SDK
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

There is no install or development-server command yet. The first implementation milestone is a browser networking capability lab and an OpenSSH WASM integration spike.

## Design commitments

- SSH negotiation and host-key verification belong in the browser client.
- The connection UI must disclose relay and installation requirements.
- Direct mode must fail clearly when unavailable; it must never silently select a relay.
- Compatibility claims require reproducible tests against real SSH servers.
- Configuration exports exclude credentials by default.

## License

[MIT](LICENSE). Dependencies added later retain their own licenses and notices.
