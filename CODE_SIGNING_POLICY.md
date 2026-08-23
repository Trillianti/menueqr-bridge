# Code Signing Policy

## Status

The project is applying for SignPath Foundation Open Source Code Signing.
Public installers remain explicitly unsigned until the application is approved
and the trusted GitHub build integration has passed end-to-end verification.

After approval, release pages will include the required acknowledgement:

> Free code signing provided by SignPath.io, certificate by SignPath Foundation.

## Source and build provenance

- Source repository: `https://github.com/Trillianti/menueqr-bridge`
- Official artifacts are built only by workflows committed to this repository.
- Signable releases use GitHub-hosted runners and upload the unsigned build as a
  GitHub Actions artifact before submitting it to SignPath.
- SignPath trusted-build-system and origin verification must be enabled.
- After the SignPath integration is enabled, signed release artifacts are
  published only after tests, origin verification, and signing succeed.
- Signing credentials and SignPath API tokens are stored only as GitHub Actions
  secrets and are never exposed to pull-request workflows.

## Team roles

- Committers and reviewers: repository members with write access in the
  `Trillianti` GitHub organisation.
- Approvers: repository administrators in the `Trillianti` GitHub organisation.
- Automated submitter: the dedicated GitHub Actions identity configured after
  SignPath approval.

All human participants must use multi-factor authentication. External pull
requests require maintainer review. A release-signing request may be submitted
only from the protected release workflow for an immutable tagged commit.

## Privacy

The signed application communicates with network services only as described in
[PRIVACY.md](PRIVACY.md). It contains no advertising SDK or behavioural
analytics. Local printer communication is initiated for the restaurant's own
configured device and is never exposed publicly.

## Incident response

If signing credentials, repository administration, release provenance, or a
published artifact may be compromised, maintainers will pause releases, revoke
affected credentials or certificates, remove update metadata when necessary,
and coordinate disclosure through a private GitHub Security Advisory.
