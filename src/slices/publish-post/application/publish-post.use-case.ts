import { logger } from "../../../shared/logging/logger";
import { TempFileManager } from "../../../shared/storage/temp-file-manager";
import { PublishPostCommand } from "../domain/models";
import { InvalidTweetUrlError, MediaDownloadError } from "../domain/errors";
import { TwitterMediaDownloader } from "../infrastructure/twitter-media-downloader";
import { TelegramChannelPublisher } from "../infrastructure/telegram-channel-publisher";

export class PublishPostUseCase {
  constructor(
    private readonly twitterDownloader: TwitterMediaDownloader,
    private readonly channelPublisher: TelegramChannelPublisher,
    private readonly tempFiles: TempFileManager
  ) {}

  async execute(command: PublishPostCommand) {
    this.validate(command);

    logger.info("Начало публикации поста", { requesterId: command.requesterId });
    const media = await this.twitterDownloader.download(command.tweetUrl);

    try {
      await this.channelPublisher.publish(media, command.userText, command.tweetUrl);
      logger.info("Публикация завершена", { requesterId: command.requesterId });
    } finally {
      await this.tempFiles.cleanup(media.map((item) => item.filePath));
    }
  }

  private validate(command: PublishPostCommand) {
    if (!command.tweetUrl || !/^https?:\/\//.test(command.tweetUrl)) {
      throw new InvalidTweetUrlError();
    }
    if (command.userText.trim().length === 0) {
      logger.warn("Пустой пользовательский текст", { requesterId: command.requesterId });
    }
  }
}
