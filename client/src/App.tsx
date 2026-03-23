import { Routes, Route, Link, useLocation } from "react-router-dom";
import { ProjectList } from "./ProjectList";
import { SessionTable } from "./SessionTable";
import { SessionView } from "./SessionView";
import { SessionCompare } from "./SessionCompare";
import { useCompare } from "./CompareContext";

export function App() {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/compare" element={<SessionCompare />} />
          <Route path="/project/:dirName" element={<SessionTable />} />
          <Route
            path="/project/:dirName/session/:filename"
            element={<SessionView />}
          />
        </Routes>
      </main>
    </div>
  );
}

function PiIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
      <path d="M10 8v8" />
      <path d="M14 8v8" />
    </svg>
  );
}

function formatProjectLabel(raw: string) {
  const decoded = decodeURIComponent(raw);
  const normalized = decoded.replace(/^--/, "").replace(/--$/, "").replace(/--/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return {
    title: parts[parts.length - 1] || normalized,
    detail: normalized,
  };
}

function formatSessionLabel(raw: string) {
  const decoded = decodeURIComponent(raw).replace(/\.jsonl$/, "");
  const shortened = decoded.length > 24 ? `${decoded.slice(0, 24)}…` : decoded;
  return {
    detail: decoded,
    short: shortened,
  };
}

function Header() {
  const location = useLocation();
  const { selected, readyToCompare } = useCompare();
  const parts = location.pathname.split("/").filter(Boolean);
  const project = parts[1] ? formatProjectLabel(parts[1]) : null;
  const session = parts[3] ? formatSessionLabel(parts[3]) : null;

  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-logo">
          <div className="header-logo-mark">
            <PiIcon />
          </div>
          <div className="header-copy">
            <span className="header-kicker">Pi Session Viewer</span>
            <span className="header-title">Explore traces, costs, exports, and comparisons</span>
          </div>
        </Link>

        <div className="header-right">
          {project && (
            <nav className="breadcrumb" aria-label="Breadcrumb">
              <Link to="/">Projects</Link>
              <span className="breadcrumb-sep">/</span>
              {session ? (
                <Link to={`/project/${parts[1]}`} title={project.detail}>
                  {project.title}
                </Link>
              ) : (
                <span className="breadcrumb-current" title={project.detail}>
                  {project.title}
                </span>
              )}
              {session && (
                <>
                  <span className="breadcrumb-sep">/</span>
                  <span className="breadcrumb-current" title={session.detail}>
                    {session.short}
                  </span>
                </>
              )}
            </nav>
          )}

          <Link
            to="/compare"
            className={`header-compare ${readyToCompare ? "header-compare-ready" : ""}`}
          >
            <span>Compare</span>
            <span className="header-compare-count">{selected.length}/2</span>
          </Link>

          <span className="header-pill">Local logs</span>
        </div>
      </div>
    </header>
  );
}
