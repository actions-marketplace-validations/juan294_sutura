# Security Policy

## Supported Versions

Only the current release line receives security fixes.

| Version | Supported |
| ------- | --------- |
| 0.2.x   | Yes       |
| < 0.2   | No        |

## Reporting a Vulnerability

Do not report a security vulnerability through a public issue.

Send details to `juan294@gmail.com` with the subject `[sutura] Security vulnerability report`. Include the affected commit or version, steps to reproduce, impact, and a suggested fix if you have one. Remove repository credentials, provider keys, private source, and personal data from all evidence.

You can expect an acknowledgment within 48 hours, an initial assessment within 7 days, and a coordinated disclosure after a fix is available.

## Security Boundaries

- Failed-run logs, patches, and repository content are untrusted input.
- Untrusted execution remains isolated, bounded, and network-disabled.
- Sutura must not remove, skip, or weaken tests and verification to make CI green.
- GitHub, Nebius, Tavily, and ConTree credentials are secrets and must never enter evidence artifacts.
- Sutura opens evidence-backed pull requests for human review and never auto-merges them.
