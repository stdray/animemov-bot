import {logger} from "../../../shared/logging/logger";
import {TempFileManager} from "../../../shared/storage/temp-file-manager";
import {PublishPostCommand, TWEET_QUOTE_MARKER, VideoVariantsInfo} from "../domain/models";
import {InvalidTweetUrlError, TwitterRateLimitError} from "../domain/errors";
import {TwitterMediaDownloader} from "../infrastructure/twitter-media-downloader";
import {TelegramChannelPublisher} from "../infrastructure/telegram-channel-publisher";
import {PublishPostQueue, QueueJob} from "../infrastructure/publish-post-queue";
import {env} from "../../../shared/config/env";

type TimerHandle = ReturnType<typeof setTimeout>;

type ResolverEntry = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

export class PublishPostUseCase {
  readonly twitterDownloader: TwitterMediaDownloader;
  readonly channelPublisher: TelegramChannelPublisher;
  readonly tempFiles: TempFileManager;
  readonly queue: PublishPostQueue;
  readonly userNotifier: PublishPostNotifier;
  processing = false;
  wakeTimer: TimerHandle | null = null;
  wakeAt: number | null = null;
  readonly pendingResolvers = new Map<number, ResolverEntry>();

  constructor(
    twitterDownloader: TwitterMediaDownloader,
    channelPublisher: TelegramChannelPublisher,
    tempFiles: TempFileManager,
    queue: PublishPostQueue,
    userNotifier: PublishPostNotifier
  ) {
    this.twitterDownloader = twitterDownloader;
    this.channelPublisher = channelPublisher;
    this.tempFiles = tempFiles;
    this.queue = queue;
    this.userNotifier = userNotifier;
    this.triggerProcessing();
  }

  async execute(command: PublishPostCommand) {
    this.validate(command);

    return new Promise<void>((resolve, reject) => {
      try {
        const jobId = this.queue.enqueue(command);
        this.pendingResolvers.set(jobId, {resolve, reject});
        logger.debug("Задача публикации поставлена в очередь", {requesterId: command.requesterId, jobId});
        this.triggerProcessing();
      } catch (error) {
        reject(error);
      }
    });
  }

  async clearQueue(requesterId: number) {
    try {
      const clearedCount = this.queue.clearQueue();
      logger.info("Очередь очищена", {requesterId, clearedJobs: clearedCount});
      
      // Clear all pending resolvers
      this.pendingResolvers.clear();
      
      // Notify user about cleared queue
      await this.userNotifier.notifyQueueCleared(requesterId, clearedCount);
      
      return clearedCount;
    } catch (error) {
      logger.error("Ошибка при очистке очереди", {requesterId, error});
      throw error;
    }
  }

  async getQueueStatus(requesterId: number) {
    try {
      const status = this.queue.getQueueStatus();
      await this.userNotifier.notifyQueueStatus(requesterId, status);
      return status;
    } catch (error) {
      logger.error("Ошибка при получении статуса очереди", {requesterId, error});
      throw error;
    }
  }

  validate(command: PublishPostCommand) {
    if (!command.tweetUrl || !/^https?:\/\//.test(command.tweetUrl)) {
      throw new InvalidTweetUrlError();
    }
    if (command.userText.trim().length === 0) {
      logger.warn("Пустой пользовательский текст", {requesterId: command.requesterId});
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
      logger.error("Ошибка обработки очереди публикаций", {error});
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
        const delayMs = error.retryAt - Date.now();
        this.queue.reschedule(job.id, error.retryAt, delayMs);
        this.scheduleWake(error.retryAt);
        logger.warn("Задача отложена из-за rate limit", {
          jobId: job.id,
          retryAt: error.retryAt,
          delayMs: delayMs
        });
        await this.notifyRateLimit(job.requesterId, error.retryAt, error.message);
        return;
      }

      // Check if we should retry the job based on retry count
      const currentRetries = job.retryCount || 0;
      if (currentRetries < env.maxRetryCount) {
        // Calculate new delay: last delay + 10 seconds
        const lastDelayMs = job.lastDelayMs || 0;
        const newDelayMs = lastDelayMs + 10000; // Add 10 seconds
        const retryAt = Date.now() + newDelayMs;
        
        this.queue.reschedule(job.id, retryAt, newDelayMs);
        this.scheduleWake(retryAt);
        
        logger.warn("Задача отложена для повторной попытки", {
          jobId: job.id,
          retryCount: currentRetries + 1,
          maxRetries: env.maxRetryCount,
          retryAt: retryAt,
          delayMs: newDelayMs,
          error: error
        });
        
        await this.userNotifier.notifyRetry(job.requesterId, currentRetries + 1, env.maxRetryCount, retryAt);
        return;
      }

      logger.error("Ошибка обработки задачи публикации (исчерпаны попытки)", {
        jobId: job.id,
        retryCount: currentRetries,
        maxRetries: env.maxRetryCount,
        error
      });
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
      entry.reject(error);
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
    logger.info("Начало публикации поста", {requesterId: command.requesterId});
    let variantsNotified = false;
    const {media, tweetText, videoVariants} = await this.twitterDownloader.download(command.tweetUrl, {
      onVideoVariants: async (variants) => {
        await this.notifyVideoVariants(command.requesterId, variants);
        variantsNotified = true;
      }
    });
    if (!variantsNotified) {
      await this.notifyVideoVariants(command.requesterId, videoVariants);
    }
    const finalUserText = this.prepareUserText(command.userText, tweetText, command.tweetUrl);

    try {
      await this.channelPublisher.publish(media, finalUserText);
      logger.info("Публикация завершена", {requesterId: command.requesterId});
    } finally {
      await this.tempFiles.cleanup(media.map((item) => item.filePath));
    }
  }

  prepareUserText(userText: string, tweetText: string, tweetUrl: string) {
    const hasMarker = userText.includes(TWEET_QUOTE_MARKER);
    let cleanedText = userText.split(TWEET_QUOTE_MARKER).join("").trim();

    if (!hasMarker) {
      return cleanedText;
    }

    const normalizedTweetText = tweetText.trim();
    if (normalizedTweetText.length === 0) {
      return cleanedText;
    }

    const urlRegex = /https?:\/\/\S+/gi;
    const quote = normalizedTweetText
      .split(/\r?\n/)
      .map((line) => line.replace(urlRegex, " "))
      .map((line) => line.replace(/\s{2,}/g, " ").trim())
      .map((line) => (line.length > 0 ? `> ${line}` : ">"))
      .join("\n");

    if (cleanedText.length === 0) {
      return quote;
    }
    const escapedUrl = this.escapeMarkdownV2Url(tweetUrl);
    const link = `[src](${escapedUrl})`;
    const escapedText = this.escapeMarkdownV2(cleanedText);
    const escapedQuote = this.escapeMarkdownV2(quote);
    return `${escapedText}  ${link}\n\n${escapedQuote}`;
  }

  escapeMarkdownV2Url(value: string) {
    return encodeURI(value)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }

  escapeMarkdownV2(value: string) {
    return value.replace(/([_*\[\]()~`#+\-=|{}.!\\])/g, "\\$1");
  }

  async notifyRateLimit(requesterId: number, retryAt: number, message: string) {
    if (!requesterId) {
      return;
    }
    try {
      await this.userNotifier.notifyRateLimit(requesterId, retryAt, message);
    } catch (error) {
      logger.warn("Не удалось уведомить пользователя о rate limit", {requesterId, error});
    }
  }

  async notifyVideoVariants(requesterId: number, variants: VideoVariantsInfo[]) {
    if (!requesterId || variants.length === 0) {
      return;
    }
    try {
      await this.userNotifier.notifyVideoVariants(requesterId, variants);
    } catch (error) {
      logger.warn("Не удалось отправить варианты видео пользователю", {requesterId, error});
    }
  }
}

export interface PublishPostNotifier {
  notifyRateLimit(requesterId: number, retryAt: number, message: string): Promise<void>;

  notifyVideoVariants(requesterId: number, variants: VideoVariantsInfo[]): Promise<void>;

  notifyRetry(requesterId: number, currentRetry: number, maxRetries: number, retryAt: number): Promise<void>;

  notifyQueueCleared(requesterId: number, clearedCount: number): Promise<void>;

  notifyQueueStatus(requesterId: number, status: any[]): Promise<void>;
}
