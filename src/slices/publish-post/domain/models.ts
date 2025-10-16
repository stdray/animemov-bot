export type MediaType = "photo" | "video";

export interface DownloadedMedia {
  type: MediaType;
  filePath: string;
  caption?: string;
}

export interface PublishPostCommand {
  tweetUrl: string;
  userText: string;
  requesterId: number;
}

export const TWEET_QUOTE_MARKER = "__INCLUDE_TWEET_TEXT__";

export interface VideoVariantOption {
  url: string;
  bitrate?: number;
  width?: number;
  height?: number;
}

export interface VideoVariantsInfo {
  mediaIndex: number;
  options: VideoVariantOption[];
}
