# Security Policy

## Supported versions

Security fixes are provided for the latest published stable version. Users
should update promptly when Bridge reports that a newer version is available.

## Reporting a vulnerability

Do not disclose vulnerabilities, credentials, restaurant identifiers, printer
addresses, order payloads, diagnostics, or proof-of-concept exploits in a public
issue.

Use GitHub's private vulnerability reporting for this repository:

`Security` → `Advisories` → `Report a vulnerability`

Include the affected version, platform, impact, reproduction steps, and the
smallest safe supporting material. Remove all real credentials and restaurant
or customer data. Maintainers will acknowledge the report, investigate it, and
coordinate remediation and disclosure through the private advisory.

## Release integrity

Official releases are built by the repository's GitHub Actions workflow. Until
the SignPath Foundation application is approved, public installers are
explicitly marked unsigned. After approval, release artifacts will be submitted
from GitHub-hosted runners with SignPath origin verification under
[CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).
