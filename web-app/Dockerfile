FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY web-app/package.json web-app/package-lock.json ./
RUN npm ci

COPY web-app/ ./

ENV NEXT_TELEMETRY_DISABLED=1

# Next imports auth configuration during build-time page collection. Use a
# non-secret placeholder here; Kubernetes provides the real runtime value.
RUN AUTH_SECRET=build-time-placeholder npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/types ./types
COPY --from=builder /app/auth.ts ./auth.ts
COPY --from=builder /app/middleware.ts ./middleware.ts
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/scripts ./scripts

EXPOSE 3000

CMD ["npm", "run", "start"]
