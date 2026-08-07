import pino, { type Logger } from "pino";

export enum LoggerModule {
  General = "general",
  Crud = "crud",
  Ai = "ai",
  Jobs = "jobs",
}

const base = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: ["email", "*.email", "*.token", "*.apiKey", "*.password"],
    censor: "[redacted]",
  },
});

/** Structured JSON logs. Pipe dev output through `npx pino-pretty` if you want colour. */
export function getLogger(opts: { module: LoggerModule }): Logger {
  return base.child({ module: opts.module });
}

export type { Logger };
