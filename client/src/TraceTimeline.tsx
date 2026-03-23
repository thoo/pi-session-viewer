import { useMemo, useState } from "react";

interface TraceSpan {
  id: string;
  type: "user" | "assistant" | "tool";
  label: string;
  startMs: number;
  endMs: number;
  parentId: string | null;
  depth: number;
}

interface Turn {
  parent: TraceSpan;
  children: TraceSpan[];
  durationMs: number;
}

interface Step {
  label: string;
  type: "user" | "assistant" | "tool";
  startMs: number;
  endMs: number;
  durationMs: number;
}

interface UserQuery {
  userTurn: Turn | null;
  assistantTurns: Turn[];
  totalDurationMs: number;
  steps: Step[];
}

const COLORS: Record<string, { bg: string; border: string; dot: string; text: string; barBg: string }> = {
  user: {
    bg: "var(--color-user-bg)",
    border: "var(--color-user)",
    dot: "var(--color-user)",
    text: "var(--color-user)",
    barBg: "linear-gradient(90deg, rgba(122,162,247,0.28), rgba(122,162,247,0.08))",
  },
  assistant: {
    bg: "var(--color-assistant-bg)",
    border: "var(--color-assistant)",
    dot: "var(--color-assistant)",
    text: "var(--color-assistant)",
    barBg: "linear-gradient(90deg, rgba(115,218,202,0.28), rgba(115,218,202,0.08))",
  },
  tool: {
    bg: "var(--color-tool-bg)",
    border: "var(--color-tool)",
    dot: "var(--color-tool)",
    text: "var(--color-tool)",
    barBg: "linear-gradient(90deg, rgba(224,175,104,0.28), rgba(224,175,104,0.08))",
  },
};

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function getModelShort(label: string): string {
  const match = label.match(/\((.+)\)/);
  return match ? match[1] : "";
}

function compactLabel(label: string, max = 76) {
  const normalized = label.replace(/\s+/g, " ").trim();
  if (!normalized) return "Turn";
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function groupIntoTurns(spans: TraceSpan[]): Turn[] {
  const turns: Turn[] = [];
  let currentTurn: Turn | null = null;

  for (const span of spans) {
    if (span.depth === 0) {
      currentTurn = {
        parent: span,
        children: [],
        durationMs: span.endMs - span.startMs,
      };
      turns.push(currentTurn);
    } else if (currentTurn) {
      currentTurn.children.push(span);
    }
  }

  return turns;
}

function groupIntoUserQueries(turns: Turn[]): UserQuery[] {
  const queries: UserQuery[] = [];
  let current: UserQuery | null = null;

  for (const turn of turns) {
    if (turn.parent.type === "user") {
      current = {
        userTurn: turn,
        assistantTurns: [],
        totalDurationMs: 0,
        steps: [],
      };
      queries.push(current);
    } else {
      if (!current) {
        current = {
          userTurn: null,
          assistantTurns: [],
          totalDurationMs: 0,
          steps: [],
        };
        queries.push(current);
      }
      current.assistantTurns.push(turn);
    }
  }

  for (const query of queries) {
    const queryStartMs = query.userTurn
      ? query.userTurn.parent.startMs
      : query.assistantTurns[0]?.parent.startMs ?? 0;

    let prevEndMs = query.userTurn ? query.userTurn.parent.endMs : queryStartMs;

    for (const turn of query.assistantTurns) {
      const model = getModelShort(turn.parent.label);

      const llmStart = prevEndMs;
      const llmEnd = turn.parent.startMs;
      if (llmEnd - llmStart > 0) {
        const start = llmStart - queryStartMs;
        const end = llmEnd - queryStartMs;
        query.steps.push({
          label: model ? `llm (${model})` : "llm",
          type: "assistant",
          startMs: start,
          endMs: end,
          durationMs: end - start,
        });
      }

      if (turn.children.length === 0) {
        const start = turn.parent.startMs - queryStartMs;
        const end = turn.parent.endMs - queryStartMs;
        query.steps.push({
          label: model ? `response (${model})` : "response",
          type: "assistant",
          startMs: start,
          endMs: end,
          durationMs: end - start,
        });
        prevEndMs = turn.parent.endMs;
      } else {
        for (const child of turn.children) {
          const start = child.startMs - queryStartMs;
          const end = child.endMs - queryStartMs;
          query.steps.push({
            label: model ? `${child.label} (${model})` : child.label,
            type: "tool",
            startMs: start,
            endMs: end,
            durationMs: end - start,
          });
        }
        prevEndMs = Math.max(...turn.children.map((child) => child.endMs));
      }
    }

    if (query.steps.length > 0) {
      query.totalDurationMs = Math.max(...query.steps.map((step) => step.endMs), 1);
    }
  }

  return queries;
}

function logScale(ms: number, maxLog: number): number {
  if (ms <= 0) return 0.5;
  return Math.max((Math.log(ms + 1) / maxLog) * 100, 0.5);
}

function getTimeTicks(totalMs: number): number[] {
  if (totalMs <= 0) return [];
  const candidates = [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000, 300000, 600000];
  let step = candidates[candidates.length - 1];
  for (const candidate of candidates) {
    if (totalMs / candidate <= 8) {
      step = candidate;
      break;
    }
  }
  const ticks: number[] = [];
  for (let t = 0; t <= totalMs; t += step) {
    ticks.push(t);
  }
  if (ticks[ticks.length - 1] !== totalMs) {
    ticks.push(totalMs);
  }
  return ticks;
}

export function TraceTimeline({
  spans,
  loading,
  error,
}: {
  spans: TraceSpan[];
  loading: boolean;
  error: string | null;
}) {
  const [traceOpen, setTraceOpen] = useState(true);

  const summary = useMemo(() => {
    const totalMs = spans.length > 0 ? Math.max(...spans.map((span) => span.endMs), 1) : 0;
    const turns = groupIntoTurns(spans);
    const queries = groupIntoUserQueries(turns);
    const assistantSteps = queries.flatMap((query) => query.steps).filter((step) => step.type === "assistant").length;
    const toolSteps = queries.flatMap((query) => query.steps).filter((step) => step.type === "tool").length;
    const maxLogDuration = Math.log(Math.max(...queries.map((query) => query.totalDurationMs), 1) + 1);

    return {
      totalMs,
      queries,
      assistantSteps,
      toolSteps,
      maxLogDuration,
    };
  }, [spans]);

  if (loading) {
    return (
      <div className="trace-container">
        <div className="trace-status-msg loading-pulse">Loading trace data…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="trace-container">
        <div className="trace-status-msg" style={{ color: "var(--color-error)" }}>
          Trace error: {error}
        </div>
      </div>
    );
  }

  if (spans.length === 0) {
    return (
      <div className="trace-container">
        <div className="trace-status-msg">No trace data available.</div>
      </div>
    );
  }

  return (
    <div className="trace-container">
      <div
        className="trace-header trace-header-clickable"
        onClick={() => setTraceOpen((open) => !open)}
      >
        <div className="trace-header-left">
          <span className={`trace-chevron ${traceOpen ? "trace-chevron-open" : ""}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path
                d="M3 1.5L7 5L3 8.5"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div className="trace-title-group">
            <span className="trace-title">Session trace</span>
            <span className="trace-turn-count">
              {summary.queries.length} turn{summary.queries.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        <div className="trace-header-right">
          <div className="trace-legend">
            <div className="trace-legend-item">
              <div className="trace-legend-swatch" style={{ background: COLORS.assistant.border }} />
              <span>{summary.assistantSteps} LLM</span>
            </div>
            <div className="trace-legend-item">
              <div className="trace-legend-swatch" style={{ background: COLORS.tool.border }} />
              <span>{summary.toolSteps} tools</span>
            </div>
          </div>
          <span className="trace-total-duration">{formatMs(summary.totalMs)}</span>
        </div>
      </div>

      {traceOpen && (
        <div className="trace-turns">
          {summary.queries.map((query, index) => (
            <UserQueryRow
              key={index}
              query={query}
              index={index}
              maxLogDuration={summary.maxLogDuration}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UserQueryRow({
  query,
  index,
  maxLogDuration,
}: {
  query: UserQuery;
  index: number;
  maxLogDuration: number;
}) {
  const [expanded, setExpanded] = useState(index === 0);
  const { totalDurationMs, steps } = query;
  const totalWidthPct = logScale(totalDurationMs, maxLogDuration);
  const hasSteps = steps.length > 0;
  const ticks = expanded ? getTimeTicks(totalDurationMs) : [];
  const toolSteps = steps.filter((step) => step.type === "tool").length;
  const llmSteps = steps.filter((step) => step.type === "assistant").length;
  const label = compactLabel(query.userTurn?.parent.label || `Turn ${index + 1}`);

  return (
    <div className={`query-group ${expanded ? "query-group-expanded" : ""}`}>
      <div
        className={`turn-row turn-row-summary ${hasSteps ? "turn-row-clickable" : ""}`}
        onClick={() => hasSteps && setExpanded((open) => !open)}
      >
        <div className="turn-label">
          <span className="turn-index">{index + 1}</span>
          {hasSteps && (
            <span className={`turn-chevron ${expanded ? "turn-chevron-open" : ""}`}>
              <svg width="8" height="8" viewBox="0 0 10 10" fill="currentColor">
                <path
                  d="M3 1.5L7 5L3 8.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          )}

          <div className="turn-text-group">
            <span className="turn-name">{label}</span>
            <span className="turn-summary-meta">
              {llmSteps} LLM · {toolSteps} tools
            </span>
          </div>
        </div>

        <div className="turn-bar-area">
          <WaterfallBar query={query} widthPct={totalWidthPct} />
        </div>

        <div className="turn-duration">{formatMs(totalDurationMs)}</div>
      </div>

      {expanded && (
        <div className="tl-panel">
          <div className="tl-axis-row">
            <div className="tl-label-col">
              <span className="tl-axis-caption">relative time</span>
            </div>
            <div className="tl-ruler">
              {ticks.map((tick, i) => (
                <div
                  key={tick}
                  className="tl-ruler-tick"
                  style={{ left: `${(tick / totalDurationMs) * 100}%` }}
                >
                  <div className="tl-ruler-mark" />
                  {i > 0 && <span className="tl-ruler-label">{formatMs(tick)}</span>}
                </div>
              ))}
              <div className="tl-ruler-baseline" />
            </div>
            <div className="tl-dur-col" />
          </div>

          {steps.map((step, i) => {
            const color = COLORS[step.type];
            const leftPct = (step.startMs / totalDurationMs) * 100;
            const widthPct = Math.max((step.durationMs / totalDurationMs) * 100, 0.3);
            return (
              <div
                key={`${step.label}-${i}`}
                className={`tl-row ${i % 2 === 0 ? "tl-row-even" : ""}`}
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <div className="tl-label-col" title={step.label}>
                  <span className="tl-dot" style={{ background: color.dot }} />
                  <span className="tl-step-name">{step.label}</span>
                </div>

                <div className="tl-chart">
                  {ticks.map((tick) => (
                    <div
                      key={tick}
                      className="tl-gridline"
                      style={{ left: `${(tick / totalDurationMs) * 100}%` }}
                    />
                  ))}

                  <div
                    className="tl-bar"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      borderColor: color.border,
                      background: color.barBg,
                    }}
                    title={`${step.label}: ${formatMs(step.durationMs)} (${formatMs(step.startMs)} → ${formatMs(step.endMs)})`}
                  >
                    <div className="tl-bar-glow" style={{ background: color.border }} />
                    {widthPct > 8 && (
                      <span className="tl-bar-label" style={{ color: color.border }}>
                        {formatMs(step.durationMs)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="tl-dur" style={{ color: color.text }}>
                  {formatMs(step.durationMs)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WaterfallBar({ query, widthPct }: { query: UserQuery; widthPct: number }) {
  const { steps, totalDurationMs } = query;
  if (totalDurationMs <= 0 || steps.length === 0) return null;

  return (
    <div className="waterfall-track" style={{ width: `${widthPct}%` }}>
      {steps.map((step, i) => {
        const leftPct = (step.startMs / totalDurationMs) * 100;
        const width = Math.max((step.durationMs / totalDurationMs) * 100, 0.3);
        const color = COLORS[step.type];

        return (
          <div
            key={`${step.label}-${i}`}
            className="waterfall-segment"
            style={{
              left: `${leftPct}%`,
              width: `${width}%`,
              background: color.bg,
              borderColor: color.border,
            }}
            title={`${step.label}: ${formatMs(step.durationMs)}`}
          />
        );
      })}
    </div>
  );
}
