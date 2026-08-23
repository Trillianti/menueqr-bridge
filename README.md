# MenüQR Bridge

MenüQR Bridge is the open-source Windows desktop connector between the MenüQR
cloud service and restaurant-local integrations. The first supported adapter
prints kitchen bons from MenüQR table orders to a Star TSP1000-compatible LAN
printer.

The application runs in the Windows notification area, pairs with one
authorised restaurant through a browser flow, receives jobs over outbound
HTTPS, and connects to configured devices only on the restaurant's local
network. It does not open an inbound server, require port forwarding, or expose
a printer to the public internet.

## Current scope

- Windows 10/11 x64 desktop application built with Electron and TypeScript.
- Browser-based pairing without entering a MenüQR password in the desktop app.
- Encrypted local device credentials through Electron `safeStorage`.
- Durable job leasing, bounded retries, local deduplication, and explicit
  acknowledgements.
- Star TSP1000 LAN discovery, connection health, test printing, Star Line and
  ESC/POS command modes, 80/82 mm layouts, and German kitchen bons.
- Redacted diagnostics and optional automatic updates from the public MenüQR
  update CDN.

This is a kitchen workflow connector, not a fiscal receipt system. It does not
produce tax, VAT, payment, or legally fiscalised receipts.

## Security model

```text
MenüQR cloud
  ← outbound HTTPS pairing, heartbeat and long polling
MenüQR Bridge on the restaurant computer
  → private-LAN TCP connection
Kitchen printer
```

Renderer Node integration is disabled, context isolation and sandboxing are
enabled, credentials are encrypted locally, local printer addresses are not
sent to analytics, and all renderer actions use an allowlisted preload API.
See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md).

## Development

Requirements:

- Node.js 24
- npm

Install and verify:

```bash
npm ci
npm run typecheck
npm test
npm run test:integration
npm run build
```

Run the Electron smoke test:

```bash
RUN_ELECTRON_E2E=1 npm run test:e2e
```

Build the Windows installer on Windows:

```powershell
npm ci
npm run package:win
```

The installer is written to `release/`. Build output, credentials, runtime
state, diagnostics, printer addresses, and generated installers must never be
committed.

## Local backend development

Development builds can connect to a loopback or private-LAN MenüQR backend only
when explicitly enabled:

```powershell
npm run build
$env:NODE_ENV = "development"
$env:MENUEQR_BRIDGE_LOCAL_DEVELOPMENT = "1"
$env:MENUEQR_BRIDGE_API_URL = "http://127.0.0.1:3001/api"
$env:MENUEQR_BRIDGE_VERIFICATION_HOSTS = "127.0.0.1"
.\node_modules\.bin\electron.cmd .\dist\main\index.js
```

Packaged releases require HTTPS and do not accept this development override.

## Releases and signing

Release builds are built from the public tagged source and tested on
GitHub-hosted Windows runners. The first public release is intentionally
unsigned while the project applies for free open-source code signing through
SignPath Foundation. Windows may show a SmartScreen warning for unsigned builds.

Unsigned open-source releases are published only to GitHub Releases and are not
sent to the production automatic-update CDN.

After approval, the release workflow will submit its GitHub-hosted build to
SignPath with origin verification before publishing it. The governing policy is
[CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) before
opening a pull request. Security vulnerabilities must follow the private
reporting process in [SECURITY.md](SECURITY.md), not a public issue.

## License and trademarks

Source code and repository assets are licensed under the
[Apache License 2.0](LICENSE). The license does not grant permission to use the
MenüQR name or logos to identify another product. See
[TRADEMARKS.md](TRADEMARKS.md).
