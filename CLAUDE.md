# Pi Session Viewer

## What This Is

A web app for browsing Pi agent session logs stored as JSONL files at `~/.pi/agent/sessions/`. Express backend + React frontend (Vite), TypeScript throughout.

## Development

```bash
npm run dev    # Start dev server on port 3000
npm run build  # Build React frontend to dist/client
npm start      # Production mode
```

## Architecture

- `server/index.ts` — Express with 4 API routes + Vite dev middleware
- `server/sessions.ts` — JSONL parsing, metadata caching (by mtime), span computation, `pi --export` caching
- `client/src/` — React SPA with 3 routes: ProjectList → SessionTable → SessionView

## Key Patterns

- **Metadata caching**: keyed by `(filePath, mtimeMs)` — avoids re-parsing unchanged JSONL files
- **Path sanitization**: URL params reject `../`, `/`, `\` — resolved paths must start with `SESSIONS_DIR`
- **Trace spans**: user/assistant/tool spans computed from JSONL messages. LLM thinking gaps between tool rounds are inserted as separate spans. Frontend renders as Gantt chart with temporal positioning.
- **Export**: `pi --export` runs via `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` (stdin must be closed or pi hangs). HTML cached in `~/.pi-session-viewer-cache/`.

## Conventions

- Dark theme with CSS variables defined in `styles.css` `:root`
- Monospace font (`JetBrains Mono`) for data values, `DM Sans` for UI text
- All token/cost values use `font-variant-numeric: tabular-nums` for alignment
- Timeline bars use CSS variables: `--color-user`, `--color-assistant`, `--color-tool`
