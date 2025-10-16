import "dotenv/config";
import { Bot } from "grammy";
import { env } from "../shared/config/env";
import { logger } from "../shared/logging/logger";
import { TempFileManager } from "../shared/storage/temp-file-manager";
import { TwitterMediaDownloader } from "../slices/publish-post/infrastructure/twitter-media-downloader";
import { TelegramChannelPublisher } from "../slices/publish-post/infrastructure/telegram-channel-publisher";
import { PublishPostUseCase } from "../slices/publish-post/application/publish-post.use-case";
import { registerPublishPostHandler } from "../slices/publish-post/presentation/telegram-handler";
import { PublishPostQueue } from "../slices/publish-post/infrastructure/publish-post-queue";

async function bootstrap() {
  const bot = new Bot(env.telegramBotToken);

  const tempFiles = new TempFileManager();
  const twitterDownloader = new TwitterMediaDownloader(tempFiles);
  const telegramPublisher = new TelegramChannelPublisher(bot.api);
  const queue = new PublishPostQueue(env.queueDbPath);
  const publishPostUseCase = new PublishPostUseCase(twitterDownloader, telegramPublisher, tempFiles, queue);

  logger.info("Инициализация бота", { version: env.appVersion });

  registerPublishPostHandler(bot, publishPostUseCase);

  bot.catch((err) => {
    logger.error("Необработанная ошибка Telegram", { error: err.error });
  });

  const me = await bot.api.getMe();
  logger.info("Бот авторизован", { username: me.username });
  logger.info("Версия бота", { version: env.appVersion, username: me.username });
  await bot.start();
}

bootstrap().catch((error) => {
  logger.error("Критическая ошибка при запуске бота", { error });
  process.exitCode = 1;
});
