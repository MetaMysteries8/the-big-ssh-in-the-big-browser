# Repository security configuration

The repository is public so people can read, fork, and propose changes. Public visibility does not grant push or administration access.

## Access and main branch

- MetaMysteries8 retains administration access.
- openaideveloperai-png is invited with write access, not administration access.
- Changes to the default branch must go through a pull request.
- Normal merges require one approving review, including the CODEOWNER (MetaMysteries8), approval of the latest push by someone other than its pusher, and resolved review conversations.
- New pushes dismiss stale approvals.
- The repository administrator can explicitly bypass review requirements through a pull request. This lets the owner merge their own maintenance PR when another reviewer is unavailable. It does not permit direct pushes.
- Default-branch deletion and force pushes are blocked, with no configured bypass. Linear history and squash merges keep the branch history straightforward.

The review owner is declared in [CODEOWNERS](../.github/CODEOWNERS). The intended active policies are recorded in [main-integrity.json](../.github/rulesets/main-integrity.json) and [main-review.json](../.github/rulesets/main-review.json). Editing these JSON files alone does not change GitHub's live settings; an administrator must apply them through GitHub's settings or API.

These controls govern merges into the protected default branch. A write collaborator can still work on other branches. Administrators can change repository settings and must protect their GitHub accounts accordingly.

## Automation

- Workflow tokens default to read access and cannot approve pull requests.
- Workflows from all outside contributors require maintainer approval.
- External Actions are restricted to GitHub-owned actions, pinned to full commit SHAs. Additional actions require an explicit allowlist change.
- There are no repository workflows, secrets, or self-hosted runners configured by this setup.
- Future checks must be added and observed passing before they become required merge checks.

## Vulnerabilities and secrets

- Secret scanning and secret push protection are enabled.
- Dependabot alerts and automatic security updates are enabled; they become useful as supported dependency manifests are added.
- Private vulnerability reporting is enabled; see [SECURITY.md](../SECURITY.md).

These settings reduce the risk of unauthorized changes and accidental exposure. They do not make untrusted code safe to run or guarantee that credentials can never be committed.
