import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

interface Project {
  dirName: string;
  displayPath: string;
  sessionCount: number;
}

interface SessionSearchMatch {
  filename: string;
  timestamp: string;
  models: string[];
}

interface SearchProjectResult extends Project {
  projectMatches: boolean;
  matchingSessions: SessionSearchMatch[];
  totalSessionMatches: number;
}

interface SearchSessionResult extends SessionSearchMatch {
  dirName: string;
  projectDisplayPath: string;
  projectTitle: string;
}

type SignalType = "user" | "assistant" | "tool";

const HERO_ROWS: { type: SignalType; width: number }[][] = [
  [
    { type: "user", width: 16 },
    { type: "assistant", width: 14 },
    { type: "tool", width: 24 },
    { type: "assistant", width: 18 },
  ],
  [
    { type: "assistant", width: 18 },
    { type: "tool", width: 12 },
    { type: "tool", width: 20 },
    { type: "assistant", width: 16 },
  ],
  [
    { type: "user", width: 12 },
    { type: "assistant", width: 20 },
    { type: "tool", width: 16 },
    { type: "tool", width: 22 },
  ],
  [
    { type: "assistant", width: 22 },
    { type: "tool", width: 28 },
    { type: "assistant", width: 14 },
  ],
  [
    { type: "user", width: 10 },
    { type: "assistant", width: 26 },
    { type: "tool", width: 18 },
    { type: "assistant", width: 12 },
  ],
  [
    { type: "assistant", width: 16 },
    { type: "tool", width: 14 },
    { type: "tool", width: 24 },
    { type: "assistant", width: 20 },
  ],
];

function getProjectName(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function getProjectInitials(name: string) {
  return (
    name
      .split(/[-_\s]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "PI"
  );
}

function getSignalClass(type: SignalType) {
  if (type === "user") return "signal-segment-user";
  if (type === "assistant") return "signal-segment-assistant";
  return "signal-segment-tool";
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

function formatTimestamp(ts: string): string {
  if (!ts) return "";

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

function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchProjectResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const countDiff = b.sessionCount - a.sessionCount;
        if (countDiff !== 0) return countDiff;
        return a.displayPath.localeCompare(b.displayPath);
      }),
    [projects],
  );

  const totalSessions = useMemo(
    () => projects.reduce((sum, p) => sum + p.sessionCount, 0),
    [projects],
  );

  const topProject = sortedProjects[0] ?? null;
  const averageSessions =
    sortedProjects.length > 0
      ? Math.round(totalSessions / sortedProjects.length)
      : 0;

  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;

  useEffect(() => {
    if (!trimmedSearch) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setSearchLoading(true);
      setSearchError(null);

      fetch(`/api/search?q=${encodeURIComponent(trimmedSearch)}`, {
        signal: controller.signal,
      })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then(setSearchResults)
        .catch((e) => {
          if (e.name === "AbortError") return;
          setSearchError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSearchLoading(false);
          }
        });
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [trimmedSearch]);

  const matchedProjects = useMemo(
    () => searchResults.filter((project) => project.projectMatches),
    [searchResults],
  );

  const visibleMatchedSessions = useMemo<SearchSessionResult[]>(
    () =>
      searchResults
        .flatMap((project) =>
          project.matchingSessions.map((session) => ({
            ...session,
            dirName: project.dirName,
            projectDisplayPath: project.displayPath,
            projectTitle: getProjectName(project.displayPath),
          })),
        )
        .sort((a, b) => {
          const timeDiff =
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          if (Number.isFinite(timeDiff) && timeDiff !== 0) return timeDiff;
          return a.filename.localeCompare(b.filename);
        }),
    [searchResults],
  );

  const totalMatchedSessions = useMemo(
    () =>
      searchResults.reduce(
        (sum, project) => sum + project.totalSessionMatches,
        0,
      ),
    [searchResults],
  );

  const searchSummary = isSearching
    ? `${matchedProjects.length} workspace${matchedProjects.length !== 1 ? "s" : ""} · ${totalMatchedSessions} session${totalMatchedSessions !== 1 ? "s" : ""}`
    : `${sortedProjects.length} · ${totalSessions}`;

  return (
    <div className="container page-stack landing-page">
      <section className="landing-surface landing-hero-shell panel-card">
        <div className="landing-signal" aria-hidden="true">
          {HERO_ROWS.map((row, rowIndex) => (
            <div key={rowIndex} className="signal-row">
              {row.map((segment, segmentIndex) => (
                <span
                  key={`${rowIndex}-${segmentIndex}`}
                  className={`signal-segment ${getSignalClass(segment.type)}`}
                  style={{
                    width: `${segment.width}%`,
                    animationDelay: `${rowIndex * 140 + segmentIndex * 90}ms`,
                  }}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="landing-hero-grid">
          <div className="landing-hero-copy">
            <div className="landing-kicker">Local session logs</div>
            <div className="landing-brand">Pi Session Viewer</div>
            <div className="landing-meta mono-text">
              ~/.pi/agent/sessions{" "}
              {loading
                ? "· scanning…"
                : `· ${sortedProjects.length} projects · ${totalSessions} sessions`}
            </div>
            <div className="landing-actions">
              <a href="#project-directory" className="btn btn-accent">
                Browse projects
              </a>
              <Link to="/compare" className="btn">
                Open compare
              </Link>
            </div>
          </div>

          <div className="landing-hero-aside">
            <div className="landing-stat-grid">
              <div className="landing-stat">
                <span className="landing-stat-label">Projects</span>
                <span className="landing-stat-value mono-text">
                  {loading ? "—" : sortedProjects.length}
                </span>
              </div>
              <div className="landing-stat">
                <span className="landing-stat-label">Sessions</span>
                <span className="landing-stat-value mono-text">
                  {loading ? "—" : totalSessions}
                </span>
              </div>
              <div className="landing-stat">
                <span className="landing-stat-label">Avg / project</span>
                <span className="landing-stat-value mono-text">
                  {loading ? "—" : averageSessions}
                </span>
              </div>
            </div>

            <div className="landing-spotlight">
              <span className="landing-spotlight-label">
                Most active workspace
              </span>
              <div className="landing-spotlight-value">
                {loading
                  ? "Scanning local sessions…"
                  : topProject
                    ? getProjectName(topProject.displayPath)
                    : "No sessions found"}
              </div>
              <div className="project-path">
                {loading
                  ? "Waiting for directory scan"
                  : topProject
                    ? `${topProject.displayPath} · ${topProject.sessionCount} sessions`
                    : "Start a Pi session to see it appear here."}
              </div>
            </div>
          </div>
        </div>

        <div
          className="landing-directory landing-directory-section"
          id="project-directory"
        >
          <div className="section-heading landing-directory-head">
            <div>
              <div className="section-kicker">Projects</div>
              <div className="section-title">Choose a workspace</div>
              <div className="section-summary">
                Open any project to sort its runs by cost, duration, model, or
                tool activity.
              </div>
            </div>
            {!loading && !error && sortedProjects.length > 0 && (
              <div className="directory-count mono-text">{searchSummary}</div>
            )}
          </div>

          <div className="landing-directory-toolbar">
            <label className="search-field landing-search">
              <SearchIcon />
              <input
                className="search-input"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search workspace, folder, project, or session"
                aria-label="Search workspaces and sessions"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  ×
                </button>
              )}
            </label>

            <div className="search-meta mono-text">
              {isSearching
                ? searchLoading
                  ? "Searching…"
                  : searchError
                    ? "Search unavailable"
                    : `${totalMatchedSessions} session match${totalMatchedSessions !== 1 ? "es" : ""}`
                : "Partial match across workspaces and session ids"}
            </div>
          </div>

          {loading && !isSearching && (
            <div className="project-directory-grid">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="project-row project-row-skeleton"
                  style={{ pointerEvents: "none" }}
                >
                  <div className="project-row-main">
                    <div className="skeleton project-avatar-skeleton" />
                    <div className="project-row-copy" style={{ flex: 1 }}>
                      <div
                        className="skeleton"
                        style={{ height: 18, width: "42%", marginBottom: 10 }}
                      />
                      <div
                        className="skeleton"
                        style={{ height: 12, width: "100%" }}
                      />
                    </div>
                  </div>
                  <div
                    className="skeleton"
                    style={{ height: 26, width: 92, borderRadius: 999 }}
                  />
                </div>
              ))}
            </div>
          )}

          {error && !isSearching && (
            <div className="status-box error">
              Failed to load projects: {error}
            </div>
          )}

          {!loading &&
            !error &&
            !isSearching &&
            sortedProjects.length === 0 && (
              <div className="status-box">
                No sessions found in ~/.pi/agent/sessions/
              </div>
            )}

          {isSearching && searchLoading && (
            <div className="status-box">Searching local sessions…</div>
          )}

          {isSearching && searchError && (
            <div className="status-box error">Search failed: {searchError}</div>
          )}

          {isSearching &&
            !searchLoading &&
            !searchError &&
            searchResults.length === 0 && (
              <div className="status-box">
                No workspaces or sessions match “{trimmedSearch}”.
              </div>
            )}

          {isSearching &&
            !searchLoading &&
            !searchError &&
            searchResults.length > 0 && (
              <>
                {visibleMatchedSessions.length > 0 && (
                  <div className="search-results-section">
                    <div className="search-results-head">
                      <div>
                        <div className="section-kicker">Sessions</div>
                        <div className="search-results-title">
                          Matching sessions
                        </div>
                      </div>
                      <div className="search-results-summary mono-text">
                        {visibleMatchedSessions.length === totalMatchedSessions
                          ? `${totalMatchedSessions} shown`
                          : `${visibleMatchedSessions.length} of ${totalMatchedSessions}`}
                      </div>
                    </div>

                    <div className="session-search-grid">
                      {visibleMatchedSessions.map((session) => {
                        const base = session.filename.replace(/\.jsonl$/, "");
                        return (
                          <div
                            key={`${session.dirName}:${session.filename}`}
                            className="session-search-card"
                          >
                            <div className="session-search-card-top">
                              <Link
                                to={`/project/${encodeURIComponent(session.dirName)}/session/${encodeURIComponent(session.filename)}`}
                                className="session-id-link"
                                title={session.filename}
                              >
                                {extractShortId(base)}
                              </Link>
                              {session.timestamp && (
                                <span className="session-search-time mono-text">
                                  {formatTimestamp(session.timestamp)}
                                </span>
                              )}
                            </div>

                            <div
                              className="session-search-name mono-text"
                              title={session.filename}
                            >
                              {session.filename}
                            </div>
                            <div
                              className="project-path"
                              title={session.projectDisplayPath}
                            >
                              {session.projectDisplayPath}
                            </div>

                            {session.models.length > 0 && (
                              <div className="session-models">
                                {session.models.map((model) => (
                                  <span key={model} className="model-tag">
                                    {model}
                                  </span>
                                ))}
                              </div>
                            )}

                            <div className="session-search-actions">
                              <Link
                                to={`/project/${encodeURIComponent(session.dirName)}/session/${encodeURIComponent(session.filename)}`}
                                className="btn btn-sm btn-accent"
                              >
                                Open session
                              </Link>
                              <Link
                                to={`/project/${encodeURIComponent(session.dirName)}`}
                                className="btn btn-sm"
                              >
                                Open project
                              </Link>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {matchedProjects.length > 0 && (
                  <div className="search-results-section">
                    <div className="search-results-head">
                      <div>
                        <div className="section-kicker">Workspaces</div>
                        <div className="search-results-title">
                          Matching folders and projects
                        </div>
                      </div>
                      <div className="search-results-summary mono-text">
                        {matchedProjects.length} shown
                      </div>
                    </div>

                    <div className="project-directory-grid">
                      {matchedProjects.map((project, i) => {
                        const name = getProjectName(project.displayPath);
                        return (
                          <Link
                            key={project.dirName}
                            to={`/project/${encodeURIComponent(project.dirName)}`}
                            className="project-row"
                            style={{ animationDelay: `${i * 0.05}s` }}
                          >
                            <div className="project-row-main">
                              <div className="project-avatar">
                                {getProjectInitials(name)}
                              </div>
                              <div className="project-row-copy">
                                <div className="project-name">{name}</div>
                                <div className="project-path">
                                  {project.displayPath}
                                </div>
                                {project.totalSessionMatches > 0 && (
                                  <div className="search-match-note mono-text">
                                    {project.totalSessionMatches} matching
                                    session
                                    {project.totalSessionMatches !== 1
                                      ? "s"
                                      : ""}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="project-row-side">
                              <span className="project-count mono-text">
                                {project.sessionCount} session
                                {project.sessionCount !== 1 ? "s" : ""}
                              </span>
                              <span
                                className="project-card-arrow"
                                aria-hidden="true"
                              >
                                ↗
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}

          {!loading && !error && !isSearching && sortedProjects.length > 0 && (
            <div className="project-directory-grid">
              {sortedProjects.map((project, i) => {
                const name = getProjectName(project.displayPath);
                return (
                  <Link
                    key={project.dirName}
                    to={`/project/${encodeURIComponent(project.dirName)}`}
                    className="project-row"
                    style={{ animationDelay: `${i * 0.05}s` }}
                  >
                    <div className="project-row-main">
                      <div className="project-avatar">
                        {getProjectInitials(name)}
                      </div>
                      <div className="project-row-copy">
                        <div className="project-name">{name}</div>
                        <div className="project-path">
                          {project.displayPath}
                        </div>
                      </div>
                    </div>

                    <div className="project-row-side">
                      <span className="project-count mono-text">
                        {project.sessionCount} session
                        {project.sessionCount !== 1 ? "s" : ""}
                      </span>
                      <span className="project-card-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
