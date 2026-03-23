import express from "express";
import { createServer as createViteServer } from "vite";
import {
  scanProjects,
  searchProjectsAndSessions,
  getSessionsForProject,
  getSessionMetadata,
  getSessionSpans,
  exportSession,
  sanitizeParam,
} from "./sessions.js";
import { readFile } from "node:fs/promises";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

// --- API Routes ---

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await scanProjects();
    res.json(projects);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();

  if (!query) {
    res.json([]);
    return;
  }

  try {
    const results = await searchProjectsAndSessions(query);
    res.json(results);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get(
  "/api/projects/:dirName/sessions/:filename/meta",
  async (req, res) => {
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

app.get(
  "/api/projects/:dirName/sessions/:filename/spans",
  async (req, res) => {
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
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

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
    } catch (err: any) {
      res
        .status(500)
        .json({ error: `Export failed: ${err.message}` });
    }
  }
);

// --- Vite Dev Server or Static Files ---

async function start() {
  if (process.env.NODE_ENV === "production") {
    app.use(express.static("dist/client"));
    // SPA fallback
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
    console.log(`Pi Session Viewer running at http://localhost:${PORT}`);
  });
}

start();
