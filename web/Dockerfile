# Build context: repo root (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w web
COPY web ./web
RUN npm run build -w web

# Static files served by nginx. The read keys (OCULUS_READ_KEYS) are written into nginx's
# config at startup by render-read-keys.sh, so they stay on the server and never appear in
# the JS bundle.
FROM nginx:1.31-alpine
COPY --chmod=755 web/render-read-keys.sh /docker-entrypoint.d/05-render-read-keys.sh
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html
