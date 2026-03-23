import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import {
  aggregateMetadata,
  computeSpans,
  normalizeSearchText,
  parseJsonlLines,
  readCwdFromHeader,
  type SessionMetadata,
  type TraceSpan,
} from "./sessionCore.js";
import { exportSessionHtml, getThemeCacheToken } from "./piExport.js";

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");
const CACHE_DIR = join(homedir(), ".pi-session-viewer-cache");
const THEME_FILE = resolve(
  import.meta.dirname,
  "..",
  "themes",
  "tokyo-night.json",
);

export type { SessionMetadata, TraceSpan } from "./sessionCore.js";

export interface ProjectInfo {
  dirName: string;
  displayPath: string;
  sessionCount: number;
}

export interface SessionSearchMatch {
  filename: string;
  timestamp: string;
  models: string[];
}

export interface ProjectSearchResult extends ProjectInfo {
  projectMatches: boolean;
  matchingSessions: SessionSearchMatch[];
  totalSessionMatches: number;
}

const metadataCache = new Map<
  string,
  { mtimeMs: number; metadata: SessionMetadata }
>();
const spanCache = new Map<string, { mtimeMs: number; spans: TraceSpan[] }>();
const exportInflight = new Map<string, Promise<string>>();

export function sanitizeParam(param: string): string | null {
  if (param.includes("../") || param.includes("/") || param.includes("\\")) {
    return null;
  }
  return param;
}

function resolveSessionDir(dirName: string): string | null {
  const safe = sanitizeParam(dirName);
  if (!safe) {
    return null;
  }

  const resolved = join(SESSIONS_DIR, safe);
  return resolved.startsWith(SESSIONS_DIR) ? resolved : null;
}

function resolveSessionFile(dirName: string, filename: string): string | null {
  const dir = resolveSessionDir(dirName);
  if (!dir) {
    return null;
  }

  const safeFile = sanitizeParam(filename);
  if (!safeFile) {
    return null;
  }

  const resolved = join(dir, safeFile);
  return resolved.startsWith(dir) ? resolved : null;
}

export async function scanProjects(): Promise<ProjectInfo[]> {
  if (!existsSync(SESSIONS_DIR)) {
    return [];
  }

  const entries = await readdir(SESSIONS_DIR, { withFileTypes: true });
  const projects: ProjectInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = join(SESSIONS_DIR, entry.name);
    const files = await readdir(dirPath);
    const jsonlFiles = files.filter((file) => file.endsWith(".jsonl")).sort();

    if (jsonlFiles.length === 0) {
      continue;
    }

    let displayPath = entry.name;
    const mostRecent = jsonlFiles[jsonlFiles.length - 1];

    try {
      const content = await readFile(join(dirPath, mostRecent), "utf-8");
      const cwd = readCwdFromHeader(content);
      if (cwd) {
        displayPath = cwd;
      }
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

export async function searchProjectsAndSessions(
  query: string,
): Promise<ProjectSearchResult[]> {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const projects = await scanProjects();
  const results: ProjectSearchResult[] = [];

  for (const project of projects) {
    const projectLabel = basename(project.displayPath) || project.displayPath;
    const projectMatches = normalizeSearchText(
      `${project.displayPath}\n${project.dirName}\n${projectLabel}`,
    ).includes(normalizedQuery);

    const dirPath = resolveSessionDir(project.dirName);
    if (!dirPath || !existsSync(dirPath)) {
      continue;
    }

    const files = await readdir(dirPath);
    const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));
    const matchingSessions: SessionSearchMatch[] = [];

    for (const filename of jsonlFiles) {
      const baseName = filename.replace(/\.jsonl$/, "");
      const sessionMatches = normalizeSearchText(
        `${filename}\n${baseName}`,
      ).includes(normalizedQuery);

      if (!sessionMatches) {
        continue;
      }

      const metadata = await readSessionMetadata(join(dirPath, filename), filename);
      matchingSessions.push({
        filename,
        timestamp: metadata?.timestamp ?? "",
        models: metadata?.models ?? [],
      });
    }

    matchingSessions.sort((a, b) => {
      const timeDiff =
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      if (Number.isFinite(timeDiff) && timeDiff !== 0) {
        return timeDiff;
      }
      return a.filename.localeCompare(b.filename);
    });

    if (!projectMatches && matchingSessions.length === 0) {
      continue;
    }

    results.push({
      ...project,
      projectMatches,
      matchingSessions: matchingSessions.slice(0, 12),
      totalSessionMatches: matchingSessions.length,
    });
  }

  return results.sort((a, b) => {
    if (a.projectMatches !== b.projectMatches) {
      return a.projectMatches ? -1 : 1;
    }
    if (a.totalSessionMatches !== b.totalSessionMatches) {
      return b.totalSessionMatches - a.totalSessionMatches;
    }
    return a.displayPath.localeCompare(b.displayPath);
  });
}

async function readSessionMetadata(
  filePath: string,
  filename: string,
): Promise<SessionMetadata | null> {
  try {
    const fileStat = await stat(filePath);
    const cached = metadataCache.get(filePath);

    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.metadata;
    }

    const content = await readFile(filePath, "utf-8");
    const entries = parseJsonlLines(content);
    const metadata = aggregateMetadata(entries, filename);

    metadataCache.set(filePath, { mtimeMs: fileStat.mtimeMs, metadata });
    return metadata;
  } catch {
    return null;
  }
}

export async function getSessionsForProject(
  dirName: string,
): Promise<SessionMetadata[] | null> {
  const dirPath = resolveSessionDir(dirName);
  if (!dirPath || !existsSync(dirPath)) {
    return null;
  }

  const files = await readdir(dirPath);
  const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));
  const results: SessionMetadata[] = [];

  for (const filename of jsonlFiles) {
    const metadata = await readSessionMetadata(join(dirPath, filename), filename);
    if (metadata) {
      results.push(metadata);
    }
  }

  return results.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

export async function getSessionMetadata(
  dirName: string,
  filename: string,
): Promise<SessionMetadata | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  return readSessionMetadata(filePath, filename);
}

export async function getSessionSpans(
  dirName: string,
  filename: string,
): Promise<TraceSpan[] | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

  try {
    const fileStat = await stat(filePath);
    const cached = spanCache.get(filePath);

    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return cached.spans;
    }

    const content = await readFile(filePath, "utf-8");
    const spans = computeSpans(parseJsonlLines(content));

    spanCache.set(filePath, { mtimeMs: fileStat.mtimeMs, spans });
    return spans;
  } catch {
    return null;
  }
}

export async function exportSession(
  dirName: string,
  filename: string,
): Promise<string | null> {
  const filePath = resolveSessionFile(dirName, filename);
  if (!filePath || !existsSync(filePath)) {
    return null;
  }

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
