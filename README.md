# amimemov-bot

Telegram-бот на Bun + TypeScript, который принимает ссылку на твит и пользовательский текст, скачивает все вложенные медиа из Twitter/X и публикует их в заданный Telegram-канал с подписью и ссылкой на исходный пост.

## Требования

- [Bun](https://bun.sh/) 1.1 или новее
- Доступ к Twitter/X API (OAuth 1.0a) и рабочий HTTPS-прокси
- Токен Telegram-бота и идентификатор целевого канала

## Переменные окружения

Оформите файл `.env` на основе примера ниже:

```env
TELEGRAM_BOT_TOKEN=""
TELEGRAM_TARGET_CHANNEL_ID=""

TWITTER_CONSUMER_KEY=""
TWITTER_CONSUMER_SECRET=""
TWITTER_ACCESS_TOKEN=""
TWITTER_ACCESS_SECRET=""

TWITTER_PROXY_URL="https://user:password@proxy-host:port"
TEMP_DIR=".tmp"
```

`TEMP_DIR` можно опустить — по умолчанию временные файлы сохраняются в каталоге `.tmp` в корне проекта.

## Локальный запуск

```bash
bun install
bun run dev
```

Команда `bun run dev` загружает переменные окружения, инициализирует бота GramMMY и запускает обработчик команды `/post`.

## Проверки

Для статического анализа типов выполните:

```bash
bun x tsc --noEmit
```

## Продакшен-развертывание

1. Установите Bun на сервере и убедитесь, что доступ к Twitter/X проходит через настроенный HTTPS-прокси.
2. Склонируйте репозиторий и установите зависимости: `bun install --production`.
3. Заполните `.env` актуальными значениями (бот, канал, ключи Twitter, URL прокси и временной каталог при необходимости).
4. Запустите проверку типов: `bun x tsc --noEmit`.
5. Запускайте бота командой `bun start` (она эквивалентна `bun run src/app/main.ts`).
6. Для непрерывной работы заверните запуск в менеджер процессов (например, `systemd`, `pm2`, `supervisor`). Пример unit-файла systemd:

   ```ini
   [Unit]
   Description=amimemov-bot
   After=network.target

   [Service]
   WorkingDirectory=/opt/amimemov-bot
   EnvironmentFile=/opt/amimemov-bot/.env
   ExecStart=/usr/local/bin/bun start
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

7. Следите за логами приложения: `journalctl -u amimemov-bot -f` или встроенный вывод `bun start`.

Учтите, что Twitter/X накладывает строгие rate limit — при коде ответа 429 бот уведомит инициатора о необходимости повторить запрос позже.
