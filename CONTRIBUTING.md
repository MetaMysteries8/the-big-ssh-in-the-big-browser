# Contributing

This project is in its research phase. Start with [the engineering plan](docs/PLAN.md).

Useful first contributions include small browser networking experiments, analysis of the OpenSSH WASM integration, transport protocol proposals, and reproducible SSH interoperability results.

## Research reports

Include the browser version, operating system, required flags or installations, target server configuration, reproduction steps, and observed wire protocol. State whether the connection uses a relay, local helper, or modified server. Record failed experiments too.

A terminal screenshot alone does not establish a direct connection. Claims about relay-free ordinary-tab SSH need enough evidence for another contributor to reproduce and verify the network path.

## Pull requests

Keep each change focused. Describe the problem, behavior, and relevant validation. Discuss major architecture changes in an issue first. Do not commit credentials, personal connection profiles, signing keys, or private traffic captures. Use synthetic fixtures and redact identifying data from reports.

There is no application build or test suite yet. The startup API file is a design sketch; its JavaScript syntax can be checked with:

```sh
node --check docs/startup-api.example.mjs
```

Add appropriate build and test instructions alongside the first implementation. Retain upstream licenses and notices whenever introducing third-party code.
