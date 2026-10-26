# Образ приложения: собирает клиент и запускает сервер. Базу данных сюда не кладём: PostgreSQL стоит на самом сервере.
FROM node:22-bookworm-slim

# Часовой пояс нужен для рабочих часов и сроков задач
RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Сначала только описания пакетов: пока они не менялись, зависимости берутся из кэша сборки
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8431
CMD ["npm", "start"]
