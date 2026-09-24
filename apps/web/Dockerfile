FROM node:24-bookworm-slim

WORKDIR /workspace

RUN npm install --global pnpm@10.30.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json

RUN pnpm install --frozen-lockfile --filter web...

COPY apps/web ./apps/web

ARG API_INTERNAL_URL=http://api:3000
ENV API_INTERNAL_URL=$API_INTERNAL_URL

RUN pnpm --filter web build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["pnpm", "--filter", "web", "start"]
