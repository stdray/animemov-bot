export type LogLevel = "debug" | "info" | "warn" | "error";

const format = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (!meta || Object.keys(meta).length === 0) {
    return base;
  }
  return `${base} ${JSON.stringify(meta)}`;
};

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    console.debug(format("debug", message, meta)),
  info: (message: string, meta?: Record<string, unknown>) =>
    console.info(format("info", message, meta)),
  warn: (message: string, meta?: Record<string, unknown>) =>
    console.warn(format("warn", message, meta)),
  error: (message: string, meta?: Record<string, unknown>) =>
    console.error(format("error", message, meta))
};
