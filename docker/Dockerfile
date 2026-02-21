FROM golang:1.25-alpine AS picoclaw-builder

RUN apk add --no-cache git make curl
WORKDIR /build
RUN git clone --depth=1 https://github.com/sipeed/picoclaw.git . && \
    make deps && make build

# ── Final image ──────────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache ca-certificates curl bash

# Copy picoclaw binary from builder
COPY --from=picoclaw-builder /build/picoclaw /usr/local/bin/picoclaw

WORKDIR /app
COPY package.json ./
RUN npm install --production

COPY bridge.js ./

RUN mkdir -p /root/.picoclaw/workspace
COPY picoclaw-config-template.json /root/.picoclaw/config-template.json

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7070
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:7070/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
