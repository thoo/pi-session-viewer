# Pi Session Viewer

## What This Is

A web app for browsing Pi agent session logs stored as JSONL files at `~/.pi/agent/sessions/`. Express backend + React frontend (Vite), TypeScript throughout.

## Development

```bash
npm run dev           # Start dev server on port 3000
npm run build         # Build React frontend to dist/client
npm start             # Production mode
npm run lint          # ESLint
npm run format:check  # Prettier check
npm test              # Vitest
```

## Architecture

- `server/index.ts` — Express with 6 API routes + Vite dev middleware
- `server/sessions.ts` — project/session scanning, path sanitization, metadata/span/export cache orchestration
- `server/sessionCore.ts` — JSONL parsing, metadata aggregation, span computation
- `server/piExport.ts` — Pi export integration, CLI fallback, theme loading, HTML patching
- `server/piExportCore.ts` — pure export/theme helpers used directly by tests
- `client/src/` — React SPA with 4 routes: ProjectList → SessionTable → SessionView, plus SessionCompare
- `client/src/api.ts` — typed fetch/text helpers for safer client data loading
- `client/src/CompareContext.tsx` — shared compare-selection state persisted in localStorage

## Key Patterns

- **Metadata caching**: keyed by `(filePath, mtimeMs)` — avoids re-parsing unchanged JSONL files
- **Span caching**: keyed by `(filePath, mtimeMs)` — avoids recomputing trace spans for unchanged files
- **Export caching**: cached HTML in `~/.pi-session-viewer-cache/`, keyed by session identity + session mtime + theme cache token
- **In-flight export dedupe**: concurrent export requests for the same cache target share one promise
- **Path sanitization**: URL params reject `../`, `/`, `\` — resolved paths must start with `SESSIONS_DIR`
- **Typed client fetches**: use `client/src/api.ts` helpers instead of raw `response.json()` flows where possible
- **Test pure helpers directly**: prefer `sessionCore.ts` / `piExportCore.ts` imports over test-only exports from runtime modules
- **Export fallback**: `pi --export` runs via `spawn` with `stdio: ['ignore', 'pipe', 'pipe']` (stdin must be closed or Pi hangs)

## Conventions

- Dark theme with CSS variables defined in `styles.css` `:root`
- Monospace font (`JetBrains Mono`) for data values, `DM Sans` for UI text
- All token/cost values use `font-variant-numeric: tabular-nums` for alignment
- Timeline bars use CSS variables: `--color-user`, `--color-assistant`, `--color-tool`
- Keep pure parsing / transformation logic in dedicated modules when practical; keep orchestration and I/O in runtime-facing modules
- Maintain strict, type-aware linting; avoid `any` and unsafe JSON/error handling paths
