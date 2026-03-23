import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

interface Project {
  dirName: string;
  displayPath: string;
  sessionCount: number;
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

export function ProjectList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const averageSessions = sortedProjects.length > 0
    ? Math.round(totalSessions / sortedProjects.length)
    : 0;

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
              ~/.pi/agent/sessions {loading ? "· scanning…" : `· ${sortedProjects.length} projects · ${totalSessions} sessions`}
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
              <span className="landing-spotlight-label">Most active workspace</span>
              <div className="landing-spotlight-value">
                {loading ? "Scanning local sessions…" : topProject ? getProjectName(topProject.displayPath) : "No sessions found"}
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

        <div className="landing-directory landing-directory-section" id="project-directory">
          <div className="section-heading landing-directory-head">
            <div>
              <div className="section-kicker">Projects</div>
              <div className="section-title">Choose a workspace</div>
              <div className="section-summary">
                Open any project to sort its runs by cost, duration, model, or tool activity.
              </div>
            </div>
            {!loading && !error && sortedProjects.length > 0 && (
              <div className="directory-count mono-text">
                {sortedProjects.length} · {totalSessions}
              </div>
            )}
          </div>

          {loading && (
            <div className="project-directory-grid">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="project-row project-row-skeleton" style={{ pointerEvents: "none" }}>
                  <div className="project-row-main">
                    <div className="skeleton project-avatar-skeleton" />
                    <div className="project-row-copy" style={{ flex: 1 }}>
                      <div className="skeleton" style={{ height: 18, width: "42%", marginBottom: 10 }} />
                      <div className="skeleton" style={{ height: 12, width: "100%" }} />
                    </div>
                  </div>
                  <div className="skeleton" style={{ height: 26, width: 92, borderRadius: 999 }} />
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="status-box error">Failed to load projects: {error}</div>
          )}

          {!loading && !error && sortedProjects.length === 0 && (
            <div className="status-box">
              No sessions found in ~/.pi/agent/sessions/
            </div>
          )}

          {!loading && !error && sortedProjects.length > 0 && (
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
                      <div className="project-avatar">{getProjectInitials(name)}</div>
                      <div className="project-row-copy">
                        <div className="project-name">{name}</div>
                        <div className="project-path">{project.displayPath}</div>
                      </div>
                    </div>

                    <div className="project-row-side">
                      <span className="project-count mono-text">
                        {project.sessionCount} session{project.sessionCount !== 1 ? "s" : ""}
                      </span>
                      <span className="project-card-arrow" aria-hidden="true">↗</span>
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
