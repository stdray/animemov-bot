import { logger } from "../../../shared/logging/logger";
import { TempFileManager } from "../../../shared/storage/temp-file-manager";
import { PublishPostCommand } from "../domain/models";
import { InvalidTweetUrlError, TwitterRateLimitError, RetryScheduledError } from "../domain/errors";
import { TwitterMediaDownloader } from "../infrastructure/twitter-media-downloader";
import { TelegramChannelPublisher } from "../infrastructure/telegram-channel-publisher";
import { PublishPostQueue, QueueJob } from "../infrastructure/publish-post-queue";

type TimerHandle = ReturnType<typeof setTimeout>;

type ResolverEntry = {
  resolve: () => void;
  reject: (error: unknown) => void;
  requesterId: number;
};

export class PublishPostUseCase {
  readonly twitterDownloader: TwitterMediaDownloader;
  readonly channelPublisher: TelegramChannelPublisher;
  readonly tempFiles: TempFileManager;
  readonly queue: PublishPostQueue;
  processing = false;
  wakeTimer: TimerHandle | null = null;
  wakeAt: number | null = null;
  readonly pendingResolvers = new Map<number, ResolverEntry>();

  constructor(
    twitterDownloader: TwitterMediaDownloader,
    channelPublisher: TelegramChannelPublisher,
    tempFiles: TempFileManager,
    queue: PublishPostQueue
  ) {
    this.twitterDownloader = twitterDownloader;
    this.channelPublisher = channelPublisher;
    this.tempFiles = tempFiles;
    this.queue = queue;
    this.triggerProcessing();
  }

  async execute(command: PublishPostCommand) {
    this.validate(command);

    return new Promise<void>((resolve, reject) => {
      try {
        const jobId = this.queue.enqueue(command);
        this.pendingResolvers.set(jobId, { resolve, reject, requesterId: command.requesterId });
        logger.debug("Задача публикации поставлена в очередь", { requesterId: command.requesterId, jobId });
        this.triggerProcessing();
      } catch (error) {
        reject(error);
      }
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

  triggerProcessing() {
    if (this.processing) {
      return;
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
      this.wakeAt = null;
    }
    this.processing = true;
    void this.processQueue().catch((error) => {
      logger.error("Ошибка обработки очереди публикаций", { error });
    });
  }

  async processQueue() {
    try {
      while (true) {
        const now = Date.now();
        const job = this.queue.reserveNext(now);
        if (!job) {
          const nextAvailableAt = this.queue.getNextAvailableAt();
          if (nextAvailableAt) {
            this.scheduleWake(nextAvailableAt);
          }
          break;
        }

        await this.handleJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  async handleJob(job: QueueJob) {
    const command: PublishPostCommand = {
      requesterId: job.requesterId,
      tweetUrl: job.tweetUrl,
      userText: job.userText
    };

    try {
      await this.runJob(command);
      this.queue.complete(job.id);
      this.resolveJob(job.id);
    } catch (error) {
      if (error instanceof TwitterRateLimitError) {
        this.queue.reschedule(job.id, error.retryAt);
        this.scheduleWake(error.retryAt);
        logger.warn("Задача отложена из-за rate limit", {
          jobId: job.id,
          retryAt: error.retryAt
        });
        return;
      }

      logger.error("Ошибка обработки задачи публикации", { jobId: job.id, error });
      this.queue.fail(job.id);
      this.rejectJob(job.id, error);
    }
  }

  resolveJob(jobId: number) {
    const entry = this.pendingResolvers.get(jobId);
    if (entry) {
      entry.resolve();
      this.pendingResolvers.delete(jobId);
    }
  }

  rejectJob(jobId: number, error: unknown) {
    const entry = this.pendingResolvers.get(jobId);
    if (entry) {
      // Проверяем, есть ли ретраи в очереди для этого пользователя
      const nextRetryTime = this.queue.getNextRetryTimeForUser(entry.requesterId);
      if (nextRetryTime) {
        const retryError = new RetryScheduledError(
          nextRetryTime,
          `Задача отложена. Следующая попытка будет через ${this.formatRetryTime(nextRetryTime)}`
        );
        entry.reject(retryError);
      } else {
        entry.reject(error);
      }
      this.pendingResolvers.delete(jobId);
    }
  }

  scheduleWake(timestamp: number) {
    if (this.wakeAt && this.wakeAt <= timestamp) {
      return;
    }
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
    }
    const delayMs = Math.max(0, timestamp - Date.now());
    this.wakeAt = timestamp;
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.wakeAt = null;
      this.triggerProcessing();
    }, delayMs);
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

  private formatRetryTime(retryAt: number): string {
    const now = Date.now();
    const diffMs = retryAt - now;
    
    if (diffMs <= 0) {
      return "сейчас";
    }

    const diffSeconds = Math.ceil(diffMs / 1000);
    const diffMinutes = Math.ceil(diffSeconds / 60);
    const diffHours = Math.ceil(diffMinutes / 60);

    if (diffHours > 1) {
      return `${diffHours} часов`;
    } else if (diffMinutes > 1) {
      return `${diffMinutes} минут`;
    } else {
      return `${diffSeconds} секунд`;
    }
  }
}
