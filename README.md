# Pi Session Viewer

A web app for browsing and visualizing [Pi agent](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent) session logs. It reads Pi JSONL session files from `~/.pi/agent/sessions/` and provides:

- a searchable project list
- sortable session tables
- session-to-session comparison
- a Gantt-style trace timeline
- themed HTML export previews

## Screenshots

**Project list** — grouped by working directory, with search and session match previews.

**Session table** — sortable by timestamp, duration, model, tokens, cost, and tool calls.

**Session detail** — timeline showing assistant/tool activity plus the rendered Pi HTML export.

**Session compare** — side-by-side comparison for two selected sessions.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command              | Description                             |
| -------------------- | --------------------------------------- |
| `npm run dev`        | Start the Express + Vite dev server     |
| `npm run build`      | Build the React frontend to `dist/client` |
| `npm start`          | Start the app in production mode        |
| `npm run lint`       | Run ESLint                              |
| `npm run lint:fix`   | Auto-fix ESLint issues                  |
| `npm run format`     | Format the repo with Prettier           |
| `npm run format:check` | Check formatting with Prettier        |
| `npm test`           | Run the Vitest suite                    |

## Configuration

### Session Directory

By default, sessions are read from:

```text
~/.pi/agent/sessions/
```

To change this, edit the `SESSIONS_DIR` constant in [`server/sessions.ts`](server/sessions.ts).

### Port

Set the `PORT` environment variable to override the default port (`3000`):

```bash
PORT=8080 npm run dev
```

### Export Cache

Exported HTML files are cached in `~/.pi-session-viewer-cache/`.

Cache invalidation includes:
- session file mtime
- selected theme cache token / theme file mtime

Delete the cache directory to clear cached exports manually.

## Project Structure

```text
pi-session-viewer/
├── server/
│   ├── index.ts          # Express server, API routes, Vite dev middleware
│   ├── sessions.ts       # Session scanning, path resolution, cache orchestration
│   ├── sessionCore.ts    # JSONL parsing, metadata aggregation, trace span logic
│   ├── piExport.ts       # Pi export integration, fallback CLI export, theme loading
│   ├── piExportCore.ts   # Pure export/theme helpers used by runtime + tests
│   └── logger.ts         # Pino logger setup
├── client/
│   ├── index.html        # HTML shell with fonts
│   ├── vite.config.ts    # Vite config
│   └── src/
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Router + header/breadcrumbs
│       ├── CompareContext.tsx# Session comparison selection state
│       ├── ProjectList.tsx   # Landing page + project/session search
│       ├── SessionTable.tsx  # Sortable project session table
│       ├── SessionView.tsx   # Single-session timeline + export preview
│       ├── SessionCompare.tsx# Side-by-side session compare view
│       ├── TraceTimeline.tsx # Gantt-style trace timeline component
│       ├── api.ts            # Typed fetch helpers for the client
│       └── styles.css        # Global styles and theme variables
├── tests/
│   └── server/
│       ├── piExport.test.ts
│       └── sessions.test.ts
├── themes/
│   └── tokyo-night.json
├── package.json
└── tsconfig.json
```

## API

| Endpoint                                               | Description |
| ------------------------------------------------------ | ----------- |
| `GET /api/projects`                                    | List all projects with display paths and session counts |
| `GET /api/search?q=...`                                | Search projects and session filenames |
| `GET /api/projects/:dirName/sessions`                  | List session metadata for a project |
| `GET /api/projects/:dirName/sessions/:filename/meta`   | Fetch metadata for one session |
| `GET /api/projects/:dirName/sessions/:filename/spans`  | Fetch timeline spans for one session |
| `GET /api/projects/:dirName/sessions/:filename/export` | Return cached, theme-patched export HTML |

## How It Works

1. **Scanning**
   - Reads `~/.pi/agent/sessions/` for project directories.
   - Uses the session header `cwd` as the display path when available.

2. **Metadata**
   - Parses JSONL messages to compute duration, token totals, cache tokens, cost, tool calls, models, and message count.
   - Caches computed metadata by `(filePath, mtimeMs)`.

3. **Trace spans**
   - Converts user, assistant, and tool activity into positioned spans.
   - The frontend renders the result as a Gantt-style timeline for each session.

4. **Export**
   - Prefers Pi's in-process Node export internals.
   - Falls back to `pi --export <file>` in a temp directory when needed.
   - Patches the generated HTML so explicit theme export colors are applied.
   - Caches export output in `~/.pi-session-viewer-cache/`.

## Notes

- Path parameters are sanitized before resolving session files.
- Tests target pure helper modules (`sessionCore.ts`, `piExportCore.ts`) instead of production-only `__private__` exports.
- ESLint is configured with type-aware TypeScript rules, and the client uses typed fetch helpers to avoid unsafe JSON/error flows.
