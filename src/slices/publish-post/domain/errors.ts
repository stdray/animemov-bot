export class InvalidTweetUrlError extends Error {
  constructor() {
    super("Некорректная ссылка на пост в Twitter/X");
  }
}

export class MediaDownloadError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class TwitterRateLimitError extends MediaDownloadError {
  constructor(public readonly retryAt: number, message: string) {
    super(message);
  }
}
