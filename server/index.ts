import express, { type Response } from "express";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { createServer as createViteServer } from "vite";
import { logger } from "./logger.js";
import {
  exportSession,
  getSessionMetadata,
  getSessionSpans,
  getSessionsForProject,
  sanitizeParam,
  scanProjects,
  searchProjectsAndSessions,
} from "./sessions.js";

const app = express();
const PORT = z.coerce
  .number()
  .int()
  .positive()
  .catch(3000)
  .parse(process.env.PORT);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendInternalError(
  res: Response,
  error: unknown,
  context: string,
): void {
  logger.error({ err: error, context }, "Request failed");
  res.status(500).json({ error: getErrorMessage(error) });
}

function getQueryString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }

  if (Array.isArray(value)) {
    const firstString = value.find((item) => typeof item === "string");
    return typeof firstString === "string" ? firstString.trim() : "";
  }

  return "";
}

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await scanProjects();
    res.json(projects);
  } catch (error) {
    sendInternalError(res, error, "list-projects");
  }
});

app.get("/api/search", async (req, res) => {
  const query = getQueryString(req.query.q);

  if (!query) {
    res.json([]);
    return;
  }

  try {
    const results = await searchProjectsAndSessions(query);
    res.json(results);
  } catch (error) {
    sendInternalError(res, error, "search-projects-and-sessions");
  }
});

app.get("/api/projects/:dirName/sessions", async (req, res) => {
  const dirName = sanitizeParam(req.params.dirName);
  if (!dirName) {
    res.status(400).json({ error: "Invalid directory name" });
    return;
  }

  try {
    const sessions = await getSessionsForProject(dirName);
    if (!sessions) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json(sessions);
  } catch (error) {
    sendInternalError(res, error, "get-project-sessions");
  }
});

app.get("/api/projects/:dirName/sessions/:filename/meta", async (req, res) => {
  const dirName = sanitizeParam(req.params.dirName);
  const filename = sanitizeParam(req.params.filename);
  if (!dirName || !filename) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  try {
    const metadata = await getSessionMetadata(dirName, filename);
    if (!metadata) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(metadata);
  } catch (error) {
    sendInternalError(res, error, "get-session-metadata");
  }
});

app.get("/api/projects/:dirName/sessions/:filename/spans", async (req, res) => {
  const dirName = sanitizeParam(req.params.dirName);
  const filename = sanitizeParam(req.params.filename);
  if (!dirName || !filename) {
    res.status(400).json({ error: "Invalid parameters" });
    return;
  }

  try {
    const spans = await getSessionSpans(dirName, filename);
    if (!spans) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(spans);
  } catch (error) {
    sendInternalError(res, error, "get-session-spans");
  }
});

app.get(
  "/api/projects/:dirName/sessions/:filename/export",
  async (req, res) => {
    const dirName = sanitizeParam(req.params.dirName);
    const filename = sanitizeParam(req.params.filename);
    if (!dirName || !filename) {
      res.status(400).json({ error: "Invalid parameters" });
      return;
    }

    try {
      const htmlPath = await exportSession(dirName, filename);
      if (!htmlPath) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const html = await readFile(htmlPath, "utf-8");
      res.type("html").send(html);
    } catch (error) {
      logger.error({ err: error, dirName, filename }, "Session export failed");
      res
        .status(500)
        .json({ error: `Export failed: ${getErrorMessage(error)}` });
    }
  },
);

async function start(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static("dist/client"));
    app.get("*", (_req, res) => {
      res.sendFile("index.html", { root: "dist/client" });
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      root: "client",
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    logger.info({ port: PORT }, "Pi Session Viewer running");
  });
}

start().catch((error) => {
  logger.fatal({ err: error }, "Failed to start server");
  process.exit(1);
});
