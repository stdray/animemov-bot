import { Api } from "grammy";
import { logger } from "../../../shared/logging/logger";
import { VideoVariantsInfo } from "../domain/models";
import { PublishPostNotifier } from "../application/publish-post.use-case";

const moscowFormatter = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Moscow",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit"
});

export class TelegramUserNotifier implements PublishPostNotifier {
  constructor(private readonly api: Api) {}

  async notifyRateLimit(requesterId: number, retryAt: number, message: string): Promise<void> {
    const formattedTime = moscowFormatter.format(new Date(retryAt));
    const text = [
      "⚠️ Запрос временно отложен из-за лимита Twitter/X.",
      message,
      `Новая попытка будет выполнена после ${formattedTime} (МСК).`
    ]
      .filter(Boolean)
      .join("\n");

    await this.safeSendMessage(requesterId, text);
  }

  async notifyVideoVariants(requesterId: number, variants: VideoVariantsInfo[]): Promise<void> {
    if (variants.length === 0) {
      return;
    }

    const lines: string[] = ["🎞 Доступные варианты видео:"];

    for (const info of variants) {
      lines.push(`Видео ${info.mediaIndex}:`);
      for (const option of info.options) {
        const parts: string[] = [];
        if (option.width && option.height) {
          parts.push(`${option.width}x${option.height}`);
        }
        if (option.bitrate) {
          const kbps = Math.round(option.bitrate / 1000);
          parts.push(`${kbps} кбит/с`);
        }
        if (parts.length === 0) {
          parts.push("характеристики не указаны");
        }
        lines.push(`• ${parts.join(", ")}`);
        lines.push(option.url);
      }
    }
    const text = ["```", ...lines, "```"];
    await this.safeSendMessage(requesterId, text.join("\n"), "MarkdownV2");
  }

  async notifyRetry(requesterId: number, currentRetry: number, maxRetries: number, retryAt: number): Promise<void> {
    const formattedTime = moscowFormatter.format(new Date(retryAt));
    const text = [
      `🔄 Повторная попытка ${currentRetry}/${maxRetries}.`,
      `Следующая попытка будет выполнена после ${formattedTime} (МСК).`
    ].join("\\n");

    await this.safeSendMessage(requesterId, text);
  }

  async notifyQueueCleared(requesterId: number, clearedCount: number): Promise<void> {
    const text = `🗑️ Очередь очищена. Удалено заданий: ${clearedCount}`;
    await this.safeSendMessage(requesterId, text);
  }

  async notifyQueueStatus(requesterId: number, status: any[]): Promise<void> {
    if (status.length === 0) {
      await this.safeSendMessage(requesterId, "📊 Очередь пуста");
      return;
    }

    const lines: string[] = ["📊 Статус очереди:"];
    
    for (const item of status) {
      const earliestDate = item.earliest_available 
        ? moscowFormatter.format(new Date(item.earliest_available))
        : 'N/A';
      
      lines.push(`${item.status}: ${item.count} заданий (макс. попыток: ${item.max_retries || 0})`);
      if (item.earliest_available) {
        lines.push(`  следующее: ${earliestDate} (МСК)`);
      }
    }

    await this.safeSendMessage(requesterId, lines.join("\\n"));
  }

  private async safeSendMessage(requesterId: number, text: string, parseMode?: "MarkdownV2"): Promise<void> {
    if (!requesterId) {
      return;
    }

    try {
      await this.api.sendMessage(requesterId, text, { parse_mode: parseMode });
    } catch (error) {
      logger.warn("Не удалось отправить сообщение пользователю", { requesterId, error });
    }
  }
}
