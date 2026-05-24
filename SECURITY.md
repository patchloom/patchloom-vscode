# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities in public GitHub issues.

Use [GitHub private vulnerability reporting](https://github.com/patchloom/patchloom-vscode/security/advisories/new) to submit security reports. This sends the report directly to the maintainers without public disclosure.

## What To Report Privately

- Path traversal or file access outside the workspace
- Command injection through patchloom binary invocation
- Secrets exposure in logs, settings, or diagnostics
- Managed install integrity bypass (checksum, URL validation)
- Supply chain or extension packaging issues

## What To Report Publicly

Use public issues for ordinary bugs, feature requests, and documentation problems.

## Response Expectations

Maintainers will acknowledge the report quickly, confirm reproducibility, and work on a fix privately when needed.
