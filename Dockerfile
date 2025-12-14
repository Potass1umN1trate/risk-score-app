# =========================
# БАЗОВЫЙ ОБРАЗ
# =========================
FROM node:20-alpine AS base
WORKDIR /app

# Чтобы Next.js не задавал лишних вопросов
ENV NEXT_TELEMETRY_DISABLED=1

# =========================
# ЗАВИСИМОСТИ
# =========================
FROM base AS deps

# Если нужны build tools (node-gyp и пр.)
RUN apk add --no-cache libc6-compat python3 make g++

# Копируем только файлы зависимостей
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* .npmrc* ./ 

# Устанавливаем зависимости (пытаемся угадать менеджер пакетов)
RUN \
  if [ -f pnpm-lock.yaml ]; then \
    npm install -g pnpm && pnpm install; \
  elif [ -f yarn.lock ]; then \
    yarn install --frozen-lockfile; \
  elif [ -f package-lock.json ]; then \
    npm ci; \
  else \
    npm install; \
  fi

# =========================
# DEV-ЦЕЛЬ (для локалки с hot reload)
# =========================
FROM base AS dev
ENV NODE_ENV=development

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

# Для dev-режима:
CMD ["npm", "run", "dev"]

# =========================
# СБОРКА ПРОДОВОГО БИЛДА
# =========================
FROM base AS builder
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# На всякий случай, если у тебя есть lint/test — можно добавить сюда
# RUN npm run lint
# RUN npm test

RUN npm run build

# =========================
# ПРОДОВЫЙ РАНТАЙМ
# =========================
FROM base AS runner
ENV NODE_ENV=production

# Создаём непривилегированного юзера
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

USER nextjs

WORKDIR /app

# Копируем только то, что нужно для запуска
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Для прод-режима:
CMD ["npm", "run", "start"]
