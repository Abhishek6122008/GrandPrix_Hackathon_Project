# syntax=docker/dockerfile:1

# ---- build ----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# npm ci, not npm install: it installs exactly the lockfile and fails if the two have drifted,
# which is what makes the image reproducible rather than "whatever resolved today".
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Vite inlines VITE_* at build time — these are baked into the bundle, not read at runtime, so
# an image built for localhost cannot be repointed at a deployed backend by setting an env var
# on the container. A different target means a rebuild with different --build-arg values.
#
# The defaults are the host's ports because the browser resolves these, not the container: from
# the page's point of view the backend is on the host at 8080, whatever it is called on the
# compose network.
ARG VITE_API_BASE_URL=http://localhost:8080
ARG VITE_WS_BASE_URL=ws://localhost:8080
ARG VITE_AI_SERVICE_URL=http://localhost:8000
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_WS_BASE_URL=$VITE_WS_BASE_URL \
    VITE_AI_SERVICE_URL=$VITE_AI_SERVICE_URL

RUN npm run build

# ---- serve ----------------------------------------------------------------
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# 127.0.0.1 rather than localhost, and it matters.
#
# nginx listens on 0.0.0.0:80 — IPv4 only — while busybox wget resolves "localhost" to ::1
# first and gives up with "connection refused". The container then reports unhealthy while
# serving every request correctly, compose --wait fails, and the pipeline goes red over a bug
# that does not exist. The literal address skips the resolver and the ambiguity with it.
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
