FROM oven/bun:1
WORKDIR /app

COPY package.json .
COPY bun.lockb .
RUN bun install --frozen-lockfile --production

COPY . .

ENV NODE_ENV=production

EXPOSE 2737
EXPOSE 8080

ENTRYPOINT [ "bun", "run", "index.ts" ]