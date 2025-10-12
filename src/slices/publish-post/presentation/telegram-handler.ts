import { Bot, Context } from "grammy";
import { PublishPostUseCase } from "../application/publish-post.use-case";
import { InvalidTweetUrlError, MediaDownloadError } from "../domain/errors";
import { logger } from "../../../shared/logging/logger";

const commandRegex = /^\/post(?:@\w+)?\s*/i;
const urlRegex = /(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s]+)/i;

export const registerPublishPostHandler = (bot: Bot<Context>, useCase: PublishPostUseCase) => {
  bot.command("post", async (ctx) => {
    if (!ctx.message?.text) {
      await ctx.reply("Отправьте ссылку на пост в Twitter/X и текст сообщения");
      return;
    }

    const { tweetUrl, userText } = parsePayload(ctx.message.text);
    try {
      await ctx.reply("⏳ Обрабатываю запрос, пожалуйста подождите...", { reply_to_message_id: ctx.message.message_id });
      await useCase.execute({
        requesterId: ctx.from?.id ?? 0,
        tweetUrl,
        userText
      });
      await ctx.reply("✅ Сообщение отправлено в канал", { reply_to_message_id: ctx.message.message_id });
    } catch (error) {
      logger.error("Ошибка при обработке команды /post", { error });
      if (error instanceof InvalidTweetUrlError) {
        await ctx.reply("❌ Некорректная ссылка на пост Twitter/X", { reply_to_message_id: ctx.message.message_id });
      } else if (error instanceof MediaDownloadError) {
        await ctx.reply("❌ Не удалось скачать вложения из Twitter/X", { reply_to_message_id: ctx.message.message_id });
      } else {
        await ctx.reply("❌ Произошла непредвиденная ошибка", { reply_to_message_id: ctx.message.message_id });
      }
    }
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
