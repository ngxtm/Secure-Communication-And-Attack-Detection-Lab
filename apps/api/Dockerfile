FROM node:24-bookworm-slim

WORKDIR /workspace

RUN npm install --global pnpm@10.30.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile --filter api...

COPY apps/api ./apps/api

RUN pnpm --filter api build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "pnpm --filter api seed:check && pnpm --filter api exec prisma db migrate && pnpm --filter api seed && pnpm --filter api start:prod"]
