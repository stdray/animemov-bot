import { Api, InputFile } from "grammy";
import type { InputMediaPhoto, InputMediaVideo } from "grammy/types";
import { env } from "../../../shared/config/env";
import { logger } from "../../../shared/logging/logger";
import { DownloadedMedia } from "../domain/models";

const MEDIA_GROUP_LIMIT = 10;

export class TelegramChannelPublisher {
  readonly api: Api;

  constructor(api: Api) {
    this.api = api;
  }

  async publish(media: DownloadedMedia[], userText: string, tweetUrl: string) {
    if (media.length === 0) {
      await this.api.sendMessage(env.telegramTargetChannelId, this.composeCaption(userText, tweetUrl), {
        parse_mode: "MarkdownV2"
      });
      return;
    }

    const chunks = this.chunk(media, MEDIA_GROUP_LIMIT);
    let captionSent = false;

    for (const [index, chunk] of chunks.entries()) {
      const album = chunk.map((item) => this.mapMedia(item));
      if (!captionSent && album.length > 0) {
        const caption = this.composeCaption(userText, tweetUrl);
        album[0] = {
          ...album[0],
          caption,
          parse_mode: "MarkdownV2"
        } as InputMediaPhoto | InputMediaVideo;
        captionSent = true;
      }
      logger.debug("Отправка альбома в канал", { index, size: album.length });
      await this.api.sendMediaGroup(env.telegramTargetChannelId, album as Array<InputMediaPhoto | InputMediaVideo>);
    }

    if (!captionSent) {
      await this.api.sendMessage(env.telegramTargetChannelId, this.composeCaption(userText, tweetUrl), {
        parse_mode: "MarkdownV2"
      });
    }
  }

  mapMedia(item: DownloadedMedia): InputMediaPhoto | InputMediaVideo {
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

  composeCaption(userText: string, tweetUrl: string) {
    const trimmedText = userText.trim();
    const escapedUrl = this.escapeMarkdownV2Url(tweetUrl);
    const link = `[src](${escapedUrl})`;
    if (trimmedText.length === 0) {
      return link;
    }
    const escapedText = this.escapeMarkdownV2(trimmedText);
    return `${escapedText} \\[${link}\\]`;
  }

  chunk<T>(input: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < input.length; i += size) {
      result.push(input.slice(i, i + size));
    }
    return result;
  }

  escapeMarkdownV2(value: string) {
    return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
  }

  escapeMarkdownV2Url(value: string) {
    return encodeURI(value)
      .replace(/\\/g, "\\\\")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }
}
