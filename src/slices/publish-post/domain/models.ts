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
