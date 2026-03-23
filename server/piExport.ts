import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { logger } from "./logger.js";
import {
  patchExportHtml,
  resolveThemeColorValue,
  sanitizeToken,
  type ThemeExportColors,
} from "./piExportCore.js";

interface ThemeConfig {
  name?: string;
  colors: ThemeExportColors;
  cacheToken: string;
}

type PiTheme = {
  name?: string;
  sourcePath?: string;
};

interface PiInternals {
  exportFromFile: (
    inputPath: string,
    options?: { outputPath?: string; themeName?: string } | string,
  ) => Promise<string>;
  loadThemeFromPath: (themePath: string, mode?: string) => PiTheme;
  setRegisteredThemes: (themes: PiTheme[]) => void;
  initTheme?: (themeName?: string, enableWatcher?: boolean) => void;
}

const themeColorValueSchema = z.union([z.string(), z.number()]);
const themeFileSchema = z.object({
  name: z.string().optional(),
  vars: z.record(z.string(), themeColorValueSchema).optional(),
  export: z
    .object({
      pageBg: themeColorValueSchema.optional(),
      cardBg: themeColorValueSchema.optional(),
      infoBg: themeColorValueSchema.optional(),
    })
    .optional(),
});
const packageJsonSchema = z.object({
  name: z.string().optional(),
});

const themeConfigCache = new Map<
  string,
  { mtimeMs: number; config: ThemeConfig }
>();
let piInternalsPromise: Promise<PiInternals> | null = null;

export async function getThemeCacheToken(themePath: string): Promise<string> {
  const config = await readThemeConfig(themePath);
  return config.cacheToken;
}

export async function exportSessionHtml(
  inputPath: string,
  outputPath: string,
  themePath: string,
): Promise<void> {
  const themeConfig = await readThemeConfig(themePath);

  try {
    await exportViaPiInternals(inputPath, outputPath, themePath, themeConfig);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(
      { err: error },
      `Pi export API unavailable, falling back to CLI export: ${message}`,
    );
    await exportViaCliFallback(inputPath, outputPath);
  }

  const html = await readFile(outputPath, "utf-8");
  const patchedHtml = patchExportHtml(html, themeConfig.colors);
  if (patchedHtml !== html) {
    await writeFile(outputPath, patchedHtml, "utf-8");
  }
}

async function readThemeConfig(themePath: string): Promise<ThemeConfig> {
  if (!existsSync(themePath)) {
    return {
      name: undefined,
      colors: {},
      cacheToken: "theme-missing",
    };
  }

  const fileStat = await stat(themePath);
  const cached = themeConfigCache.get(themePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.config;
  }

  const content = await readFile(themePath, "utf-8");
  const rawTheme: unknown = JSON.parse(content);
  const parsedTheme = themeFileSchema.safeParse(rawTheme);

  if (!parsedTheme.success) {
    const fallbackName = basename(themePath, ".json");
    logger.warn(
      { themePath, issues: parsedTheme.error.issues },
      "Invalid theme config, using defaults",
    );

    const fallbackConfig: ThemeConfig = {
      name: fallbackName,
      colors: {},
      cacheToken: `${sanitizeToken(fallbackName)}_${fileStat.mtimeMs}_invalid`,
    };

    themeConfigCache.set(themePath, {
      mtimeMs: fileStat.mtimeMs,
      config: fallbackConfig,
    });
    return fallbackConfig;
  }

  const json = parsedTheme.data;
  const vars = json.vars ?? {};
  const name = json.name ?? basename(themePath, ".json");
  const config: ThemeConfig = {
    name,
    colors: {
      pageBg: resolveThemeColorValue(json.export?.pageBg, vars),
      cardBg: resolveThemeColorValue(json.export?.cardBg, vars),
      infoBg: resolveThemeColorValue(json.export?.infoBg, vars),
    },
    cacheToken: `${sanitizeToken(name)}_${fileStat.mtimeMs}`,
  };

  themeConfigCache.set(themePath, { mtimeMs: fileStat.mtimeMs, config });
  return config;
}

async function exportViaPiInternals(
  inputPath: string,
  outputPath: string,
  themePath: string,
  themeConfig: ThemeConfig,
): Promise<void> {
  const pi = await loadPiInternals();
  const options: { outputPath: string; themeName?: string } = { outputPath };

  if (themeConfig.name && existsSync(themePath)) {
    const loadedTheme = pi.loadThemeFromPath(themePath);
    pi.setRegisteredThemes([loadedTheme]);
    pi.initTheme?.(themeConfig.name, false);
    options.themeName = themeConfig.name;
  }

  await pi.exportFromFile(inputPath, options);
}

async function exportViaCliFallback(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const tempDir = await mkdtemp(join(tmpdir(), "pi-session-viewer-export-"));

  try {
    const { code, stdout, stderr } = await runProcess(
      "pi",
      ["--export", inputPath],
      { cwd: tempDir, timeoutMs: 60_000 },
    );

    if (code !== 0) {
      throw new Error(
        `pi --export exited with code ${code}: ${stderr || stdout}`,
      );
    }

    const generatedPath = await findGeneratedHtml(tempDir, stdout);
    const html = await readFile(generatedPath, "utf-8");
    await writeFile(outputPath, html, "utf-8");
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function findGeneratedHtml(dir: string, stdout: string): Promise<string> {
  const match = stdout.match(/Exported to:\s*(.+)/);
  if (match) {
    const reportedPath = join(dir, match[1].trim());
    if (existsSync(reportedPath)) {
      return reportedPath;
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const htmlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => join(dir, entry.name))
    .sort();

  if (htmlFiles.length === 1) {
    return htmlFiles[0];
  }

  if (htmlFiles.length > 1) {
    return htmlFiles[htmlFiles.length - 1];
  }

  throw new Error(
    "Export completed but HTML file was not found in fallback directory",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPiExportModule(
  value: unknown,
): value is { exportFromFile: PiInternals["exportFromFile"] } {
  return isRecord(value) && typeof value.exportFromFile === "function";
}

function isPiThemeModule(
  value: unknown,
): value is {
  loadThemeFromPath: PiInternals["loadThemeFromPath"];
  setRegisteredThemes: PiInternals["setRegisteredThemes"];
  initTheme?: PiInternals["initTheme"];
} {
  return (
    isRecord(value) &&
    typeof value.loadThemeFromPath === "function" &&
    typeof value.setRegisteredThemes === "function" &&
    (value.initTheme === undefined || typeof value.initTheme === "function")
  );
}

async function loadPiInternals(): Promise<PiInternals> {
  if (!piInternalsPromise) {
    piInternalsPromise = (async () => {
      const packageRoot = await resolvePiPackageRoot();
      const exportModulePath = join(
        packageRoot,
        "dist",
        "core",
        "export-html",
        "index.js",
      );
      const themeModulePath = join(
        packageRoot,
        "dist",
        "modes",
        "interactive",
        "theme",
        "theme.js",
      );

      if (!existsSync(exportModulePath) || !existsSync(themeModulePath)) {
        throw new Error(
          "Pi export internals were not found in the installed package",
        );
      }

      const exportModulePromise: Promise<unknown> = import(
        pathToFileURL(exportModulePath).href,
      );
      const themeModulePromise: Promise<unknown> = import(
        pathToFileURL(themeModulePath).href,
      );
      const rawExportModule = await exportModulePromise;
      const rawThemeModule = await themeModulePromise;

      if (!isPiExportModule(rawExportModule)) {
        throw new Error("Pi export module does not expose exportFromFile()");
      }
      if (!isPiThemeModule(rawThemeModule)) {
        throw new Error(
          "Pi theme module does not expose the required theme APIs",
        );
      }

      return {
        exportFromFile: rawExportModule.exportFromFile,
        loadThemeFromPath: rawThemeModule.loadThemeFromPath,
        setRegisteredThemes: rawThemeModule.setRegisteredThemes,
        initTheme: rawThemeModule.initTheme,
      } satisfies PiInternals;
    })().catch((error) => {
      piInternalsPromise = null;
      throw error;
    });
  }

  return piInternalsPromise;
}

async function resolvePiPackageRoot(): Promise<string> {
  const candidates: string[] = [];

  const binaryPath = await resolvePiBinaryPath().catch(() => null);
  if (binaryPath) {
    const realBinaryPath = await realpath(binaryPath).catch(() => binaryPath);
    for (const candidate of walkUpDirectories(dirname(realBinaryPath))) {
      candidates.push(candidate);
    }
  }

  const globalModulesRoot = await resolveGlobalNodeModulesRoot().catch(
    () => null,
  );
  if (globalModulesRoot) {
    candidates.push(join(globalModulesRoot, "@mariozechner", "pi-coding-agent"));
  }

  for (const candidate of dedupe(candidates)) {
    if (await isPiPackageRoot(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not locate the globally installed Pi package");
}

async function resolvePiBinaryPath(): Promise<string> {
  const locator = process.platform === "win32" ? "where" : "which";
  const { code, stdout, stderr } = await runProcess(locator, ["pi"], {
    timeoutMs: 10_000,
  });

  if (code !== 0) {
    throw new Error(stderr || stdout || "Failed to locate pi binary");
  }

  const firstLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    throw new Error("pi binary was not found on PATH");
  }

  return firstLine;
}

async function resolveGlobalNodeModulesRoot(): Promise<string> {
  const { code, stdout, stderr } = await runProcess("npm", ["root", "-g"], {
    timeoutMs: 10_000,
  });

  if (code !== 0) {
    throw new Error(stderr || stdout || "npm root -g failed");
  }

  return stdout.trim();
}

async function isPiPackageRoot(candidate: string): Promise<boolean> {
  const packageJsonPath = join(candidate, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const rawPackageJson: unknown = JSON.parse(
      await readFile(packageJsonPath, "utf-8"),
    );
    const parsedPackageJson = packageJsonSchema.safeParse(rawPackageJson);
    return (
      parsedPackageJson.success &&
      parsedPackageJson.data.name === "@mariozechner/pi-coding-agent"
    );
  } catch {
    return false;
  }
}

function walkUpDirectories(startDir: string): string[] {
  const dirs: string[] = [];
  let current = startDir;

  while (true) {
    dirs.push(current);
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return dirs;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let finished = false;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
      }
    };

    const finish = (result: {
      code: number;
      stdout: string;
      stderr: string;
    }) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      resolve(result);
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (error) => {
      if (finished) {
        return;
      }
      finished = true;
      cleanup();
      reject(error);
    });

    proc.on("close", (code) => {
      finish({ code: code ?? -1, stdout, stderr });
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (finished) {
            return;
          }
          finished = true;
          proc.kill();
          reject(
            new Error(`${command} timed out after ${options.timeoutMs}ms`),
          );
        }, options.timeoutMs)
      : undefined;
  });
}
