#!/bin/bash
set -e

CONFIG_FILE="/root/.picoclaw/config.json"

# Determine provider + model
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OLLAMA_BASE="${OLLAMA_BASE:-http://host-gateway:11434/v1}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"

if [ -n "$ANTHROPIC_API_KEY" ]; then
  MODEL="claude-sonnet-4-20250514"
  echo "✅ Provider: Anthropic (${MODEL})"
else
  MODEL="${OLLAMA_MODEL}"
  echo "🦙 Provider: Ollama (${MODEL} @ ${OLLAMA_BASE})"
fi

sed \
  -e "s|ANTHROPIC_API_KEY_PLACEHOLDER|${ANTHROPIC_API_KEY}|g" \
  -e "s|OLLAMA_BASE_PLACEHOLDER|${OLLAMA_BASE}|g" \
  -e "s|MODEL_PLACEHOLDER|${MODEL}|g" \
  -e "s|BRAVE_API_KEY_PLACEHOLDER|${BRAVE_API_KEY}|g" \
  /root/.picoclaw/config-template.json > "$CONFIG_FILE"

echo "✅ PicoClaw config written to $CONFIG_FILE"
echo "🦐 PicoClaw Office Bridge starting on :7070"

exec node /app/bridge.js
