# Настройка GitHub Container Registry

## Требования

1. Репозиторий должен быть публичным или иметь GitHub Packages включенными
2. В настройках репозитория должен быть включен GitHub Actions

## Настройка доступа

### Для публичных репозиториев:
- Образы автоматически публикуются без дополнительной настройки
- Доступны всем пользователям GitHub

### Для приватных репозиториев:
1. Перейдите в Settings → Actions → General
2. В разделе "Workflow permissions" выберите "Read and write permissions"
3. Включите "Allow GitHub Actions to create and approve pull requests"

## Использование образов

### Аутентификация:
```bash
# Войти в GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

### Запуск образа:
```bash
# Последняя версия
docker run -d --name animemov-bot --restart unless-stopped --env-file .env ghcr.io/stdray/animemov-bot:latest

# Конкретная версия
docker run -d --name animemov-bot --restart unless-stopped --env-file .env ghcr.io/stdray/animemov-bot:v1.0.0

# Версия из develop ветки
docker run -d --name animemov-bot --restart unless-stopped --env-file .env ghcr.io/stdray/animemov-bot:develop
```

## Мониторинг

- Статус сборки: Actions tab в репозитории
- Опубликованные образы: Packages в профиле пользователя
- Уязвимости: Security tab в репозитории
