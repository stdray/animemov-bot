import TwitterApi, {
  TweetV2,
  TweetV2SingleResult,
  MediaObjectV2,
  ApiV2Includes,
  Tweetv2FieldsParams
} from "twitter-api-v2";
import { HttpsProxyAgent } from "https-proxy-agent";
import { env } from "../../../shared/config/env";
import { logger } from "../../../shared/logging/logger";
import { TempFileManager } from "../../../shared/storage/temp-file-manager";
import { DownloadedMedia, MediaType } from "../domain/models";
import { InvalidTweetUrlError, MediaDownloadError } from "../domain/errors";

const tweetIdRegex = /(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i;

const mediaFields: Partial<Tweetv2FieldsParams> = {
  expansions: ["attachments.media_keys"],
  "media.fields": ["type", "url", "variants", "alt_text"]
};

export class TwitterMediaDownloader {
  private readonly client: TwitterApi;
  private readonly proxyAgent = new HttpsProxyAgent(env.twitterProxyUrl);

  constructor(private readonly tempFiles: TempFileManager) {
    this.client = new TwitterApi(
      {
        appKey: env.twitterCredentials.consumerKey,
        appSecret: env.twitterCredentials.consumerSecret,
        accessToken: env.twitterCredentials.accessToken,
        accessSecret: env.twitterCredentials.accessSecret
      },
      {
        httpAgent: this.proxyAgent as any
      }
    );
  }

  async download(tweetUrl: string): Promise<DownloadedMedia[]> {
    const tweetId = this.extractTweetId(tweetUrl);
    logger.debug("Запрос медиа по твиту", { tweetId });

    let result: TweetV2SingleResult;
    try {
      result = await this.client.v2.singleTweet(tweetId, mediaFields);
    } catch (error) {
      logger.error("Не удалось получить данные твита", { error });
      throw new MediaDownloadError("Не удалось получить данные твита из Twitter/X");
    }

    const media = this.collectMedia(result.data, result.includes);
    if (media.length === 0) {
      throw new MediaDownloadError("В твите отсутствуют вложения");
    }

    const downloads: DownloadedMedia[] = [];
    for (const item of media) {
      const url = this.getMediaUrl(item);
      const extension = this.resolveExtension(item.type);
      const filePath = this.tempFiles.createPath(extension);

      try {
        const response = await fetch(url, { agent: this.proxyAgent } as any);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        await this.tempFiles.saveBuffer(filePath, arrayBuffer);
      } catch (error) {
        logger.error("Ошибка при загрузке медиа", { url, error });
        await this.tempFiles.cleanup([...downloads.map((d) => d.filePath), filePath]);
        throw new MediaDownloadError("Не удалось скачать вложения из Twitter/X");
      }

      downloads.push({
        type: item.type === "photo" ? "photo" : "video",
        filePath,
        caption: item.alt_text ?? undefined
      });
    }

    return downloads;
  }

  private extractTweetId(tweetUrl: string): string {
    const match = tweetIdRegex.exec(tweetUrl);
    if (!match) {
      throw new InvalidTweetUrlError();
    }
    return match[1];
  }

  private collectMedia(tweet: TweetV2, includes?: ApiV2Includes): MediaObjectV2[] {
    if (!tweet.attachments?.media_keys || !includes?.media) {
      return [];
    }
    const keyed = new Map<string, MediaObjectV2>();
    for (const media of includes.media) {
      if (media.media_key) {
        keyed.set(media.media_key, media);
      }
    }
    return tweet.attachments.media_keys
      .map((key) => keyed.get(key))
      .filter((item): item is MediaObjectV2 => Boolean(item));
  }

  private getMediaUrl(media: MediaObjectV2): string {
    if (media.type === "photo" && media.url) {
      return media.url;
    }

    if (media.type === "video" || media.type === "animated_gif") {
      const variants = (media as any).variants as Array<{ url: string; bitrate?: number; content_type: string }>;
      if (!variants?.length) {
        throw new MediaDownloadError("Видео не содержит доступных вариантов");
      }
      const mp4 = variants
        .filter((variant) => variant.content_type === "video/mp4")
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
      if (!mp4) {
        throw new MediaDownloadError("Видео не содержит MP4 вариантов");
      }
      return mp4.url;
    }

    throw new MediaDownloadError(`Неизвестный тип медиа ${media.type}`);
  }

  private resolveExtension(type: MediaObjectV2["type"]) {
    switch (type) {
      case "photo":
        return ".jpg";
      case "video":
      case "animated_gif":
        return ".mp4";
      default:
        return ".bin";
    }
  }
}
