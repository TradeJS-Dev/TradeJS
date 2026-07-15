# Security Policy

TradeJS can connect to exchanges, infrastructure services, and AI/ML providers.
Please report vulnerabilities responsibly and avoid exposing credentials or
account data in public channels.

## Supported Versions

Security fixes are made for the latest published version of the affected
`@tradejs/*` package and the current `stable` branch. Older package versions are
not actively supported; users should upgrade before requesting a backport.

## Reporting a Vulnerability

Use GitHub's
[private vulnerability reporting](https://github.com/TradeJS-Dev/TradeJS/security/advisories/new).
Do not open a public issue or discussion for a suspected vulnerability.

Include as much of the following as possible:

- the affected package, version, commit, and configuration
- impact and realistic attack scenario
- reproduction steps or a minimal proof of concept
- relevant logs with secrets and personal data removed
- any suggested mitigation

Maintainers will review the report, keep communication in the private advisory,
and coordinate validation, remediation, and disclosure. Please allow time for a
fix to be prepared before publishing details.

If credentials may have been exposed, revoke or rotate them immediately rather
than waiting for the investigation.

## Operational Security

- Use exchange API keys with the minimum required permissions.
- Disable withdrawals for keys used by TradeJS.
- Prefer testnet or paper trading while evaluating a configuration.
- Store secrets outside source control and avoid including them in logs,
  screenshots, backtest artifacts, or support requests.
- Keep TradeJS, Node.js, containers, and infrastructure dependencies current.
- Review strategies, connectors, plugins, and order settings before enabling
  live order placement.

Security reports cover vulnerabilities in TradeJS-maintained code. Questions
about safe configuration that do not disclose a vulnerability belong in
[GitHub Discussions](https://github.com/TradeJS-Dev/TradeJS/discussions/categories/q-a).
