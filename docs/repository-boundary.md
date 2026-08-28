# Repository boundary

`Trillianti/menueqr-bridge` is the single source of truth for the MenüQR Bridge
desktop application and its Windows releases.

The private `menuqr` monorepo owns the cloud API, database, dashboard management
and public download pages. It no longer contains a second Electron application
copy. Cross-repository contract changes are verified in both repositories, but
desktop files are committed only here.

This separation keeps public code-signing provenance, versioning, installer
artifacts, security policy and releases independent from the private SaaS
application without maintaining two drifting copies of the same desktop code.
