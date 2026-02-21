#!/bin/bash
set -e

CONFIG_FILE="/root/.picoclaw/config.json"

# Substitute env vars into config
sed \
  -e "s|ANTHROPIC_API_KEY_PLACEHOLDER|${ANTHROPIC_API_KEY}|g" \
  -e "s|BRAVE_API_KEY_PLACEHOLDER|${BRAVE_API_KEY:-}|g" \
  /root/.picoclaw/config-template.json > "$CONFIG_FILE"

echo "✅ PicoClaw config written"
echo "🦐 PicoClaw Office Bridge starting on :7070"

# Run the Node.js bridge server
exec node /app/bridge.js
