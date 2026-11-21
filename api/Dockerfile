# Build context: repo root (see docker-compose.yml).

# 1) Compile TypeScript with dev dependencies available.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w api
COPY api ./api
RUN npm run build -w api

# 2) Runtime image: production dependencies + compiled JS only, running as a non-root user.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w api --omit=dev && npm cache clean --force
COPY --from=build /app/api/dist api/dist
COPY api/migrations api/migrations
USER node
WORKDIR /app/api
EXPOSE 3000
# Apply pending migrations, then start the server.
CMD ["sh", "-c", "node dist/bin/migrate.js && node dist/index.js"]
