# animemov-bot

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
   Description=animemov-bot
   After=network.target

   [Service]
   WorkingDirectory=/opt/animemov-bot
   EnvironmentFile=/opt/animemov-bot/.env
   ExecStart=/usr/local/bin/bun start
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

7. Следите за логами приложения: `journalctl -u animemov-bot -f` или встроенный вывод `bun start`.

## Docker-развертывание

Для запуска в Docker контейнере:

```bash
# Сборка образа с версией из GitVersion
docker build -t animemov-bot .

# Или сборка с передачей версии через build arg
docker build --build-arg VERSION=$(dotnet /root/.dotnet/tools/dotnet-gitversion /output json | jq -r '.SemVer') -t animemov-bot .

# Запуск с рестартом при сбоях
docker run -d --name animemov-bot --restart unless-stopped --env-file .env animemov-bot

# Просмотр логов
docker logs -f animemov-bot

# Остановка и удаление контейнера
docker stop animemov-bot && docker rm animemov-bot
```

Параметр `--restart unless-stopped` обеспечивает автоматический перезапуск контейнера при сбоях или перезагрузке системы.

## Версионирование

Проект использует [GitVersion](https://gitversion.net/) для автоматического создания версий на основе git-истории:

- **main/master** ветки: создают релизные версии (например, `1.0.0`)
- **develop** ветка: создает alpha-версии (например, `1.1.0-alpha.1`)
- **feature** ветки: создают feature-версии (например, `1.1.0-feature-branch.1`)
- **hotfix** ветки: создают hotfix-версии (например, `1.0.1-hotfix-branch.1`)

Версия автоматически генерируется при сборке Docker-образа и доступна через переменную окружения `APP_VERSION`.

## CI/CD

Проект использует GitHub Actions для автоматической сборки и публикации:

### Автоматические действия:
- **При push в main/master/develop**: сборка и публикация Docker образа
- **При создании тега v***: сборка релизной версии
- **При pull request**: проверка кода и сборка тестового образа

### Публикация образов:
Образы автоматически публикуются в GitHub Container Registry (`ghcr.io`):

```bash
# Использование автоматически собранного образа
docker pull ghcr.io/stdray/animemov-bot:latest
docker run -d --name animemov-bot --restart unless-stopped --env-file .env ghcr.io/stdray/animemov-bot:latest
```

### Доступные теги:
- `latest` - последняя версия из main/master ветки
- `develop` - версия из develop ветки
- `v1.0.0` - конкретная релизная версия
- `1.0.0` - семантическая версия
- `1.0` - мажорная версия

### Безопасность:
- Автоматическое сканирование уязвимостей с помощью Trivy
- Проверка типов TypeScript
- Проверка сборки проекта

Учтите, что Twitter/X накладывает строгие rate limit — при коде ответа 429 бот уведомит инициатора о необходимости повторить запрос позже.
