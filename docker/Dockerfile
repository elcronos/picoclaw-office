FROM golang:1.25-alpine AS picoclaw-builder

RUN apk add --no-cache git make curl bash

WORKDIR /build
RUN git clone --depth=1 https://github.com/sipeed/picoclaw.git .

# Show what the Makefile does, then build
# Fall back to direct go build if make fails or binary ends up elsewhere
RUN set -e; \
    echo "=== Makefile build targets ===" && \
    grep -E "^[a-z].*:" Makefile | head -20 || true; \
    echo "=== go.mod ===" && cat go.mod | head -5; \
    echo "=== Building ===" && \
    (make deps 2>&1 || go mod download) && \
    (make build 2>&1 || true) && \
    echo "=== Finding binary ===" && \
    find /build /root/go/bin /usr/local/bin -name "picoclaw" -type f 2>/dev/null || true && \
    find /build -name "*.bin" -o -name "picoclaw*" 2>/dev/null | grep -v ".go" | grep -v ".sum" | grep -v ".mod" || true

# If make build didn't produce it, build directly
RUN if ! find /build -maxdepth 3 -name "picoclaw" -type f | grep -q .; then \
      echo "Binary not found via make, building with go build..." && \
      go build -o /build/picoclaw ./cmd/picoclaw/...; \
    fi

# Find and copy to known location
RUN BINARY=$(find /build /root/go/bin -name "picoclaw" -type f 2>/dev/null | head -1) && \
    echo "Found binary at: $BINARY" && \
    cp "$BINARY" /usr/local/bin/picoclaw && \
    chmod +x /usr/local/bin/picoclaw && \
    /usr/local/bin/picoclaw --version 2>/dev/null || echo "Binary installed (--version not supported)"

# ── Final image ───────────────────────────────────────────────
FROM node:20-alpine

RUN apk add --no-cache ca-certificates curl bash

COPY --from=picoclaw-builder /usr/local/bin/picoclaw /usr/local/bin/picoclaw

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
