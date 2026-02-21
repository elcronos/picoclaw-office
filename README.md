# 🦐 PicoClaw Office

A real-time 3D office environment where [PicoClaw](https://github.com/sipeed/picoclaw) AI agents work, collaborate, and chat — live.

![PicoClaw Office](https://img.shields.io/badge/PicoClaw-v0.0.1-00e5ff?style=flat-square)
![Go](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat-square&logo=go)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=flat-square&logo=node.js)
![Three.js](https://img.shields.io/badge/Three.js-r128-black?style=flat-square)

---

## What is this?

PicoClaw Office visualises a team of AI agents in a 3D office. Each agent is:

- **Real** — powered by the PicoClaw binary (Go, <10MB RAM) or Anthropic API directly
- **Live** — conversations stream token-by-token via WebSocket
- **In character** — each agent has a distinct role, personality, and visual presence

The 6 agents:

| Agent | Role | Specialty |
|-------|------|-----------|
| 👩‍💻 Aria | Full-Stack Engineer | Go, TypeScript, Architecture |
| 🛠️ Kai | DevOps & Infrastructure | Deployments, CI/CD, $10 hardware |
| 🔭 Nova | Research & Web Search | Trends, Papers, Synthesis |
| 🧪 Rex | QA & Testing | Bugs, Coverage, Edge Cases |
| 📋 Luna | Planning & Scheduler | Sprints, Breakdown, Alignment |
| 🔐 Zed | Security & Audit | CVEs, Access, Compliance |

---

## Quick Start

### Option A: Docker (recommended)

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/picoclaw-office.git
cd picoclaw-office

# 2. Set your API key
export ANTHROPIC_API_KEY=sk-ant-api03-...

# 3. Launch
./launch.sh
```

The launcher will:
- Build PicoClaw from source inside Docker (compiles Go binary)
- Start the WebSocket bridge on port 7070
- Serve the 3D UI on port 8080
- Open your browser automatically

### Option B: Node.js only (no Docker)

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-...
./launch.sh node
```

The bridge auto-detects whether the `picoclaw` binary is in your PATH:
- **If found** → routes all agent messages through real PicoClaw processes
- **If not found** → calls Anthropic API directly with streaming (still fully real)

---


---

## 🦙 Running with Ollama (free, no API key)

Ollama lets you run models locally — completely free, no account needed.

### 1. Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: download from https://ollama.com
```

### 2. Pull a model

```bash
ollama pull llama3        # recommended (4GB)
ollama pull mistral       # smaller, fast
ollama pull gemma2        # Google's model
ollama pull phi3          # very small, fast
```

### 3. Launch PicoClaw Office

```bash
# Auto-detects Ollama if no ANTHROPIC_API_KEY is set
./launch.sh

# Or specify model explicitly:
OLLAMA_MODEL=mistral ./launch.sh

# Or use the UI directly (no bridge needed):
# Open public/index.html → click "🦙 Ollama" tab
```

### Provider priority (auto-detected)

```
1. PicoClaw binary in PATH
2. ANTHROPIC_API_KEY set → Anthropic API
3. Ollama running locally → free local AI
4. None found → agents show error, prompt for key
```

### Supported Ollama models

| Model | Size | Notes |
|-------|------|-------|
| `llama3` | 4.7GB | Best balance, recommended |
| `llama3.2` | 2GB | Smaller, still excellent |
| `mistral` | 4.1GB | Fast, good reasoning |
| `gemma2` | 5.5GB | Google's model |
| `phi3` | 2.3GB | Very fast, smaller context |
| `qwen2` | 4.4GB | Good multilingual |
| `deepseek-r1` | varies | Strong reasoning |

Any OpenAI-compatible model works — the bridge uses `/v1/chat/completions`.

## Architecture

```
Browser (Three.js 3D UI)
    │
    │  WebSocket (ws://localhost:7070)
    ▼
bridge.js (Node.js)
    │
    ├─ picoclaw binary available?
    │       YES → spawn picoclaw agent -m "..." (real PicoClaw)
    │       NO  → HTTPS stream to api.anthropic.com (direct API)
    │
    └─ broadcasts tokens/status back to all WebSocket clients
```

The UI connects to the bridge via WebSocket and receives:
- `status` events → updates agent card (working / thinking / testing / idle / done)
- `token` events → streams response character-by-character into chat bubble
- `message_done` events → finalises the message

---

## Running Commands

```bash
./launch.sh          # Docker mode (default)
./launch.sh node     # Node.js mode (no Docker)
./launch.sh stop     # Stop all containers
./launch.sh logs     # Tail bridge logs
./launch.sh help     # Show help
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `BRAVE_API_KEY` | No | Enables web search in PicoClaw |

---

## How PicoClaw Integration Works

When the `picoclaw` binary is present, the bridge does:

```bash
picoclaw agent -m "your message" --system "agent personality..."
```

PicoClaw handles:
- LLM routing (Anthropic, OpenRouter, Zhipu, etc.)
- Tool use (web search via Brave API)
- Workspace persistence
- Ultra-low memory operation (<10MB)

The bridge streams stdout back to the browser via WebSocket, giving you real PicoClaw agent output visualised in 3D.

---

## Project Structure

```
picoclaw-office/
├── launch.sh              # Main launcher script
├── docker-compose.yml     # Docker Compose config
├── docker/
│   ├── Dockerfile         # Builds PicoClaw + Node bridge
│   ├── bridge.js          # WebSocket bridge server
│   ├── package.json       # Node dependencies (ws)
│   ├── entrypoint.sh      # Container startup
│   └── picoclaw-config-template.json
├── server/
│   ├── bridge.js          # Bridge (dev copy)
│   └── package.json
└── public/
    └── index.html         # 3D office UI (Three.js)
```

---

## Credits

- [PicoClaw](https://github.com/sipeed/picoclaw) by Sipeed — ultra-lightweight AI agent in Go
- [Three.js](https://threejs.org/) — 3D rendering
- [Anthropic Claude](https://anthropic.com) — the AI behind the agents
