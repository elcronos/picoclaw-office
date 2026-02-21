#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "  ${CYAN}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "  ${RED}✗${RESET} $*"; exit 1; }
step()    { echo -e "\n  ${BOLD}$*${RESET}"; }

MODE="${1:-docker}"

echo ""
echo -e "${CYAN}${BOLD}  🦐 PicoClaw Office Launcher${RESET}"
echo ""

if [ "$MODE" = "help" ]; then
  echo "  Usage: ./launch.sh [mode]"
  echo ""
  echo "  Modes:"
  echo "    docker   Build & run via Docker Compose (default)"
  echo "    node     Run bridge with Node.js, no Docker"
  echo "    stop     Stop containers"
  echo "    logs     Tail bridge logs"
  echo ""
  echo "  Provider priority (auto-detected):"
  echo "    1. PicoClaw binary in PATH (uses its own config)"
  echo "    2. ANTHROPIC_API_KEY env var → Anthropic API"
  echo "    3. Ollama running locally  → free, no key needed"
  echo ""
  echo "  Ollama env vars (optional):"
  echo "    OLLAMA_BASE   URL of Ollama server (default: http://localhost:11434)"
  echo "    OLLAMA_MODEL  Model to use (default: auto-picked from installed)"
  echo ""
  exit 0
fi

if [ "$MODE" = "stop" ]; then
  docker compose down && echo "  Stopped." && exit 0
fi
if [ "$MODE" = "logs" ]; then
  docker compose logs -f picoclaw-bridge; exit 0
fi

# ── Detect provider ─────────────────────────────────────────────
step "1. Detecting AI provider"

ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
OLLAMA_BASE="${OLLAMA_BASE:-http://localhost:11434}"
OLLAMA_MODEL="${OLLAMA_MODEL:-}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"

PROVIDER=""

# Check PicoClaw binary
if command -v picoclaw &>/dev/null; then
  PROVIDER="picoclaw"
  success "PicoClaw binary found: $(which picoclaw)"
fi

# Check Anthropic key
if [ -z "$PROVIDER" ] && [ -n "$ANTHROPIC_API_KEY" ]; then
  PROVIDER="anthropic"
  success "Anthropic API key set — using Anthropic"
fi

# Check Ollama
if [ -z "$PROVIDER" ]; then
  OLLAMA_BASES="${OLLAMA_BASE} http://localhost:11434 http://127.0.0.1:11434"
  for base in $OLLAMA_BASES; do
    if curl -sf "${base}/api/tags" -o /tmp/ollama-tags.json --max-time 2 2>/dev/null; then
      PROVIDER="ollama"
      OLLAMA_BASE="$base"
      MODELS=$(python3 -c "import json,sys; d=json.load(open('/tmp/ollama-tags.json')); print(' '.join([m['name'] for m in d.get('models',[])]))" 2>/dev/null || echo "")
      if [ -z "$MODELS" ]; then
        warn "Ollama is running but has no models pulled."
        echo ""
        echo "  Pull a model first:"
        echo -e "  ${CYAN}ollama pull llama3${RESET}"
        echo ""
        read -rp "  Pull llama3 now? [Y/n] " PULL
        if [[ "${PULL:-Y}" =~ ^[Yy] ]]; then
          ollama pull llama3
          OLLAMA_MODEL="llama3"
        else
          PROVIDER=""
        fi
      else
        success "Ollama found at $base"
        success "Models available: $MODELS"
        if [ -z "$OLLAMA_MODEL" ]; then
          # Auto-pick first preferred model
          for pref in llama3 llama3.2 llama3.1 mistral gemma2 phi3 qwen2; do
            for m in $MODELS; do
              if [[ "$m" == "${pref}"* ]]; then
                OLLAMA_MODEL="$m"
                break 2
              fi
            done
          done
          [ -z "$OLLAMA_MODEL" ] && OLLAMA_MODEL=$(echo "$MODELS" | awk '{print $1}')
        fi
        success "Using model: $OLLAMA_MODEL"
      fi
      break
    fi
  done
fi

# Still nothing — prompt for Anthropic key
if [ -z "$PROVIDER" ]; then
  echo ""
  warn "No provider found."
  echo ""
  echo "  Options:"
  echo "    A) Enter Anthropic API key (get one free at console.anthropic.com)"
  echo "    B) Install Ollama (free, runs locally): https://ollama.com"
  echo "    C) Install PicoClaw: https://github.com/sipeed/picoclaw"
  echo ""
  read -rsp "  Anthropic API key (or press Enter to skip): " ANTHROPIC_API_KEY
  echo ""
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    PROVIDER="anthropic"
    success "Using Anthropic API"
  else
    warn "Continuing without a provider — agents will show an error message when chatted to."
    PROVIDER="none"
  fi
fi

export ANTHROPIC_API_KEY OLLAMA_BASE OLLAMA_MODEL BRAVE_API_KEY

echo ""
echo -e "  ${BOLD}Provider: ${CYAN}${PROVIDER}${RESET}"
[ "$PROVIDER" = "ollama" ] && echo -e "  ${BOLD}Model:    ${CYAN}${OLLAMA_MODEL}${RESET}"
echo ""

# ── Docker mode ─────────────────────────────────────────────────
if [ "$MODE" = "docker" ]; then
  step "2. Checking Docker"
  command -v docker &>/dev/null || error "Docker not found. Run: ./launch.sh node"
  success "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

  step "3. Building image (compiles PicoClaw from source)"
  info "First build takes ~2 min; subsequent runs use cache"
  docker compose build 2>&1 | tail -5

  step "4. Starting services"
  docker compose up -d

  info "Waiting for bridge..."
  for i in $(seq 1 30); do
    curl -sf http://localhost:7070/health >/dev/null 2>&1 && break
    sleep 1; printf "."
  done
  echo ""

  HEALTH=$(curl -s http://localhost:7070/health 2>/dev/null || echo "{}")
  PROV=$(python3 -c "import json,sys; d=json.loads('${HEALTH//\'/}'); print(d.get('provider','?'))" 2>/dev/null || echo "?")
  success "Bridge running (provider: $PROV)"

  step "5. Opening UI"
  UI="http://localhost:8080"
  command -v open &>/dev/null && open "$UI" || \
  command -v xdg-open &>/dev/null && xdg-open "$UI" || true

  echo ""
  echo -e "  ${GREEN}${BOLD}🦐 PicoClaw Office is live!${RESET}"
  echo ""
  echo -e "  ${CYAN}UI${RESET}     → $UI"
  echo -e "  ${CYAN}Bridge${RESET} → http://localhost:7070"
  echo -e "  ${CYAN}Health${RESET} → http://localhost:7070/health"
  echo ""
  echo -e "  ${YELLOW}Stop:${RESET} ./launch.sh stop  |  ${YELLOW}Logs:${RESET} ./launch.sh logs"
  echo ""

# ── Node mode ───────────────────────────────────────────────────
elif [ "$MODE" = "node" ]; then
  step "2. Checking Node.js"
  command -v node &>/dev/null || error "Node.js not found: https://nodejs.org"
  success "Node.js $(node --version)"

  step "3. Installing bridge dependencies"
  cd "$(dirname "$0")/server"
  npm install --silent && success "Dependencies ready"

  step "4. Starting bridge"
  node bridge.js &
  BRIDGE_PID=$!
  sleep 2
  kill -0 $BRIDGE_PID 2>/dev/null || error "Bridge failed — check output above"
  success "Bridge running (PID $BRIDGE_PID)"

  step "5. Serving UI"
  cd "$(dirname "$0")"
  UI_PORT=8080
  if command -v npx &>/dev/null; then
    npx --yes serve public -p $UI_PORT -s --no-clipboard &>/dev/null &
    SERVE_PID=$!
  elif command -v python3 &>/dev/null; then
    python3 -m http.server $UI_PORT --directory public &>/dev/null &
    SERVE_PID=$!
  else
    SERVE_PID=""; warn "No static server — open public/index.html manually"
  fi
  sleep 1

  UI="http://localhost:$UI_PORT"
  command -v open &>/dev/null && open "$UI" || \
  command -v xdg-open &>/dev/null && xdg-open "$UI" || true

  echo ""
  echo -e "  ${GREEN}${BOLD}🦐 PicoClaw Office is live!${RESET}"
  echo ""
  echo -e "  ${CYAN}UI${RESET}     → $UI"
  echo -e "  ${CYAN}Bridge${RESET} → http://localhost:7070"
  echo ""
  echo -e "  ${YELLOW}Ctrl+C to stop${RESET}"
  echo ""

  cleanup() { kill $BRIDGE_PID 2>/dev/null; [ -n "${SERVE_PID:-}" ] && kill $SERVE_PID 2>/dev/null; echo "Stopped."; }
  trap cleanup EXIT INT TERM
  wait $BRIDGE_PID
fi
