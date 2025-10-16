import { Bot, Context } from "grammy";
import { PublishPostUseCase } from "../application/publish-post.use-case";
import { InvalidTweetUrlError, MediaDownloadError } from "../domain/errors";
import { logger } from "../../../shared/logging/logger";
import { env } from "../../../shared/config/env";
import { TWEET_QUOTE_MARKER } from "../domain/models";

const tweetLinkRegex = /(https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^\s]+)/i;
const quoteTokenDetectionRegex = /(?:^|\s)(тви|twi)(?=\s|$)/iu;
const quoteTokenRemovalRegex = /(?:^|\s)(тви|twi)(?=\s|$)/giu;

export const registerPublishPostHandler = (bot: Bot<Context>, useCase: PublishPostUseCase) => {
  const processPost = async (ctx: Context, text: string): Promise<void> => {
    try {
      const { tweetUrl, userText } = parsePayload(text);
      await ctx.reply("⏳ Обрабатываю запрос, пожалуйста подождите...", { reply_to_message_id: ctx.message!.message_id });
      await useCase.execute({
        requesterId: ctx.from?.id ?? 0,
        tweetUrl,
        userText
      });
      await ctx.reply("✅ Сообщение отправлено в канал", { reply_to_message_id: ctx.message!.message_id });
    } catch (error) {
      if (error instanceof InvalidTweetUrlError) {
        await ctx.reply("❌ Некорректная ссылка на пост Twitter/X", { reply_to_message_id: ctx.message?.message_id });
        return;
      }
      logger.error("Ошибка при обработке запроса публикации", { error });
      if (error instanceof MediaDownloadError) {
        await ctx.reply("❌ Не удалось скачать вложения из Twitter/X", { reply_to_message_id: ctx.message!.message_id });
      } else {
        await ctx.reply("❌ Произошла непредвиденная ошибка", { reply_to_message_id: ctx.message!.message_id });
      }
    }
  };

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text ?? "";
    if (!tweetLinkRegex.test(text)) {
      await ctx.reply(`Текущая версия: ${env.appVersion}`, { reply_to_message_id: ctx.message?.message_id });
      return;
    }

    await processPost(ctx, text);
  });
};

const parsePayload = (text: string) => {
  const urlMatch = text.match(tweetLinkRegex);
  if (!urlMatch) {
    throw new InvalidTweetUrlError();
  }
  const tweetUrl = urlMatch[1];
  const payloadWithoutUrl = text.replace(urlMatch[0], " ");
  const hasQuoteToken = quoteTokenDetectionRegex.test(payloadWithoutUrl);
  let userText = payloadWithoutUrl.replace(quoteTokenRemovalRegex, " ").replace(tweetLinkRegex, " ");
  userText = userText.replace(/\s+/g, " ").trim();

  if (hasQuoteToken) {
    userText = userText.length > 0 ? `${userText}\n\n${TWEET_QUOTE_MARKER}` : TWEET_QUOTE_MARKER;
  }

  return { tweetUrl, userText };
};
