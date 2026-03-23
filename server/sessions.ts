import { createHash } from "node:crypto";
import { readdir, readFile, stat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { exportSessionHtml, getThemeCacheToken } from "./piExport.js";

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const CACHE_DIR = join(homedir(), ".pi-session-viewer-cache");
const THEME_FILE = resolve(import.meta.dirname, "..", "themes", "tokyo-night.json");

// --- Types ---

export interface ProjectInfo {
  dirName: string;
  displayPath: string;
  sessionCount: number;
}

export interface SessionMetadata {
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

export interface TraceSpan {
  id: string;
  type: "user" | "assistant" | "tool";
  label: string;
  startMs: number;
  endMs: number;
  parentId: string | null;
  depth: number;
}

// --- Metadata cache: keyed by absolute file path, stores (mtime, metadata) ---

const metadataCache = new Map<
  string,
  { mtimeMs: number; metadata: SessionMetadata }
>();

const spanCache = new Map<
  string,
  { mtimeMs: number; spans: TraceSpan[] }
>();

const exportInflight = new Map<string, Promise<string>>();

// --- Path sanitization ---

export function sanitizeParam(param: string): string | null {
  if (param.includes("../") || param.includes("/") || param.includes("\\")) {
    return null;
  }
  return param;
}

function resolveSessionDir(dirName: string): string | null {
  const safe = sanitizeParam(dirName);
  if (!safe) return null;
  const resolved = join(SESSIONS_DIR, safe);
  if (!resolved.startsWith(SESSIONS_DIR)) return null;
  return resolved;
}

function resolveSessionFile(dirName: string, filename: string): string | null {
  const dir = resolveSessionDir(dirName);
  if (!dir) return null;
  const safeFile = sanitizeParam(filename);
  if (!safeFile) return null;
  const resolved = join(dir, safeFile);
  if (!resolved.startsWith(dir)) return null;
  return resolved;
}

// --- JSONL parsing ---

function parseJsonlLines(content: string): any[] {
  const results: any[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed lines (partial writes, active sessions)
    }
  }
  return results;
}

function readCwdFromHeader(content: string): string | null {
  const firstNewline = content.indexOf("\n");
  const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
  try {
    const header = JSON.parse(firstLine.trim());
    if (header.type === "session" && header.cwd) {
      return header.cwd;
    }
  } catch {
    // ignore
  }
  return null;
}

function aggregateMetadata(
  entries: any[],
  filename: string
): SessionMetadata {
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalCost = 0;
  let toolCalls = 0;
  let messageCount = 0;
  const models = new Set<string>();

  for (const entry of entries) {
    const ts = entry.timestamp;
    if (ts) {
      if (!firstTimestamp) firstTimestamp = ts;
      lastTimestamp = ts;
    }

    if (entry.type === "model_change" && entry.modelId) {
      models.add(entry.modelId);
    }

    if (entry.type === "message") {
      messageCount++;
      const msg = entry.message;
      if (!msg) continue;

      if (msg.role === "assistant") {
        const usage = msg.usage || {};
        inputTokens += usage.input || 0;
        outputTokens += usage.output || 0;
        cacheReadTokens += usage.cacheRead || 0;
        cacheWriteTokens += usage.cacheWrite || 0;
        const cost = usage.cost || {};
        totalCost += cost.total || 0;

        const content = msg.content || [];
        for (const block of content) {
          if (block && block.type === "toolCall") {
            toolCalls++;
          }
        }
      }
    }
  }

  const startTime = firstTimestamp ? new Date(firstTimestamp).getTime() : 0;
  const endTime = lastTimestamp ? new Date(lastTimestamp).getTime() : 0;
  const durationSeconds = Math.round((endTime - startTime) / 1000);

  const sessionTimestamp = firstTimestamp || "";

  return {
    filename,
    timestamp: sessionTimestamp,
    durationSeconds,
    models: [...models],
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalCost: Math.round(totalCost * 10000) / 10000,
    toolCalls,
    messageCount,
  };
}

// --- Span computation ---

function computeSpans(entries: any[]): TraceSpan[] {
  const spans: TraceSpan[] = [];
  let spanIdx = 0;

  const messages = entries.filter((e) => e.type === "message" && e.message);

  const firstMessageTs = messages[0]?.timestamp;
  const sessionStart = firstMessageTs
    ? new Date(firstMessageTs).getTime()
    : (entries[0]?.timestamp ? new Date(entries[0].timestamp).getTime() : 0);

  function toMs(ts: string): number {
    return new Date(ts).getTime() - sessionStart;
  }

  const toolResultTimestamps = new Map<string, number>();
  for (const entry of messages) {
    const msg = entry.message;
    if (msg.role === "toolResult" && msg.toolCallId) {
      toolResultTimestamps.set(msg.toolCallId, toMs(entry.timestamp));
    }
  }

  let i = 0;
  while (i < messages.length) {
    const entry = messages[i];
    const msg = entry.message;

    if (msg.role === "user") {
      const startMs = toMs(entry.timestamp);
      let endMs = startMs;

      if (i + 1 < messages.length && messages[i + 1].message.role === "assistant") {
        endMs = toMs(messages[i + 1].timestamp);
      }

      spans.push({
        id: `span-${spanIdx++}`,
        type: "user",
        label: "User",
        startMs,
        endMs: Math.max(endMs, startMs + 1),
        parentId: null,
        depth: 0,
      });
      i++;
      continue;
    }

    if (msg.role === "assistant") {
      const assistantStartMs = toMs(entry.timestamp);

      let assistantEndMs = assistantStartMs;
      const toolSpans: TraceSpan[] = [];
      const assistantSpanId = `span-${spanIdx++}`;

      const content = msg.content || [];
      for (const block of content) {
        if (block && block.type === "toolCall" && block.id) {
          const toolStartMs = assistantStartMs;
          const toolEndMs = toolResultTimestamps.get(block.id) ?? assistantStartMs;
          if (toolEndMs > assistantEndMs) assistantEndMs = toolEndMs;

          toolSpans.push({
            id: `span-${spanIdx++}`,
            type: "tool",
            label: block.name || "tool",
            startMs: toolStartMs,
            endMs: Math.max(toolEndMs, toolStartMs + 1),
            parentId: assistantSpanId,
            depth: 1,
          });
        }
      }

      let j = i + 1;
      while (j < messages.length) {
        const nextMsg = messages[j].message;
        if (nextMsg.role === "toolResult" || nextMsg.role === "bashExecution") {
          const ts = toMs(messages[j].timestamp);
          if (ts > assistantEndMs) assistantEndMs = ts;
          j++;
        } else {
          break;
        }
      }

      const modelLabel = msg.model
        ? `Assistant (${msg.model})`
        : "Assistant";

      spans.push({
        id: assistantSpanId,
        type: "assistant",
        label: modelLabel,
        startMs: assistantStartMs,
        endMs: Math.max(assistantEndMs, assistantStartMs + 1),
        parentId: null,
        depth: 0,
      });

      spans.push(...toolSpans);

      i = j;
      continue;
    }

    i++;
  }

  return spans;
}

// --- Public API ---

export async function scanProjects(): Promise<ProjectInfo[]> {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dirPath = join(SESSIONS_DIR, entry.name);
    const files = await readdir(dirPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl")).sort();

    if (jsonlFiles.length === 0) continue;

    let displayPath = entry.name;
    const mostRecent = jsonlFiles[jsonlFiles.length - 1];
    try {
      const content = await readFile(join(dirPath, mostRecent), "utf-8");
      const cwd = readCwdFromHeader(content);
      if (cwd) displayPath = cwd;
    } catch {
      // Fall back to directory name
    }

    projects.push({
      dirName: entry.name,
      displayPath,
      sessionCount: jsonlFiles.length,
    });
  }

  return projects.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
}

async function readSessionMetadata(filePath: string, filename: string): Promise<SessionMetadata | null> {
  try {
    const fileStat = await stat(filePath);
    const cached = metadataCache.get(filePath);

    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.metadata;
    }

    const content = await readFile(filePath, "utf-8");
    const entries = parseJsonlLines(content);
    const metadata = aggregateMetadata(entries, filename);

    metadataCache.set(filePath, {
      mtimeMs: fileStat.mtimeMs,
      metadata,
    });

    return metadata;
  } catch {
    return null;
  }
}

export async function getSessionsForProject(
  dirName: string
): Promise<SessionMetadata[] | null> {
  const dirPath = resolveSessionDir(dirName);
  if (!dirPath || !existsSync(dirPath)) return null;

  const files = await readdir(dirPath);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  const results: SessionMetadata[] = [];

  for (const filename of jsonlFiles) {
    const filePath = join(dirPath, filename);
    const metadata = await readSessionMetadata(filePath, filename);
    if (metadata) {
      results.push(metadata);
    }
  }

  return results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

export async function getSessionMetadata(
  dirName: string,
  filename: string
): Promise<SessionMetadata | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) return null;
  return readSessionMetadata(filePath, filename);
}

export async function getSessionSpans(
  dirName: string,
  filename: string
): Promise<TraceSpan[] | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) return null;

  try {
    const fileStat = await stat(filePath);
    const cached = spanCache.get(filePath);

    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.spans;
    }

    const content = await readFile(filePath, "utf-8");
    const entries = parseJsonlLines(content);
    const spans = computeSpans(entries);

    spanCache.set(filePath, { mtimeMs: fileStat.mtimeMs, spans });
    return spans;
  } catch {
    return null;
  }
}

export async function exportSession(
  dirName: string,
  filename: string
): Promise<string | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) return null;

  await mkdir(CACHE_DIR, { recursive: true });

  const [fileStat, themeCacheToken] = await Promise.all([
    stat(filePath),
    getThemeCacheToken(THEME_FILE),
  ]);

  const cacheHash = createHash("sha1")
    .update(dirName)
    .update("\0")
    .update(filename)
    .update("\0")
    .update(String(fileStat.mtimeMs))
    .update("\0")
    .update(themeCacheToken)
    .digest("hex");
  const cachedHtml = join(CACHE_DIR, `${cacheHash}.html`);

  if (existsSync(cachedHtml)) {
    return cachedHtml;
  }

  const inflight = exportInflight.get(cachedHtml);
  if (inflight) {
    return inflight;
  }

  const exportPromise = (async () => {
    await exportSessionHtml(filePath, cachedHtml, THEME_FILE);
    return cachedHtml;
  })().finally(() => {
    exportInflight.delete(cachedHtml);
  });

  exportInflight.set(cachedHtml, exportPromise);
  return exportPromise;
}
