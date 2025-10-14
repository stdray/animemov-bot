import { Bot, Context } from "grammy";
import { PublishPostUseCase } from "../application/publish-post.use-case";
import { InvalidTweetUrlError, MediaDownloadError } from "../domain/errors";
import { logger } from "../../../shared/logging/logger";

const commandRegex = /^\/post(?:@\w+)?\s*/i;

export const registerPublishPostHandler = (bot: Bot<Context>, useCase: PublishPostUseCase) => {
  type ProcessResult = "retry" | "done";
  const pendingRequests = new Set<string>();

  const getPendingKey = (ctx: Context) => {
    const chatId = ctx.chat?.id ?? 0;
    const userId = ctx.from?.id ?? 0;
    return `${chatId}:${userId}`;
  };

  const processPost = async (ctx: Context, text: string): Promise<ProcessResult> => {
    try {
      const { tweetUrl, userText } = parsePayload(text);
      await ctx.reply("⏳ Обрабатываю запрос, пожалуйста подождите...", { reply_to_message_id: ctx.message!.message_id });
      await useCase.execute({
        requesterId: ctx.from?.id ?? 0,
        tweetUrl,
        userText
      });
      await ctx.reply("✅ Сообщение отправлено в канал", { reply_to_message_id: ctx.message!.message_id });
      return "done";
    } catch (error) {
      if (error instanceof InvalidTweetUrlError) {
        await ctx.reply("❌ Некорректная ссылка на пост Twitter/X", { reply_to_message_id: ctx.message?.message_id });
        return "retry";
      }
      logger.error("Ошибка при обработке запроса публикации", { error });
      if (error instanceof MediaDownloadError) {
        await ctx.reply("❌ Не удалось скачать вложения из Twitter/X", { reply_to_message_id: ctx.message!.message_id });
      } else {
        await ctx.reply("❌ Произошла непредвиденная ошибка", { reply_to_message_id: ctx.message!.message_id });
      }
      return "done";
    }
  };

  bot.command("post", async (ctx) => {
    const key = getPendingKey(ctx);
    pendingRequests.add(key);
    await ctx.reply("Отправьте ссылку на пост Twitter/X и текст сообщения отдельным сообщением", {
      reply_to_message_id: ctx.message?.message_id
    });
  });

  bot.on("message:text", async (ctx) => {
    const key = getPendingKey(ctx);
    if (!pendingRequests.has(key)) {
      return;
    }

    const result = await processPost(ctx, ctx.message.text);
    if (result === "done") {
      pendingRequests.delete(key);
    }
  });
};

const parsePayload = (text: string) => {
  const payload = text.replace(commandRegex, "").trim();
  const urlMatch = payload.match(/(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s]+)/i);
  if (!urlMatch) {
    throw new InvalidTweetUrlError();
  }
  const tweetUrl = urlMatch[1];
  const userText = payload.replace(urlMatch[1], "").trim();
  return { tweetUrl, userText };
};
