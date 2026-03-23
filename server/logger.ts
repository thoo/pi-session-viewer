import pino from "pino";

export const logger = pino({
  name: "pi-session-viewer",
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "production" ? "info" : "debug"),
});
