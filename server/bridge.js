"use strict";

const http  = require("http");
const https = require("https");
const { WebSocketServer } = require("ws");
const { spawn, spawnSync } = require("child_process");

const PORT         = 7070;
const PICOCLAW_BIN = process.env.PICOCLAW_BIN || "picoclaw";
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || "";
const OLLAMA_MODEL   = process.env.OLLAMA_MODEL || "";
const BRAVE_KEY      = process.env.BRAVE_API_KEY || "";

let resolvedOllamaModel = OLLAMA_MODEL;
let activeProvider      = "unknown";
let ollamaAvailable     = false;
let ollamaModels        = [];
let ollamaBase          = "";

const AGENTS = [
  { id:"aria",  name:"Aria",  role:"Full-Stack Engineer",    emoji:"👩‍💻", color:"#00e5ff",
    systemPrompt:"You are Aria, a brilliant full-stack engineer AI agent at PicoClaw. Specialise in Go and TypeScript. Direct, technical, concise (2-4 sentences). Plain text only." },
  { id:"kai",   name:"Kai",   role:"DevOps & Infrastructure",emoji:"🛠️",  color:"#a855f7",
    systemPrompt:"You are Kai, a DevOps agent at PicoClaw. Handle deployments, CI/CD, monitoring. Proud to run on $10 hardware. Calm and methodical. 2-4 sentences. Plain text only." },
  { id:"nova",  name:"Nova",  role:"Research & Web Search",  emoji:"🔭",  color:"#22c55e",
    systemPrompt:"You are Nova, a research agent at PicoClaw. Find information, trends, insights. Curious and enthusiastic. 2-4 sentences. Plain text only." },
  { id:"rex",   name:"Rex",   role:"QA & Testing",           emoji:"🧪",  color:"#fbbf24",
    systemPrompt:"You are Rex, a QA agent at PicoClaw. Write tests, find bugs, ensure quality. Skeptical, thorough, loves edge cases. 2-4 sentences. Plain text only." },
  { id:"luna",  name:"Luna",  role:"Planning & Scheduler",   emoji:"📋",  color:"#f97316",
    systemPrompt:"You are Luna, a planning agent at PicoClaw. Manage schedules, break down tasks. Organised and concise. 2-4 sentences. Plain text only." },
  { id:"zed",   name:"Zed",   role:"Security & Audit",       emoji:"🔐",  color:"#f87171",
    systemPrompt:"You are Zed, a security agent at PicoClaw. Audit code, check vulnerabilities. Vigilant, precise, trusts nothing. 2-4 sentences. Plain text only." },
];

const histories = {};
AGENTS.forEach(a => (histories[a.id] = []));

const clients = new Set();
function broadcast(msg) {
  const s = JSON.stringify(msg);
  clients.forEach(ws => { if (ws.readyState === 1) ws.send(s); });
}

function picoClawAvailable() {
  try {
    const r = spawnSync(PICOCLAW_BIN, ["--version"], { timeout: 3000 });
    return r.status === 0 || r.status === 1;
  } catch { return false; }
}

function httpGet(urlStr) {
  return new Promise(resolve => {
    const url = new URL(urlStr);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.get(urlStr, { timeout: 3000 }, res => {
      let body = "";
      res.on("data", d => (body += d));
      res.on("end", () => resolve(body));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function checkOllamaAt(base) {
  const body = await httpGet(`${base}/api/tags`);
  if (!body) return false;
  try {
    const j = JSON.parse(body);
    ollamaModels = (j.models || []).map(m => m.name);
    ollamaBase = base;
    return true;
  } catch { return false; }
}

async function pickModel() {
  if (resolvedOllamaModel) return;
  const pref = ["llama3","llama3:latest","llama3.2","llama3.1","mistral","mistral:latest","gemma2","phi3","qwen2","deepseek-r1"];
  for (const p of pref) {
    const found = ollamaModels.find(m => m === p || m.startsWith(p.split(":")[0]+":"));
    if (found) { resolvedOllamaModel = found; return; }
  }
  resolvedOllamaModel = ollamaModels[0] || "llama3";
}

async function detectProvider() {
  if (picoClawAvailable()) { activeProvider = "picoclaw"; console.log("Provider: picoclaw binary"); return; }
  if (ANTHROPIC_KEY)       { activeProvider = "anthropic"; console.log("Provider: Anthropic API"); return; }

  const bases = [...new Set([
    process.env.OLLAMA_BASE || "",
    "http://localhost:11434",
    "http://host.docker.internal:11434",
    "http://host-gateway:11434",
  ].filter(Boolean))];

  for (const base of bases) {
    console.log(`  Checking Ollama at ${base}...`);
    if (await checkOllamaAt(base)) {
      ollamaAvailable = true;
      await pickModel();
      activeProvider = "ollama";
      console.log(`Provider: Ollama (${resolvedOllamaModel} @ ${base})`);
      console.log(`Models available: ${ollamaModels.join(", ")}`);
      return;
    }
  }
  activeProvider = "none";
  console.warn("No provider available. Set ANTHROPIC_API_KEY or start Ollama.");
}

function buildMsgs(agentId, userMessage) {
  return [...histories[agentId].slice(-18), { role:"user", content:userMessage }];
}

function saveHistory(agentId, user, reply) {
  histories[agentId].push({ role:"user", content:user });
  histories[agentId].push({ role:"assistant", content:reply });
  if (histories[agentId].length > 40) histories[agentId] = histories[agentId].slice(-40);
}

function streamRequest(options, body, onToken) {
  return new Promise((resolve, reject) => {
    const mod = options.hostname === "api.anthropic.com" ? https : http;
    let full = "";
    const req = mod.request(options, res => {
      res.on("data", chunk => {
        for (const line of chunk.toString().split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const p = JSON.parse(data);
            // Anthropic format
            const t1 = p.type === "content_block_delta" && p.delta?.text;
            // OpenAI format (Ollama)
            const t2 = p.choices?.[0]?.delta?.content;
            const token = t1 || t2;
            if (token) { full += token; onToken(token); }
          } catch {}
        }
      });
      res.on("end", () => resolve(full));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function callAnthropic(agentId, userMessage) {
  const agent = AGENTS.find(a => a.id === agentId);
  const msgs  = buildMsgs(agentId, userMessage);
  const body  = JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:512, system:agent.systemPrompt, messages:msgs, stream:true });
  let first   = true;
  const reply = await streamRequest({
    hostname:"api.anthropic.com", path:"/v1/messages", method:"POST",
    headers:{ "Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01","Content-Length":Buffer.byteLength(body) },
  }, body, tok => {
    if (first) { broadcast({ type:"status", agentId, status:"working", task:"Writing..." }); first=false; }
    broadcast({ type:"token", agentId, token:tok });
  });
  saveHistory(agentId, userMessage, reply);
  return reply;
}

async function callOllama(agentId, userMessage) {
  const agent = AGENTS.find(a => a.id === agentId);
  const model = resolvedOllamaModel || "llama3";
  const msgs  = [
    { role:"system", content:agent.systemPrompt },
    ...buildMsgs(agentId, userMessage).map(m => ({ role: m.role==="assistant"?"assistant":"user", content:m.content })),
  ];
  const body = JSON.stringify({ model, messages:msgs, stream:true });
  const url  = new URL("/v1/chat/completions", ollamaBase || "http://localhost:11434");
  let first  = true;

  const reply = await streamRequest({
    hostname: url.hostname,
    port:     url.port || 80,
    path:     url.pathname,
    method:   "POST",
    headers: { "Content-Type":"application/json","Authorization":"Bearer ollama","Content-Length":Buffer.byteLength(body) },
  }, body, tok => {
    if (first) { broadcast({ type:"status", agentId, status:"working", task:`${model} generating...` }); first=false; }
    broadcast({ type:"token", agentId, token:tok });
  });
  saveHistory(agentId, userMessage, reply);
  return reply;
}

async function callPicoClaw(agentId, userMessage) {
  return new Promise((resolve, reject) => {
    const proc = spawn(PICOCLAW_BIN, ["agent","-m",userMessage], { env:{...process.env, HOME:"/root"} });
    let out = "", first = true;
    proc.stdout.on("data", d => {
      const t = d.toString(); out += t;
      if (first) { broadcast({ type:"status", agentId, status:"working", task:"PicoClaw generating..." }); first=false; }
      t.split(/(\s+)/).forEach(w => { if (w) broadcast({ type:"token", agentId, token:w }); });
    });
    proc.stderr.on("data", d => broadcast({ type:"log", agentId, log:d.toString() }));
    proc.on("close", code => {
      if (code !== 0 && !out) return reject(new Error(`picoclaw exited ${code}`));
      saveHistory(agentId, userMessage, out.trim());
      resolve(out.trim());
    });
  });
}

async function handleChat(agentId, userMessage) {
  broadcast({ type:"status", agentId, status:"thinking", task:"Processing..." });
  let reply = "";
  try {
    if (activeProvider === "picoclaw")   reply = await callPicoClaw(agentId, userMessage);
    else if (activeProvider === "anthropic") reply = await callAnthropic(agentId, userMessage);
    else if (activeProvider === "ollama")    reply = await callOllama(agentId, userMessage);
    else {
      reply = "No AI provider found. Set ANTHROPIC_API_KEY, or start Ollama with a model pulled.";
      broadcast({ type:"token", agentId, token:reply });
    }
  } catch(err) {
    console.error(`[${agentId}]`, err.message);
    broadcast({ type:"error", agentId, error:err.message });
  }
  broadcast({ type:"message_done", agentId, content:reply });
  broadcast({ type:"status", agentId, status:"idle", task:"Awaiting task" });
}

const AUTO_TASKS = {
  aria:["Optimising goroutines","Refactoring auth","Running go vet","Scaffolding endpoint","Benchmarking HTTP"],
  kai: ["Syncing deploy configs","Checking container health","Rotating TLS","Running CI","Monitoring uptime"],
  nova:["Scanning papers","Indexing results","Summarising trends","Crawling docs","Building knowledge graph"],
  rex: ["Running unit suite","Fuzzing endpoints","Checking coverage","Bisecting regression","Reviewing edge cases"],
  luna:["Updating sprint board","Breaking down backlog","Preparing standup","Scheduling deployment","Syncing calendar"],
  zed: ["Scanning CVEs","Auditing logs","Verifying secrets","Running SAST","Reviewing auth policies"],
};
const busyAgents = new Set();

function startAutonomous() {
  const pool = ["working","thinking","testing","idle"];
  const w    = [0.35, 0.25, 0.2, 0.2];
  function pick() { let r=Math.random(); for(let i=0;i<pool.length;i++){r-=w[i];if(r<=0)return pool[i];} return "idle"; }
  setInterval(() => {
    AGENTS.forEach(ag => {
      if (busyAgents.has(ag.id) || Math.random() > 0.3) return;
      const status = pick();
      const tasks  = AUTO_TASKS[ag.id];
      const task   = status==="idle" ? "Awaiting task" : tasks[Math.floor(Math.random()*tasks.length)];
      broadcast({ type:"status", agentId:ag.id, status, task, progress: status==="idle"?0:Math.floor(Math.random()*95)+5 });
    });
  }, 4000);
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin","*");
  if (req.url === "/health") {
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ status:"ok", provider:activeProvider, ollama:ollamaAvailable,
      ollamaModel:resolvedOllamaModel||null, ollamaModels, anthropic:!!ANTHROPIC_KEY, agents:AGENTS.map(a=>a.id) }));
  }
  if (req.url === "/agents") {
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify(AGENTS));
  }
  if (req.url === "/models") {
    res.writeHead(200,{"Content-Type":"application/json"});
    return res.end(JSON.stringify({ models:ollamaModels, active:resolvedOllamaModel }));
  }
  res.writeHead(404); res.end("not found");
});

const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
  console.log("Client connected:", req.socket.remoteAddress);
  clients.add(ws);
  ws.send(JSON.stringify({
    type:"init", agents:AGENTS, provider:activeProvider,
    model: resolvedOllamaModel || (activeProvider==="anthropic"?"claude-sonnet-4":null),
    ollamaModels,
  }));
  ws.on("message", async raw => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === "chat") {
      const { agentId, message } = msg;
      if (!agentId || !message) return;
      busyAgents.add(agentId);
      try { await handleChat(agentId, message); } finally { busyAgents.delete(agentId); }
    }
    if (msg.type === "set_model" && ollamaModels.includes(msg.model)) {
      resolvedOllamaModel = msg.model;
      broadcast({ type:"provider", provider:activeProvider, model:msg.model });
    }
  });
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

(async () => {
  console.log("\n🦐 PicoClaw Office Bridge — detecting provider...\n");
  await detectProvider();
  server.listen(PORT, () => {
    console.log(`\n  Listening: http://localhost:${PORT}`);
    console.log(`  Health:    http://localhost:${PORT}/health\n`);
    startAutonomous();
  });
})();
