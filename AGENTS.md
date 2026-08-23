# Contributor Guidelines

## Repository map

- `src/main/` — Electron lifecycle, pairing, updates, tray and diagnostics.
- `src/preload/` — the typed, allowlisted renderer bridge.
- `src/renderer/` — the sandboxed German desktop interface.
- `src/core/` — OS-independent pairing, runtime, job and deduplication logic.
- `src/integrations/` — versioned integration contracts and adapters.
- `tests/` — unit, integration and Electron end-to-end coverage.
- `assets/` and `installer/` — tracked release inputs.

## Working rules

- Preserve Electron sandboxing, context isolation and the preload allowlist.
- Never persist plaintext device tokens or log credentials, restaurant data,
  local network topology, printer payloads or environment secrets.
- Do not add inbound HTTP servers, public tunnels or router configuration.
- Keep printer-specific behavior behind the integration adapter boundary.
- Treat cloud jobs as at-least-once and acknowledge only after successful local
  execution.
- Do not claim Windows, SignPath or physical-printer verification without real
  evidence from that environment.
- Keep release workflows on GitHub-hosted runners so SignPath origin
  verification can trust the build provenance.

## Checks

Run checks proportional to the change:

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
RUN_ELECTRON_E2E=1 npm run test:e2e
```

Do not commit `node_modules/`, `dist/`, `release/`, diagnostics, local runtime
state, `.env` files, signing tokens or generated installers.
