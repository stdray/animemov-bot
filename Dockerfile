# Используем официальный образ Bun
FROM oven/bun:1.3-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем файлы зависимостей
COPY package.json bun.lock* ./

# Устанавливаем зависимости
RUN bun install --frozen-lockfile --production

# Копируем артефакты сборки
COPY dist ./dist

# Создаем директорию для временных файлов
RUN mkdir -p .tmp

# Добавляем версию в переменные окружения
ARG VERSION
ENV APP_VERSION=${VERSION}

# Открываем порт (если потребуется для health check)
EXPOSE 3000

# Команда запуска
CMD ["bun", "run", "dist/main.js"]
