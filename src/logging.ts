/**
 * Single-line JSON logs for grep/agents/aggregators. All notification pipeline code should use this.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const SERVICE = "discord-fantasy-bot";

export function logRecord(level: LogLevel, msg: string, fields: Record<string, unknown> = {}): void {
  const rec: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: SERVICE,
    ...fields,
  };
  const line = JSON.stringify(rec);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => logRecord("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => logRecord("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => logRecord("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => logRecord("error", msg, fields),
};
