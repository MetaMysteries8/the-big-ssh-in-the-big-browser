# Security

This project is an experimental SSH client with a working local-connector prototype. There is no production release or completed security audit yet.

Trust the web app you pair with the extension: it receives your SSH credentials and terminal session. Use HTTPS for remotely hosted builds. Origin/destination grants restrict connector access; they do not protect credentials from a compromised copy of the authorized application. Keep private keys and terminal recordings out of issues and Git commits. JavaScript/Go garbage collection does not guarantee secret zeroization.

The native connector uses stdio native messaging, opens only TCP streams, and has no listening HTTP/WebSocket service. A session remains under the authority of its paired app origin. Removing a destination grant blocks subsequent connection requests; disconnect an existing session explicitly when revoking access.

## Reporting a vulnerability

For sensitive findings, use this repository's **Security > Advisories > Report a vulnerability** option if available. If private reporting is unavailable, open an issue requesting a private reporting channel without including exploit details, credentials, or private server information.

Include the affected revision, browser and operating system versions, required configuration, reproduction steps, and impact. Use synthetic accounts and test hosts. Never submit real private keys or unredacted terminal sessions.

Ordinary bugs and public browser capability limitations can be reported through normal GitHub issues.
