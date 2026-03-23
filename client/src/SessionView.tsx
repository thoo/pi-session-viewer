import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { TraceTimeline } from "./TraceTimeline";
import { useCompare } from "./CompareContext";

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

function formatProjectInfo(raw: string) {
  const decoded = decodeURIComponent(raw);
  const normalized = decoded.replace(/^--/, "").replace(/--$/, "").replace(/--/g, "/");
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

export function SessionView() {
  const { dirName, filename } = useParams<{
    dirName: string;
    filename: string;
  }>();
  const { selected, isSelected, toggleSelection, readyToCompare } = useCompare();

  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const [spansLoading, setSpansLoading] = useState(true);
  const [spansError, setSpansError] = useState<string | null>(null);

  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);
  const [traceVisible, setTraceVisible] = useState(false);

  const apiBase = `/api/projects/${encodeURIComponent(dirName!)}/sessions/${encodeURIComponent(filename!)}`;
  const projectTitle = useMemo(() => formatProjectInfo(dirName || "").title, [dirName]);
  const session = useMemo(() => getSessionIdentity(filename || ""), [filename]);

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
    const assistantSpans = spans.filter((span) => span.type === "assistant").length;
    const userTurns = spans.filter((span) => span.depth === 0 && span.type === "user").length;
    const totalMs = spans.length > 0 ? Math.max(...spans.map((span) => span.endMs), 0) : 0;
    return { toolSpans, assistantSpans, userTurns, totalMs };
  }, [spans]);

  return (
    <div className="container page-stack session-page">
      <div className={`session-layout ${traceVisible ? "" : "session-layout-full"}`}>
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
          <div className="panel-header viewer-panel-header session-export-header">
            <div className="session-export-heading">
              <div className="panel-title mono-text">{session.shortId}</div>
              {!spansLoading && (
                <div className="session-export-stats mono-text">
                  <span className="session-export-stat">{traceStats.userTurns} turns</span>
                  <span className="session-export-stat">{traceStats.assistantSpans} LLM</span>
                  <span className="session-export-stat">{traceStats.toolSpans} tools</span>
                  <span className="session-export-stat">{formatTraceDuration(traceStats.totalMs)}</span>
                </div>
              )}
            </div>

            <div className="toolbar-actions">
              <Link className="btn btn-sm" to="/">All projects</Link>
              <Link className="btn btn-sm" to={`/project/${encodeURIComponent(dirName!)}`}>All sessions</Link>
              <button
                className={`btn btn-sm ${traceVisible ? "btn-accent" : ""}`}
                onClick={() => setTraceVisible((v) => !v)}
                aria-pressed={traceVisible}
              >
                {traceVisible ? "Hide trace" : "Show trace"}
              </button>
              <button
                className={`btn btn-sm ${isSelected({ dirName: dirName!, filename: filename! }) ? "btn-accent" : ""}`}
                onClick={() =>
                  toggleSelection({
                    dirName: dirName!,
                    filename: filename!,
                    projectTitle,
                  })
                }
              >
                {isSelected({ dirName: dirName!, filename: filename! })
                  ? "Selected"
                  : `Compare (${selected.length}/2)`}
              </button>
              {readyToCompare && <Link className="btn btn-sm" to="/compare">Compare now</Link>}
              {exportUrl && (
                <a className="btn btn-sm" href={exportUrl} target="_blank" rel="noreferrer">
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
