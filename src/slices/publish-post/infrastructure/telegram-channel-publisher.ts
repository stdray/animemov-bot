import { Api, InputFile } from "grammy";
import type { InputMediaPhoto, InputMediaVideo } from "grammy/types";
import { env } from "../../../shared/config/env";
import { logger } from "../../../shared/logging/logger";
import { DownloadedMedia } from "../domain/models";

const MEDIA_GROUP_LIMIT = 10;

export class TelegramChannelPublisher {
  constructor(private readonly api: Api) {}

  async publish(media: DownloadedMedia[], userText: string, tweetUrl: string) {
    if (media.length === 0) {
      await this.api.sendMessage(env.telegramTargetChannelId, this.composeCaption(userText, tweetUrl));
      return;
    }

    const chunks = this.chunk(media, MEDIA_GROUP_LIMIT);
    let captionSent = false;

    for (const [index, chunk] of chunks.entries()) {
      const album = chunk.map((item) => this.mapMedia(item));
      if (!captionSent && album.length > 0) {
        album[0].caption = this.composeCaption(userText, tweetUrl);
        captionSent = true;
      }
      logger.debug("Отправка альбома в канал", { index, size: album.length });
      await this.api.sendMediaGroup(env.telegramTargetChannelId, album as Array<InputMediaPhoto | InputMediaVideo>);
    }

    if (!captionSent) {
      await this.api.sendMessage(env.telegramTargetChannelId, this.composeCaption(userText, tweetUrl));
    }
  }

  private mapMedia(item: DownloadedMedia): InputMediaPhoto | InputMediaVideo {
    const file = new InputFile(item.filePath);
    if (item.type === "photo") {
      return {
        type: "photo",
        media: file
      } satisfies InputMediaPhoto;
    }
    return {
      type: "video",
      media: file,
      supports_streaming: true
    } satisfies InputMediaVideo;
  }

  private composeCaption(userText: string, tweetUrl: string) {
    const trimmedText = userText.trim();
    const suffix = `[src (${tweetUrl})]`;
    return trimmedText.length > 0 ? `${trimmedText}\n\n${suffix}` : suffix;
  }

  private chunk<T>(input: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < input.length; i += size) {
      result.push(input.slice(i, i + size));
    }
    return result;
  }
}
