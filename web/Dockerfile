# Build context: repo root (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w web
COPY web ./web
RUN npm run build -w web

# Static files served by nginx. The template is rendered at startup with OCULUS_READ_KEY,
# so the read key stays on the server and never appears in the JS bundle.
FROM nginx:1.27-alpine
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/web/dist /usr/share/nginx/html
