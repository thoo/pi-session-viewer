import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
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
    --body-bg: #131920;
    --container-bg: #1a2129;
    --info-bg: #202933;
    --exportPageBg: #10161c;
    --exportCardBg: #151c24;
    --exportInfoBg: #1a2129;
    --selectedBg: #202933;
    --userMessageBg: #1a2129;
    --customMessageBg: #20242e;
    --toolPendingBg: #1b2128;
    --toolSuccessBg: #17231f;
    --toolErrorBg: #271c1f;
    --dim: #4f5f70;
    --borderMuted: #33414f;
    --muted: #7b8b9b;
    --text: #edf3ff;
    --accent: #69dbc8;
    --border: #7ab8ff;
    --borderAccent: #69dbc8;
    --success: #7cd0a5;
    --error: #ff8d89;
    --warning: #ffba6b;
    --thinkingText: #6c7c8d;
    --userMessageText: #edf3ff;
    --toolTitle: #edf3ff;
    --toolOutput: #b9c4cf;
    --mdHeading: #ffba6b;
    --mdLink: #7ab8ff;
    --mdCode: #69dbc8;
    --mdCodeBlock: #9ee7be;
    --toolDiffAdded: #9ee7be;
    --toolDiffRemoved: #ff8d89;
    --syntaxComment: #6c7c8d;
    --syntaxKeyword: #ffba6b;
    --syntaxFunction: #7ab8ff;
    --syntaxVariable: #edf3ff;
    --syntaxString: #9ee7be;
    --syntaxNumber: #ffba6b;
    --syntaxType: #69dbc8;
  }
  body {
    background: #10161c !important;
  }
  #sidebar {
    background: #151c24 !important;
    border-right-color: rgba(185, 196, 207, 0.1) !important;
  }
  .sidebar-search {
    background: #10161c !important;
    border-color: #33414f !important;
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

export function SessionView() {
  const { dirName, filename } = useParams<{
    dirName: string;
    filename: string;
  }>();

  const [sessionMeta, setSessionMeta] = useState<SessionMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [spansLoading, setSpansLoading] = useState(true);
  const [spansError, setSpansError] = useState<string | null>(null);

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const [traceVisible, setTraceVisible] = useState(false);

  const apiBase = `/api/projects/${encodeURIComponent(dirName!)}/sessions/${encodeURIComponent(filename!)}`;
  const session = useMemo(() => getSessionIdentity(filename || ""), [filename]);

  useEffect(() => {
    setSessionMeta(null);
    setMetaLoading(true);
    setMetaError(null);
    fetch(`/api/projects/${encodeURIComponent(dirName!)}/sessions`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((items: SessionMeta[]) => {
        const match = items.find((item) => item.filename === filename) ?? null;
        if (!match) throw new Error("Session metadata not found");
        setSessionMeta(match);
      })
      .catch((e) => setMetaError(e.message))
      .finally(() => setMetaLoading(false));
  }, [dirName, filename]);

  useEffect(() => {
    setSpansLoading(true);
    setSpansError(null);
    fetch(`${apiBase}/spans`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setSpans)
      .catch((e) => setSpansError(e.message))
      .finally(() => setSpansLoading(false));
  }, [apiBase]);

  useEffect(() => {
    let objectUrl: string | null = null;

    setExportUrl(null);
    setExportLoading(true);
    setExportError(null);

    fetch(`${apiBase}/export`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        const themed = injectThemeIntoHtml(html);
        const blob = new Blob([themed], { type: "text/html" });
        objectUrl = URL.createObjectURL(blob);
        setExportUrl(objectUrl);
      })
      .catch((e) => setExportError(e.message))
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
    <div className="container page-stack session-page">
      <div
        className={`session-layout ${traceVisible ? "" : "session-layout-full"}`}
      >
        {traceVisible && (
          <section className="panel-card trace-panel">
            <div className="panel-body panel-body-trace">
              <TraceTimeline
                spans={spans}
                loading={spansLoading}
                error={spansError}
              />
            </div>
          </section>
        )}

        <section className="panel-card export-panel">
          <div className="panel-header transcript-toolbar">
            <div className="transcript-toolbar-main">
              <span className="panel-title mono-text transcript-toolbar-id">
                {session.shortId}
              </span>
              {metaLoading && (
                <span className="session-hero-metric loading-pulse">
                  Loading metadata…
                </span>
              )}
              {sessionMeta && (
                <>
                  <span className="session-hero-metric">
                    {formatTimestamp(sessionMeta.timestamp)}
                  </span>
                  <span className="session-hero-metric">
                    {formatDuration(sessionMeta.durationSeconds)}
                  </span>
                  <span className="session-hero-metric">
                    {formatTokens(
                      sessionMeta.inputTokens + sessionMeta.outputTokens,
                    )}{" "}
                    tokens
                  </span>
                  <span className="session-hero-metric">
                    {sessionMeta.toolCalls} tools
                  </span>
                </>
              )}
              {metaError && (
                <span className="session-hero-metric" role="status">
                  Metadata unavailable
                </span>
              )}
              {!spansLoading && spans.length > 0 && (
                <span className="session-hero-metric">
                  {traceStats.userTurns} turns
                </span>
              )}
            </div>

            <div className="transcript-toolbar-actions">
              <button
                className={`btn btn-sm ${traceVisible ? "btn-accent" : ""}`}
                onClick={() => setTraceVisible((v) => !v)}
                aria-pressed={traceVisible}
              >
                {traceVisible ? "Hide trace" : "Show trace"}
              </button>
              {exportUrl && (
                <a
                  className="btn btn-sm"
                  href={exportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in new tab
                </a>
              )}
            </div>
          </div>
          <div className="panel-body export-stage">
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
                className="export-iframe"
                src={exportUrl}
                title="Session Export"
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
