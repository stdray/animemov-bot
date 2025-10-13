# Используем официальный образ Bun
FROM oven/bun:1.3-alpine

# Устанавливаем GitVersion для создания версий
RUN apk add --no-cache git dotnet-sdk8.0
RUN dotnet tool install --global GitVersion.Tool --version 5.12.0

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json bun.lock* ./

# Устанавливаем зависимости
RUN bun install --frozen-lockfile

# Копируем исходный код
COPY . .

# Создаем директорию для временных файлов
RUN mkdir -p .tmp

# Генерируем версию через GitVersion
RUN dotnet /root/.dotnet/tools/dotnet-gitversion /output json > version.json || echo '{"SemVer":"1.0.0","FullSemVer":"1.0.0","InformationalVersion":"1.0.0"}' > version.json

# Добавляем версию в переменные окружения
ARG VERSION
ENV APP_VERSION=${VERSION}

# Создаем пользователя для безопасности
RUN addgroup -g 1001 -S nodejs
RUN adduser -S bun -u 1001

# Меняем владельца файлов
RUN chown -R bun:nodejs /app
USER bun

# Открываем порт (если потребуется для health check)
EXPOSE 3000

# Команда запуска
CMD ["bun", "start"]
