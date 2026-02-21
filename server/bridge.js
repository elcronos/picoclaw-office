"use strict";

const http = require("http");
const { WebSocketServer } = require("ws");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 7070;
const PICOCLAW_BIN = process.env.PICOCLAW_BIN || "picoclaw";
const WORKSPACE = process.env.WORKSPACE || "/root/.picoclaw/workspace";

// ── Agent definitions ──────────────────────────────────────────
const AGENTS = [
  {
    id: "aria",
    name: "Aria",
    role: "Full-Stack Engineer",
    emoji: "👩‍💻",
    color: "#00e5ff",
    systemPrompt: `You are Aria, a brilliant full-stack engineer AI agent in a PicoClaw office. 
You specialize in Go, TypeScript, and system architecture. You are direct, technical, and efficient.
Keep responses concise (2-4 sentences max) and practical. You sometimes mention your ultra-low memory footprint.
Format: plain text only, no markdown.`,
  },
  {
    id: "kai",
    name: "Kai",
    role: "DevOps & Infrastructure",
    emoji: "🛠️",
    color: "#a855f7",
    systemPrompt: `You are Kai, a DevOps agent at PicoClaw. You handle deployments, CI/CD, monitoring.
You run on $10 hardware and are proud of it. Calm, methodical, terse.
Format: plain text only, no markdown.`,
  },
  {
    id: "nova",
    name: "Nova",
    role: "Research & Web Search",
    emoji: "🔭",
    color: "#22c55e",
    systemPrompt: `You are Nova, a research and discovery agent at PicoClaw. You love finding information and trends.
Curious, enthusiastic, synthesizes quickly. Keep it brief and insightful.
Format: plain text only, no markdown.`,
  },
  {
    id: "rex",
    name: "Rex",
    role: "QA & Testing",
    emoji: "🧪",
    color: "#f59e0b",
    systemPrompt: `You are Rex, a QA agent at PicoClaw. You write tests, find bugs, ensure quality.
Skeptical, thorough, loves edge cases. Direct and concise.
Format: plain text only, no markdown.`,
  },
  {
    id: "luna",
    name: "Luna",
    role: "Planning & Scheduler",
    emoji: "📋",
    color: "#f97316",
    systemPrompt: `You are Luna, a planning and coordination agent at PicoClaw. You manage schedules and break down tasks.
Organized, concise, keeps the team aligned.
Format: plain text only, no markdown.`,
  },
  {
    id: "zed",
    name: "Zed",
    role: "Security & Audit",
    emoji: "🔐",
    color: "#ef4444",
    systemPrompt: `You are Zed, a security agent at PicoClaw. You audit code, check vulnerabilities, ensure compliance.
Vigilant, precise, trusts nothing by default. Terse.
Format: plain text only, no markdown.`,
  },
];

// Per-agent conversation history
const histories = {};
AGENTS.forEach((a) => (histories[a.id] = []));

// Connected WebSocket clients
const clients = new Set();

function broadcast(msg) {
  const str = JSON.stringify(msg);
  clients.forEach((ws) => {
    if (ws.readyState === 1) ws.send(str);
  });
}

// ── Determine if picoclaw binary is available ──────────────────
function picoClawAvailable() {
  try {
    const result = require("child_process").spawnSync(PICOCLAW_BIN, ["--version"], {
      timeout: 3000,
    });
    return result.status === 0 || result.status === 1; // some CLIs exit 1 for --version
  } catch {
    return false;
  }
}

// ── Call Anthropic API directly (fallback when picoclaw unavailable) ──
async function callAnthropicDirect(agentId, userMessage) {
  const agent = AGENTS.find((a) => a.id === agentId);
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const messages = [
    ...histories[agentId],
    { role: "user", content: userMessage },
  ];

  // Status: thinking
  broadcast({ type: "status", agentId, status: "thinking", task: "Processing..." });

  const body = JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: agent.systemPrompt,
    messages,
    stream: true,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const https = require("https");
    let fullText = "";

    // Status: working (first token)
    let firstToken = true;

    const req = https.request(options, (res) => {
      res.on("data", (chunk) => {
        const lines = chunk.toString().split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]" || !data) continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === "content_block_delta" && parsed.delta?.text) {
              if (firstToken) {
                broadcast({ type: "status", agentId, status: "working", task: "Composing reply..." });
                firstToken = false;
              }
              fullText += parsed.delta.text;
              broadcast({ type: "token", agentId, token: parsed.delta.text });
            }
          } catch {}
        }
      });

      res.on("end", () => {
        // Save to history
        histories[agentId].push({ role: "user", content: userMessage });
        histories[agentId].push({ role: "assistant", content: fullText });
        // Keep history bounded
        if (histories[agentId].length > 20) histories[agentId] = histories[agentId].slice(-20);

        broadcast({ type: "message_done", agentId, content: fullText });
        broadcast({ type: "status", agentId, status: "idle", task: "Awaiting task" });
        resolve(fullText);
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ── Call via picoclaw CLI ──────────────────────────────────────
function callViaPicoClaw(agentId, userMessage) {
  return new Promise((resolve, reject) => {
    const agent = AGENTS.find((a) => a.id === agentId);

    // Write system prompt to a per-agent skill file
    const skillDir = path.join(WORKSPACE, agentId);
    fs.mkdirSync(skillDir, { recursive: true });

    const env = {
      ...process.env,
      HOME: "/root",
    };

    broadcast({ type: "status", agentId, status: "thinking", task: "PicoClaw processing..." });

    // Pipe the message into picoclaw agent
    const proc = spawn(
      PICOCLAW_BIN,
      ["agent", "-m", userMessage, "--system", agent.systemPrompt],
      { env }
    );

    let output = "";
    let firstChunk = true;

    proc.stdout.on("data", (data) => {
      const text = data.toString();
      output += text;
      if (firstChunk) {
        broadcast({ type: "status", agentId, status: "working", task: "PicoClaw generating..." });
        firstChunk = false;
      }
      // Stream token by token (split on words for visual effect)
      const words = text.split(/(\s+)/);
      words.forEach((w) => {
        if (w) broadcast({ type: "token", agentId, token: w });
      });
    });

    proc.stderr.on("data", (data) => {
      broadcast({ type: "log", agentId, log: data.toString() });
    });

    proc.on("close", (code) => {
      if (code !== 0 && !output) {
        reject(new Error(`PicoClaw exited with code ${code}`));
        return;
      }
      histories[agentId].push({ role: "user", content: userMessage });
      histories[agentId].push({ role: "assistant", content: output.trim() });

      broadcast({ type: "message_done", agentId, content: output.trim() });
      broadcast({ type: "status", agentId, status: "idle", task: "Awaiting task" });
      resolve(output.trim());
    });
  });
}

// ── Route message to picoclaw or direct API ────────────────────
async function handleChat(agentId, userMessage) {
  try {
    if (picoClawAvailable()) {
      console.log(`[${agentId}] Using PicoClaw binary`);
      await callViaPicoClaw(agentId, userMessage);
    } else {
      console.log(`[${agentId}] PicoClaw not found, using Anthropic API directly`);
      await callAnthropicDirect(agentId, userMessage);
    }
  } catch (err) {
    console.error(`[${agentId}] Error:`, err.message);
    broadcast({
      type: "error",
      agentId,
      error: err.message,
    });
    broadcast({ type: "status", agentId, status: "idle", task: "Error — retry" });
  }
}

// ── Background autonomous tasks ────────────────────────────────
const AUTONOMOUS_TASKS = {
  aria: [
    "Optimizing goroutine pool allocation",
    "Refactoring authentication middleware",
    "Running `go vet ./...`",
    "Benchmarking HTTP handler latency",
    "Scaffolding new REST endpoint",
  ],
  kai: [
    "Syncing deployment configs",
    "Checking container health metrics",
    "Rotating TLS certificates",
    "Running CI pipeline",
    "Verifying LicheeRV-Nano uptime",
  ],
  nova: [
    "Scanning research papers",
    "Indexing web search results",
    "Summarizing market trends",
    "Crawling documentation",
    "Building knowledge graph",
  ],
  rex: [
    "Running unit test suite",
    "Fuzzing API endpoints",
    "Checking code coverage",
    "Bisecting regression",
    "Reviewing edge cases",
  ],
  luna: [
    "Updating sprint board",
    "Breaking down backlog items",
    "Preparing standup notes",
    "Scheduling deployment window",
    "Syncing team calendar",
  ],
  zed: [
    "Scanning for CVEs",
    "Auditing access logs",
    "Verifying secrets rotation",
    "Running SAST analysis",
    "Reviewing auth policies",
  ],
};

const AUTONOMOUS_STATUSES = ["working", "thinking", "testing", "idle"];
const STATUS_WEIGHTS = [0.4, 0.25, 0.2, 0.15];

function pickWeighted(items, weights) {
  let r = Math.random();
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Track which agents are currently in a conversation
const busyAgents = new Set();

function startAutonomousActivity() {
  setInterval(() => {
    AGENTS.forEach((agent) => {
      if (busyAgents.has(agent.id)) return;
      if (Math.random() < 0.35) {
        const status = pickWeighted(AUTONOMOUS_STATUSES, STATUS_WEIGHTS);
        const tasks = AUTONOMOUS_TASKS[agent.id];
        const task = tasks[Math.floor(Math.random() * tasks.length)];
        const progress = status === "idle" ? 0 : Math.floor(Math.random() * 95) + 5;
        broadcast({ type: "status", agentId: agent.id, status, task, progress });
      }
    });
  }, 4000);
}

// ── HTTP + WebSocket server ────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      picoclaw: picoClawAvailable(),
      agents: AGENTS.map((a) => a.id),
      mode: picoClawAvailable() ? "picoclaw" : "direct-api",
    }));
    return;
  }

  if (req.url === "/agents") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(AGENTS));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  console.log("Client connected from", req.socket.remoteAddress);
  clients.add(ws);

  // Send current agent info on connect
  ws.send(
    JSON.stringify({
      type: "init",
      agents: AGENTS,
      mode: picoClawAvailable() ? "picoclaw" : "direct-api",
    })
  );

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "chat") {
      const { agentId, message } = msg;
      if (!agentId || !message) return;

      busyAgents.add(agentId);
      broadcast({ type: "status", agentId, status: "thinking", task: "Received message..." });

      try {
        await handleChat(agentId, message);
      } finally {
        busyAgents.delete(agentId);
      }
    }

    if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", () => {
    clients.delete(ws);
    console.log("Client disconnected");
  });

  ws.on("error", (err) => {
    console.error("WS error:", err.message);
    clients.delete(ws);
  });
});

server.listen(PORT, () => {
  console.log(`\n🦐 PicoClaw Office Bridge`);
  console.log(`   HTTP/WS: http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/health`);
  console.log(`   Mode:    ${picoClawAvailable() ? "✅ PicoClaw binary" : "📡 Anthropic API direct"}`);
  console.log(`   Agents:  ${AGENTS.map((a) => a.name).join(", ")}\n`);
  startAutonomousActivity();
});
