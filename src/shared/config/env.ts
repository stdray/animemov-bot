import { existsSync, mkdirSync } from "fs";
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
  appVersion: requireEnv("APP_VERSION", { optional: true }) || "unknown"
};
