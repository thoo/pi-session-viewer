import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useCompare } from "./CompareContext";

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

type SortKey = keyof SessionMeta;
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

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

function extractShortId(base: string): string {
  const underscoreIdx = base.indexOf("_");
  if (underscoreIdx !== -1) {
    const afterUnderscore = base.slice(underscoreIdx + 1);
    if (afterUnderscore.length > 0) {
      return afterUnderscore.slice(0, 8);
    }
  }
  const uuidMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-)/i);
  if (uuidMatch) {
    return uuidMatch[1].slice(0, 8);
  }
  return base.slice(0, 8);
}

function formatProjectInfo(dirName: string) {
  const decoded = decodeURIComponent(dirName);
  const normalized = decoded.replace(/^--/, "").replace(/--$/, "").replace(/--/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return {
    title: parts[parts.length - 1] || normalized,
    detail: normalized,
  };
}

export function SessionTable() {
  const { dirName } = useParams<{ dirName: string }>();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const { selected, isSelected, toggleSelection, clearSelection, readyToCompare } = useCompare();

  const projectInfo = useMemo(
    () => formatProjectInfo(dirName || ""),
    [dirName],
  );

  const loadSessions = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/projects/${encodeURIComponent(dirName!)}/sessions`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setSessions(data);
        setPage(0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadSessions();
  }, [dirName]);

  const sorted = useMemo(() => {
    const copy = [...sessions];
    copy.sort((a, b) => {
      let av: string | number = a[sortKey] as string | number;
      let bv: string | number = b[sortKey] as string | number;
      if (sortKey === "models") {
        av = (a.models ?? []).join(",");
        bv = (b.models ?? []).join(",");
      }
      if (typeof av === "string" && typeof bv === "string") {
        const cmp = av.localeCompare(bv);
        return sortDir === "asc" ? cmp : -cmp;
      }
      return sortDir === "asc"
        ? Number(av) - Number(bv)
        : Number(bv) - Number(av);
    });
    return copy;
  }, [sessions, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageData = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const columns: { key: SortKey; label: string; cls?: string }[] = [
    { key: "filename", label: "Session" },
    { key: "timestamp", label: "Time" },
    { key: "durationSeconds", label: "Duration", cls: "num" },
    { key: "models", label: "Model" },
    { key: "inputTokens", label: "In", cls: "num" },
    { key: "outputTokens", label: "Out", cls: "num" },
    { key: "cacheReadTokens", label: "Cache R", cls: "num" },
    { key: "cacheWriteTokens", label: "Cache W", cls: "num" },
    { key: "totalCost", label: "Cost", cls: "num" },
    { key: "toolCalls", label: "Tools", cls: "num" },
    { key: "messageCount", label: "Msgs", cls: "num" },
  ];

  const totals = useMemo(() => {
    return {
      inputTokens: sessions.reduce((sum, item) => sum + item.inputTokens, 0),
      outputTokens: sessions.reduce((sum, item) => sum + item.outputTokens, 0),
      cacheReadTokens: sessions.reduce((sum, item) => sum + item.cacheReadTokens, 0),
      cacheWriteTokens: sessions.reduce((sum, item) => sum + item.cacheWriteTokens, 0),
      totalCost: sessions.reduce((sum, item) => sum + item.totalCost, 0),
      toolCalls: sessions.reduce((sum, item) => sum + item.toolCalls, 0),
      messageCount: sessions.reduce((sum, item) => sum + item.messageCount, 0),
      modelCount: new Set(sessions.flatMap((item) => item.models)).size,
    };
  }, [sessions]);

  const latestSession = useMemo(() => {
    return sessions.reduce<SessionMeta | null>((latest, session) => {
      if (!latest) return session;
      return session.timestamp > latest.timestamp ? session : latest;
    }, null);
  }, [sessions]);

  const rangeStart = sessions.length === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, sessions.length);

  const sessionSummary = loading
    ? "Loading project sessions…"
    : sessions.length === 0
      ? "No sessions"
      : `${sessions.length} runs · ${totals.modelCount} models · ${formatTokens(
          totals.inputTokens + totals.outputTokens,
        )} tokens · $${totals.totalCost.toFixed(2)} total cost · ${totals.toolCalls} tool calls`;

  return (
    <div className="container page-stack">
      <section className="compact-toolbar project-toolbar">
        <div className="compact-toolbar-left project-toolbar-left">
          <div className="compact-toolbar-title project-toolbar-copy">
            <span className="compact-toolbar-sub">Project workspace</span>
            <div className="project-toolbar-heading-row">
              <span className="compact-toolbar-heading project-toolbar-heading">
                {projectInfo.title}
              </span>
              {!loading && !error && (
                <span className="compact-chip mono-text">{sessions.length} runs</span>
              )}
            </div>
            <span className="compact-toolbar-sub mono-text" title={projectInfo.detail}>
              {projectInfo.detail}
            </span>
          </div>

          {!loading && !error && sessions.length > 0 && (
            <div className="project-toolbar-metrics mono-text">
              <span className="session-hero-metric">{totals.modelCount} models</span>
              <span className="session-hero-metric">
                {formatTokens(totals.inputTokens + totals.outputTokens)} tokens
              </span>
              <span className="session-hero-metric">${totals.totalCost.toFixed(2)}</span>
              <span className="session-hero-metric">{totals.toolCalls} tools</span>
            </div>
          )}
        </div>

        <div className="compact-toolbar-right project-toolbar-actions">
          {selected.length > 0 && (
            <span className="compact-chip mono-text">{selected.length}/2 selected</span>
          )}
          {readyToCompare && <Link className="btn btn-sm" to="/compare">Compare</Link>}
          {selected.length > 0 && (
            <button className="btn btn-sm" onClick={clearSelection}>Clear</button>
          )}
          <button className="btn btn-sm btn-accent" onClick={loadSessions}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            Refresh
          </button>
        </div>
      </section>

      {!loading && !error && sessions.length > 0 && (
        <section className="overview-strip">
          <div className="overview-metric">
            <span className="overview-label">Sessions</span>
            <span className="overview-value mono-text">{sessions.length}</span>
            <span className="overview-detail">Indexed local runs</span>
          </div>
          <div className="overview-metric">
            <span className="overview-label">Models</span>
            <span className="overview-value mono-text">{totals.modelCount}</span>
            <span className="overview-detail">Unique model switches seen</span>
          </div>
          <div className="overview-metric">
            <span className="overview-label">Tokens</span>
            <span className="overview-value mono-text">
              {formatTokens(totals.inputTokens + totals.outputTokens)}
            </span>
            <span className="overview-detail">Prompt + completion volume</span>
          </div>
          <div className="overview-metric">
            <span className="overview-label">Total cost</span>
            <span className="overview-value mono-text">${totals.totalCost.toFixed(2)}</span>
            <span className="overview-detail">Across cached session metadata</span>
          </div>
          <div className="overview-metric">
            <span className="overview-label">Latest run</span>
            <span className="overview-value mono-text">
              {latestSession ? formatTimestamp(latestSession.timestamp) : "—"}
            </span>
            <span className="overview-detail">
              {latestSession ? `${latestSession.toolCalls} tools · ${latestSession.messageCount} messages` : "No activity yet"}
            </span>
          </div>
        </section>
      )}

      <section className="panel-card table-panel">
        <div className="panel-header table-panel-header">
          <div className="table-panel-heading">
            <div className="panel-title">Session index</div>
            <div className="table-panel-summary mono-text">{sessionSummary}</div>
          </div>
        </div>

        {loading && (
          <div className="table-loading">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="skeleton"
                style={{ height: 40, marginBottom: 10, opacity: 1 - i * 0.12 }}
              />
            ))}
          </div>
        )}

        {error && <div className="status-box error">Failed to load sessions: {error}</div>}

        {!loading && !error && sessions.length === 0 && (
          <div className="status-box">No sessions found for this project.</div>
        )}

        {!loading && pageData.length > 0 && (
          <>
            <div className="table-wrap">
              <table className="session-table">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th
                        key={col.key}
                        className={`${col.cls || ""} ${sortKey === col.key ? "sorted" : ""}`}
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.label}
                        {sortKey === col.key && (
                          <span className="sort-indicator">
                            {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((session) => {
                    const base = session.filename.replace(/\.jsonl$/, "");
                    const shortId = extractShortId(base);
                    const isChecked = isSelected({ dirName: dirName!, filename: session.filename });
                    return (
                      <tr key={session.filename}>
                        <td className="session-id-cell">
                          <div className="session-id-row">
                            <input
                              type="checkbox"
                              className="compare-checkbox"
                              checked={isChecked}
                              onChange={() =>
                                toggleSelection({
                                  dirName: dirName!,
                                  filename: session.filename,
                                  projectTitle: projectInfo.title,
                                  timestamp: session.timestamp,
                                })
                              }
                              title={isChecked ? "Remove from compare" : "Select for compare"}
                            />
                            <Link
                              to={`/project/${encodeURIComponent(dirName!)}/session/${encodeURIComponent(session.filename)}`}
                              className="session-id-link"
                              title={base}
                            >
                              {shortId}
                            </Link>
                          </div>
                        </td>
                        <td className="session-time-cell">{formatTimestamp(session.timestamp)}</td>
                        <td className="num">{formatDuration(session.durationSeconds)}</td>
                        <td>
                          <div className="session-models">
                            {session.models.map((model) => (
                              <span key={model} className="model-tag">
                                {model}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="num">{formatTokens(session.inputTokens)}</td>
                        <td className="num">{formatTokens(session.outputTokens)}</td>
                        <td className="num">{formatTokens(session.cacheReadTokens)}</td>
                        <td className="num">{formatTokens(session.cacheWriteTokens)}</td>
                        <td className="num cost-cell">${session.totalCost.toFixed(4)}</td>
                        <td className="num">{session.toolCalls}</td>
                        <td className="num">{session.messageCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="pagination">
                <div className="pagination-summary">
                  Page {page + 1} of {totalPages} ({rangeStart}–{rangeEnd} of {sessions.length})
                </div>
                <div className="pagination-controls">
                  <button
                    className="page-btn"
                    disabled={page === 0}
                    onClick={() => setPage((current) => current - 1)}
                  >
                    Prev
                  </button>
                  <button
                    className="page-btn"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
