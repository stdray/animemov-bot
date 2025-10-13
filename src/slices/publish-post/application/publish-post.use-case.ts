import { logger } from "../../../shared/logging/logger";
import { TempFileManager } from "../../../shared/storage/temp-file-manager";
import { PublishPostCommand } from "../domain/models";
import { InvalidTweetUrlError, TwitterRateLimitError } from "../domain/errors";
import { TwitterMediaDownloader } from "../infrastructure/twitter-media-downloader";
import { TelegramChannelPublisher } from "../infrastructure/telegram-channel-publisher";

type QueueJob = {
  command: PublishPostCommand;
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class PublishPostUseCase {
  readonly queue: QueueJob[] = [];
  processing = false;
  nextAvailableAt = 0;
  readonly twitterDownloader: TwitterMediaDownloader;
  readonly channelPublisher: TelegramChannelPublisher;
  readonly tempFiles: TempFileManager;

  constructor(
    twitterDownloader: TwitterMediaDownloader,
    channelPublisher: TelegramChannelPublisher,
    tempFiles: TempFileManager
  ) {
    this.twitterDownloader = twitterDownloader;
    this.channelPublisher = channelPublisher;
    this.tempFiles = tempFiles;
  }

  async execute(command: PublishPostCommand) {
    this.validate(command);

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ command, resolve, reject });
      logger.debug("Задача публикации поставлена в очередь", {
        requesterId: command.requesterId,
        queueLength: this.queue.length
      });
      void this.processQueue().catch((error) => {
        logger.error("Ошибка обработки очереди публикаций", { error });
      });
    });
  }

  validate(command: PublishPostCommand) {
    if (!command.tweetUrl || !/^https?:\/\//.test(command.tweetUrl)) {
      throw new InvalidTweetUrlError();
    }
    if (command.userText.trim().length === 0) {
      logger.warn("Пустой пользовательский текст", { requesterId: command.requesterId });
    }
  }

  async processQueue() {
    if (this.processing) {
      return;
    }
    this.processing = true;

    while (this.queue.length > 0) {
      const job = this.queue[0];
      const now = Date.now();
      const waitFor = this.nextAvailableAt - now;
      if (waitFor > 0) {
        logger.warn("Ожидание окна после rate limit", { waitMs: waitFor, queueLength: this.queue.length });
        await this.delay(waitFor);
        continue;
      } else {
        this.nextAvailableAt = 0;
      }

      try {
        await this.runJob(job.command);
        job.resolve();
        this.queue.shift();
      } catch (error) {
        if (error instanceof TwitterRateLimitError) {
          this.nextAvailableAt = Math.max(this.nextAvailableAt, error.retryAt);
          logger.warn("Запрос отложен из-за rate limit", {
            requesterId: job.command.requesterId,
            retryAt: this.nextAvailableAt
          });
          continue;
        }

        job.reject(error);
        this.queue.shift();
      }
    }

    this.processing = false;
  }

  async runJob(command: PublishPostCommand) {
    logger.info("Начало публикации поста", { requesterId: command.requesterId });
    const media = await this.twitterDownloader.download(command.tweetUrl);

    try {
      await this.channelPublisher.publish(media, command.userText, command.tweetUrl);
      logger.info("Публикация завершена", { requesterId: command.requesterId });
    } finally {
      await this.tempFiles.cleanup(media.map((item) => item.filePath));
    }
  }

  async delay(ms: number) {
    if (ms <= 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
