import { existsSync, mkdirSync, readFileSync } from "fs";
import path from "path";

const requireEnv = (key: string, { optional = false }: { optional?: boolean } = {}) => {
  const value = process.env[key];
  if (!value && !optional) {
    throw new Error(`Отсутствует обязательная переменная окружения ${key}`);
  }
  return value ?? "";
};

const tempDir = process.env["TEMP_DIR"] ?? path.resolve(".tmp");
if (!existsSync(tempDir)) {
  mkdirSync(tempDir, { recursive: true });
}

const defaultQueueDbPath = process.env["QUEUE_DB_PATH"] ?? path.resolve(tempDir, "queue.sqlite");

const fallbackVersion = (() => {
  const pkgPath = path.resolve("package.json");
  if (!existsSync(pkgPath)) {
    return "unknown";
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.version === "string" && pkg.version.trim().length > 0 ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

const appVersionValue = (() => {
  const fromEnv = process.env["APP_VERSION"]?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return fallbackVersion;
})();

export const env = {
  telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
  telegramTargetChannelId: requireEnv("TELEGRAM_TARGET_CHANNEL_ID"),
  twitterCredentials: {
    accessSecret: requireEnv("TWITTER_ACCESS_SECRET"),
    accessToken: requireEnv("TWITTER_ACCESS_TOKEN"),
    consumerSecret: requireEnv("TWITTER_CONSUMER_SECRET"),
    consumerKey: requireEnv("TWITTER_CONSUMER_KEY")
  },
  twitterProxyUrl: requireEnv("TWITTER_PROXY_URL"),
  tempDir,
  queueDbPath: defaultQueueDbPath,
  appVersion: appVersionValue
};
