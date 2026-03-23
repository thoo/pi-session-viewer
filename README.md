# Pi Session Viewer

A web app for browsing and visualizing [Pi agent](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent) session logs. Sessions are stored as JSONL files — this tool parses them and provides a searchable, sortable interface with a Gantt-chart trace timeline and HTML export previews.

## Screenshots

**Project list** — grouped by working directory, showing session counts.

**Session table** — sortable by timestamp, duration, model, tokens, cost, tool calls.

**Session detail** — Gantt timeline showing LLM thinking time vs tool execution, with the `pi --export` HTML rendered below.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

### Session Directory

By default, sessions are read from:

```
~/.pi/agent/sessions/
```

To change this, edit the `SESSIONS_DIR` constant in [`server/sessions.ts`](server/sessions.ts) (line 7):

```typescript
const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
```

### Port

Set the `PORT` environment variable (default: `3000`):

```bash
PORT=8080 npm run dev
```

### Export Cache

Exported HTML files are cached in `~/.pi-session-viewer-cache/`. Cache invalidation includes the session mtime and the export theme file mtime, so editing `themes/tokyo-night.json` automatically regenerates exports. Delete this directory to clear the cache manually.

## Project Structure

```
pi-session-viewer/
├── server/
│   ├── index.ts              # Express server, API routes, Vite dev middleware
│   └── sessions.ts           # JSONL parsing, metadata aggregation, span
│                              # computation, export caching, path sanitization
├── client/
│   ├── index.html            # HTML shell with Google Fonts
│   ├── vite.config.ts        # Vite config with API proxy to Express
│   └── src/
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Router (3 routes) + header with breadcrumbs
│       ├── ProjectList.tsx   # Landing page — project cards grid
│       ├── SessionTable.tsx  # Sortable table with metadata columns
│       ├── SessionView.tsx   # Trace timeline + export iframe
│       ├── TraceTimeline.tsx # Gantt-chart timeline component
│       └── styles.css        # Global styles, dark theme, animations
├── docs/
│   └── plan.md               # Architecture and design document
├── package.json
└── tsconfig.json
```

## API

| Endpoint                                               | Description                                             |
| ------------------------------------------------------ | ------------------------------------------------------- |
| `GET /api/projects`                                    | List all projects with display paths and session counts |
| `GET /api/projects/:dirName/sessions`                  | Session metadata (tokens, cost, duration, models)       |
| `GET /api/projects/:dirName/sessions/:filename/spans`  | Trace spans for the Gantt timeline                      |
| `GET /api/projects/:dirName/sessions/:filename/export` | Theme-patched Pi HTML export (cached)                   |

## How It Works

1. **Scanning** — reads `~/.pi/agent/sessions/` for project directories. Each directory contains JSONL session files. The `cwd` field from the session header is used as the display path.

2. **Metadata** — each JSONL file is parsed to aggregate: input/output/cache tokens, cost, tool call count, message count, models used, and duration. Results are cached by file mtime.

3. **Trace spans** — assistant messages and tool calls are converted into positioned spans with start/end times. LLM thinking gaps between tool rounds are computed and inserted. The frontend renders these as a Gantt chart showing serial vs parallel execution.

4. **Export** — the server prefers Pi’s in-process Node export API, loading `themes/tokyo-night.json` in memory and then patching the generated HTML so the theme’s explicit `export` colors apply. If Pi internals cannot be imported, it falls back to `pi --export <file>` in a temp directory and applies the same patch. Results are cached in `~/.pi-session-viewer-cache/` with theme-aware invalidation.

## Scripts

| Command         | Description                    |
| --------------- | ------------------------------ |
| `npm run dev`   | Start dev server with Vite HMR |
| `npm run build` | Build the React frontend       |
| `npm start`     | Start production server        |
