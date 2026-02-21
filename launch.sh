#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'

banner() {
  echo ""
  echo -e "${CYAN}${BOLD}"
  echo "  🦐  PicoClaw Office Launcher"
  echo "      Ultra-efficient AI agents in 3D"
  echo -e "${RESET}"
}

info()    { echo -e "  ${CYAN}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "  ${RED}✗${RESET} $*"; }
step()    { echo -e "\n  ${BOLD}$*${RESET}"; }

# ── Args ─────────────────────────────────────────────────────────
MODE="${1:-docker}"  # docker | node | help
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
BRAVE_API_KEY="${BRAVE_API_KEY:-}"

banner

if [ "$MODE" = "help" ]; then
  echo "  Usage: ./launch.sh [mode]"
  echo ""
  echo "  Modes:"
  echo "    docker   Build & run everything via Docker Compose (default)"
  echo "    node     Run bridge directly with Node.js (no Docker)"
  echo "    stop     Stop all running containers"
  echo "    logs     Tail bridge logs"
  echo ""
  echo "  Environment:"
  echo "    ANTHROPIC_API_KEY   Required. Your Anthropic API key."
  echo "    BRAVE_API_KEY       Optional. Enables web search in PicoClaw."
  echo ""
  exit 0
fi

if [ "$MODE" = "stop" ]; then
  step "Stopping PicoClaw Office..."
  docker compose down
  success "Stopped."
  exit 0
fi

if [ "$MODE" = "logs" ]; then
  docker compose logs -f picoclaw-bridge
  exit 0
fi

# ── Check API key ─────────────────────────────────────────────────
step "1. Checking configuration"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo ""
  warn "ANTHROPIC_API_KEY is not set."
  echo -e "     ${CYAN}Get yours at: https://console.anthropic.com${RESET}"
  echo ""
  read -rsp "  Enter your Anthropic API key: " ANTHROPIC_API_KEY
  echo ""
  if [ -z "$ANTHROPIC_API_KEY" ]; then
    error "No API key provided. Exiting."
    exit 1
  fi
fi

export ANTHROPIC_API_KEY
export BRAVE_API_KEY

success "API key set (${#ANTHROPIC_API_KEY} chars)"

# ── Mode: Docker ─────────────────────────────────────────────────
if [ "$MODE" = "docker" ]; then

  step "2. Checking Docker"
  if ! command -v docker &>/dev/null; then
    error "Docker not found. Install from https://docs.docker.com/get-docker/"
    echo ""
    echo "  Or run without Docker:"
    echo -e "  ${CYAN}./launch.sh node${RESET}"
    exit 1
  fi

  DOCKER_VERSION=$(docker --version)
  success "Docker found: $DOCKER_VERSION"

  if ! docker compose version &>/dev/null 2>&1; then
    error "Docker Compose v2 not found. Update Docker or install compose plugin."
    exit 1
  fi
  success "Docker Compose found"

  step "3. Building PicoClaw container"
  info "Cloning sipeed/picoclaw and compiling Go binary..."
  info "This takes ~2 minutes on first run (cached after that)"
  echo ""

  docker compose build --progress=plain 2>&1 | grep -E '(Step|RUN|COPY|FROM|Successfully|error|Error|----)' || true

  step "4. Installing Node dependencies in container"
  docker compose run --rm --no-deps picoclaw-bridge sh -c "cd /app && npm install" 2>/dev/null || true

  step "5. Starting services"
  docker compose up -d

  # Wait for health
  echo ""
  info "Waiting for bridge to become healthy..."
  ATTEMPTS=0
  until curl -sf http://localhost:7070/health >/dev/null 2>&1; do
    sleep 1
    ATTEMPTS=$((ATTEMPTS+1))
    if [ $ATTEMPTS -gt 30 ]; then
      error "Bridge did not start in time. Check logs: ./launch.sh logs"
      exit 1
    fi
    echo -n "."
  done
  echo ""

  HEALTH=$(curl -s http://localhost:7070/health)
  PICOCLAW_STATUS=$(echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); print('✅ picoclaw binary' if d.get('picoclaw') else '📡 direct API')" 2>/dev/null || echo "unknown")

  echo ""
  success "Bridge is running"
  success "Mode: $PICOCLAW_STATUS"
  success "Agents: aria, kai, nova, rex, luna, zed"

  step "6. Launching UI"
  UI_URL="http://localhost:8080"

  # Try to open browser
  if command -v open &>/dev/null; then
    open "$UI_URL"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "$UI_URL"
  elif command -v start &>/dev/null; then
    start "$UI_URL"
  fi

  echo ""
  echo -e "  ${GREEN}${BOLD}🦐 PicoClaw Office is running!${RESET}"
  echo ""
  echo -e "  ${CYAN}UI:${RESET}     $UI_URL"
  echo -e "  ${CYAN}Bridge:${RESET} http://localhost:7070"
  echo -e "  ${CYAN}Health:${RESET} http://localhost:7070/health"
  echo ""
  echo -e "  ${YELLOW}Stop:${RESET}   ./launch.sh stop"
  echo -e "  ${YELLOW}Logs:${RESET}   ./launch.sh logs"
  echo ""

# ── Mode: Node (no Docker) ────────────────────────────────────────
elif [ "$MODE" = "node" ]; then

  step "2. Checking Node.js"
  if ! command -v node &>/dev/null; then
    error "Node.js not found. Install from https://nodejs.org"
    exit 1
  fi
  NODE_V=$(node --version)
  success "Node.js $NODE_V"

  step "3. Installing dependencies"
  cd "$(dirname "$0")/server"
  npm install --silent
  success "Dependencies installed"

  step "4. Checking PicoClaw binary"
  if command -v picoclaw &>/dev/null; then
    success "PicoClaw binary found: $(which picoclaw)"
  else
    warn "PicoClaw binary not found in PATH"
    info "Bridge will use Anthropic API directly (still fully functional)"
    info "To install PicoClaw: https://github.com/sipeed/picoclaw"
  fi

  step "5. Starting bridge"
  cd "$(dirname "$0")/server"

  # Start bridge in background
  node bridge.js &
  BRIDGE_PID=$!

  # Wait for startup
  sleep 2
  if ! kill -0 $BRIDGE_PID 2>/dev/null; then
    error "Bridge failed to start. Check output above."
    exit 1
  fi
  success "Bridge running (PID $BRIDGE_PID)"

  step "6. Serving UI"
  UI_PORT=8080
  cd "$(dirname "$0")"

  # Use npx serve if available, otherwise Python
  if command -v npx &>/dev/null; then
    npx --yes serve public -p $UI_PORT -s &
    SERVE_PID=$!
  elif command -v python3 &>/dev/null; then
    python3 -m http.server $UI_PORT --directory public &
    SERVE_PID=$!
  else
    warn "No static server found. Open public/index.html manually."
    SERVE_PID=""
  fi

  UI_URL="http://localhost:$UI_PORT"
  sleep 1

  if command -v open &>/dev/null; then open "$UI_URL"
  elif command -v xdg-open &>/dev/null; then xdg-open "$UI_URL"
  fi

  echo ""
  echo -e "  ${GREEN}${BOLD}🦐 PicoClaw Office is running!${RESET}"
  echo ""
  echo -e "  ${CYAN}UI:${RESET}     $UI_URL"
  echo -e "  ${CYAN}Bridge:${RESET} http://localhost:7070"
  echo ""
  echo -e "  ${YELLOW}Press Ctrl+C to stop all services${RESET}"
  echo ""

  # Trap to kill child processes on exit
  cleanup() {
    echo ""
    info "Shutting down..."
    kill $BRIDGE_PID 2>/dev/null || true
    [ -n "$SERVE_PID" ] && kill $SERVE_PID 2>/dev/null || true
    success "Stopped."
  }
  trap cleanup EXIT INT TERM
  wait $BRIDGE_PID

fi
