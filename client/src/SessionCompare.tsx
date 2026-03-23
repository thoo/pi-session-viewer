import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCompare, type CompareSessionRef } from "./CompareContext";
import { fetchJson, fetchText, getErrorMessage } from "./api";
import { TraceTimeline } from "./TraceTimeline";

interface SessionMeta {
  filename: string;
  timestamp: string;
  durationSeconds: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  toolCalls: number;
  messageCount: number;
}

interface TraceSpan {
  id: string;
  type: "user" | "assistant" | "tool";
  label: string;
  startMs: number;
  endMs: number;
  parentId: string | null;
  depth: number;
}

const EXPORT_THEME_CSS = `
<style id="viewer-theme-override">
  :root {
    --body-bg: #1a1b26;
    --container-bg: #1f2335;
    --info-bg: #24283b;
    --exportPageBg: #15161e;
    --exportCardBg: #1a1b26;
    --exportInfoBg: #1f2335;
    --selectedBg: #24283b;
    --userMessageBg: #1f2335;
    --customMessageBg: #28243d;
    --toolPendingBg: #202330;
    --toolSuccessBg: #1e2a25;
    --toolErrorBg: #2d1f2a;
    --dim: #414868;
    --borderMuted: #414868;
    --muted: #565f89;
    --text: #c0caf5;
    --accent: #7dcfff;
  }
  body { background: #1a1b26 !important; }
  #sidebar {
    background: #1f2335 !important;
    border-right-color: rgba(169,177,214,0.1) !important;
  }
  .sidebar-search {
    background: #1a1b26 !important;
    border-color: #414868 !important;
  }
</style>
`;

function injectThemeIntoHtml(html: string): string {
  const headClose = html.indexOf("</head>");
  if (headClose !== -1) {
    return html.slice(0, headClose) + EXPORT_THEME_CSS + html.slice(headClose);
  }
  return EXPORT_THEME_CSS + html;
}

function formatProjectInfo(raw: string) {
  const decoded = decodeURIComponent(raw);
  const normalized = decoded
    .replace(/^--/, "")
    .replace(/--$/, "")
    .replace(/--/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return {
    title: parts[parts.length - 1] || normalized,
    detail: normalized,
  };
}

function getSessionIdentity(filename: string) {
  const decoded = decodeURIComponent(filename);
  const base = decoded.replace(/\.jsonl$/, "");
  const derivedId = base.split("_").slice(1).join("_") || base;
  return {
    decoded,
    base,
    shortId: derivedId.slice(0, 8),
    derivedId,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return (
      d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
      ", " +
      d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return ts;
  }
}

function formatTraceDuration(ms: number) {
  if (ms <= 0) return "0s";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function SessionCompare() {
  const { selected, readyToCompare } = useCompare();

  return (
    <div className="container page-stack compare-page">
      {!readyToCompare && (
        <div className="status-box">
          {selected.length === 0
            ? "Select two sessions from any project to start comparing."
            : "Select one more session from any project to compare side by side."}
        </div>
      )}

      {readyToCompare && (
        <div className="compare-grid">
          {selected.slice(0, 2).map((session) => (
            <ComparePane
              key={`${session.dirName}:${session.filename}`}
              session={session}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ComparePane({ session }: { session: CompareSessionRef }) {
  const { removeSelection } = useCompare();
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [spansLoading, setSpansLoading] = useState(true);
  const [spansError, setSpansError] = useState<string | null>(null);
  const [traceVisible, setTraceVisible] = useState(false);

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);

  const project = useMemo(
    () => formatProjectInfo(session.dirName),
    [session.dirName],
  );
  const identity = useMemo(
    () => getSessionIdentity(session.filename),
    [session.filename],
  );
  const apiBase = `/api/projects/${encodeURIComponent(session.dirName)}/sessions/${encodeURIComponent(session.filename)}`;

  useEffect(() => {
    setMetaLoading(true);
    setMetaError(null);
    fetchJson<SessionMeta[]>(
      `/api/projects/${encodeURIComponent(session.dirName)}/sessions`,
    )
      .then((items) => {
        const match =
          items.find((item) => item.filename === session.filename) ?? null;
        if (!match) throw new Error("Session metadata not found");
        setMeta(match);
      })
      .catch((error: unknown) => setMetaError(getErrorMessage(error)))
      .finally(() => setMetaLoading(false));
  }, [session.dirName, session.filename]);

  useEffect(() => {
    setSpansLoading(true);
    setSpansError(null);
    fetchJson<TraceSpan[]>(`${apiBase}/spans`)
      .then(setSpans)
      .catch((error: unknown) => setSpansError(getErrorMessage(error)))
      .finally(() => setSpansLoading(false));
  }, [apiBase]);

  useEffect(() => {
    let objectUrl: string | null = null;

    setExportUrl(null);
    setExportLoading(true);
    setExportError(null);

    fetchText(`${apiBase}/export`)
      .then((html) => {
        const themed = injectThemeIntoHtml(html);
        const blob = new Blob([themed], { type: "text/html" });
        objectUrl = URL.createObjectURL(blob);
        setExportUrl(objectUrl);
      })
      .catch((error: unknown) => setExportError(getErrorMessage(error)))
      .finally(() => setExportLoading(false));

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [apiBase]);

  const traceStats = useMemo(() => {
    const toolSpans = spans.filter((span) => span.type === "tool").length;
    const assistantSpans = spans.filter(
      (span) => span.type === "assistant",
    ).length;
    const userTurns = spans.filter(
      (span) => span.depth === 0 && span.type === "user",
    ).length;
    const totalMs =
      spans.length > 0 ? Math.max(...spans.map((span) => span.endMs), 0) : 0;
    return { toolSpans, assistantSpans, userTurns, totalMs };
  }, [spans]);

  return (
    <section className="panel-card compare-pane">
      <div className="pane-header">
        <div className="pane-header-left pane-header-stack">
          <div className="pane-header-topline">
            <span className="pane-project-tag">{project.title}</span>
            <span className="pane-session-id mono-text">
              {identity.shortId}
            </span>
            {meta?.models[0] && (
              <span className="compact-chip mono-text">{meta.models[0]}</span>
            )}
          </div>
          <div
            className="pane-session-path mono-text"
            title={`${project.detail}/${identity.decoded}`}
          >
            {project.detail}/{identity.decoded}
          </div>
        </div>
        <div className="pane-header-right">
          <button
            className={`btn btn-sm ${traceVisible ? "" : "btn-accent"}`}
            onClick={() => setTraceVisible((v) => !v)}
          >
            {traceVisible ? "Hide trace" : "Trace"}
          </button>
          <Link
            className="btn btn-sm"
            to={`/project/${encodeURIComponent(session.dirName)}/session/${encodeURIComponent(session.filename)}`}
          >
            Open
          </Link>
          <button
            className="btn btn-sm"
            onClick={() => removeSelection(session)}
          >
            Remove
          </button>
        </div>
      </div>

      {!metaLoading && meta && (
        <div className="pane-stats-row">
          <div className="pane-stat">
            <span className="pane-stat-label">Time</span>
            <span className="pane-stat-value">
              {formatTimestamp(meta.timestamp)}
            </span>
          </div>
          <div className="pane-stat">
            <span className="pane-stat-label">Duration</span>
            <span className="pane-stat-value">
              {formatDuration(meta.durationSeconds)}
            </span>
          </div>
          <div className="pane-stat">
            <span className="pane-stat-label">Tokens</span>
            <span className="pane-stat-value">
              {formatTokens(meta.inputTokens + meta.outputTokens)}
            </span>
          </div>
          <div className="pane-stat">
            <span className="pane-stat-label">Cost</span>
            <span
              className="pane-stat-value"
              style={{ color: "var(--color-cost)" }}
            >
              ${meta.totalCost.toFixed(4)}
            </span>
          </div>
          <div className="pane-stat">
            <span className="pane-stat-label">Trace</span>
            <span className="pane-stat-value">
              {formatTraceDuration(traceStats.totalMs)}
            </span>
          </div>
          <div className="pane-stat">
            <span className="pane-stat-label">Steps</span>
            <span className="pane-stat-value">
              {traceStats.toolSpans} tools · {traceStats.assistantSpans} LLM
            </span>
          </div>
        </div>
      )}
      {metaLoading && (
        <div className="pane-stats-row">
          <span className="pane-stat-label loading-pulse">Loading…</span>
        </div>
      )}
      {metaError && (
        <div className="pane-stats-row">
          <span style={{ color: "var(--color-error)", fontSize: 12 }}>
            {metaError}
          </span>
        </div>
      )}

      {traceVisible && (
        <div className="pane-trace-block">
          <TraceTimeline
            spans={spans}
            loading={spansLoading}
            error={spansError}
          />
        </div>
      )}

      <div className="pane-export-block">
        {exportLoading && (
          <div className="export-status">
            <div className="spinner" />
            <span>Generating export…</span>
          </div>
        )}
        {exportError && (
          <div className="export-status error">
            Export failed: {exportError}
          </div>
        )}
        {exportUrl && (
          <iframe
            className="export-iframe compare-export-iframe"
            src={exportUrl}
            title={`Session Export ${identity.shortId}`}
          />
        )}
      </div>
    </section>
  );
}
