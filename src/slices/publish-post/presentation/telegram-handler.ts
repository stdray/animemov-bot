import { Bot, Context } from "grammy";
import { PublishPostUseCase } from "../application/publish-post.use-case";
import { InvalidTweetUrlError, MediaDownloadError, RetryScheduledError } from "../domain/errors";
import { logger } from "../../../shared/logging/logger";

const commandRegex = /^\/post(?:@\w+)?\s*/i;
const urlRegex = /(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s]+)/i;

export const registerPublishPostHandler = (bot: Bot<Context>, useCase: PublishPostUseCase) => {
  const processPost = async (ctx: Context, text: string) => {
    const { tweetUrl, userText } = parsePayload(text);
    try {
      await ctx.reply("⏳ Обрабатываю запрос, пожалуйста подождите...", { reply_to_message_id: ctx.message!.message_id });
      await useCase.execute({
        requesterId: ctx.from?.id ?? 0,
        tweetUrl,
        userText
      });
      await ctx.reply("✅ Сообщение отправлено в канал", { reply_to_message_id: ctx.message!.message_id });
    } catch (error) {
      logger.error("Ошибка при обработке запроса публикации", { error });
      if (error instanceof InvalidTweetUrlError) {
        await ctx.reply("❌ Некорректная ссылка на пост Twitter/X", { reply_to_message_id: ctx.message!.message_id });
      } else if (error instanceof MediaDownloadError) {
        await ctx.reply("❌ Не удалось скачать вложения из Twitter/X", { reply_to_message_id: ctx.message!.message_id });
      } else if (error instanceof RetryScheduledError) {
        await ctx.reply(`⏳ ${error.message}`, { reply_to_message_id: ctx.message!.message_id });
      } else {
        await ctx.reply("❌ Произошла непредвиденная ошибка", { reply_to_message_id: ctx.message!.message_id });
      }
    }
  };

  bot.command("post", async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply("Отправьте ссылку на пост в Twitter/X и текст сообщения");
      return;
    }

    await processPost(ctx, ctx.message.text);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!urlRegex.test(text)) {
      return;
    }
    if (commandRegex.test(text)) {
      return;
    }

    await processPost(ctx, text);
  });
};

const parsePayload = (text: string) => {
  const payload = text.replace(commandRegex, "").trim();
  const urlMatch = payload.match(urlRegex);
  if (!urlMatch) {
    throw new InvalidTweetUrlError();
  }
  const tweetUrl = urlMatch[1];
  const userText = payload.replace(urlMatch[1], "").trim();
  return { tweetUrl, userText };
};
