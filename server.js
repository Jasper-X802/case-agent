const express = require("express");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3900;
const FALLBACK_KEY = "sk-gRBj4F5geXno8iucOkmVlfOFXtbebMQj";
if (!process.env.SENSENOVA_API_KEY) process.env.SENSENOVA_API_KEY = FALLBACK_KEY;
const KB_DIR = "C:/Users/admin/Downloads/知识库";
const UPLOAD_DIR = path.join(__dirname, "uploads");
const SESS_DIR = path.join(__dirname, "sessions");

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Fix encoding for Chinese filenames
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf-8');
    const n = Date.now() + "-" + crypto.randomBytes(6).toString("hex") + path.extname(file.originalname);
    cb(null, n);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Sessions
let sessions = {};
function getSession(sid) {
  if (!sessions[sid]) sessions[sid] = {
    caseText: "", caseName: "", caseChunks: [], roles: [],
    modules: {
      advisor: { history: [] },
      stakeholder: { history: [] },
      simulation: { history: [], decisionPoints: [], currentDecisionIdx: -1 }
    },
    status: "idle", progress: 0
  };
  return sessions[sid];
}


// ===== Conversation Management =====
function ensureConv(modData) {
  if (!modData.conversations) {
    const id = generateId();
    modData.conversations = {};
    modData.conversations[id] = { id, name: '会话 1', history: [], created: Date.now() };
    modData.activeConv = id;
  }
  return modData.activeConv;
}
function generateId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).substr(2,4); }
function getActiveHistory(modData) {
  ensureConv(modData);
  const conv = modData.conversations[modData.activeConv];
  return conv ? conv.history : [];
}
function pushToActive(modData, entry) {
  ensureConv(modData);
  const conv = modData.conversations[modData.activeConv];
  if (conv) { conv.history.push(entry); if (conv.history.length > 100) conv.history = conv.history.slice(-100); }
}
function autoName(modData) {
  ensureConv(modData);
  const conv = modData.conversations[modData.activeConv];
  if (!conv) return;
  const first = conv.history.find(m => m.role === 'user');
  conv.name = first ? first.content.substring(0, 20) + '...' : '会话 ' + Object.keys(modData.conversations).length;
}

async function extractText(fp) {
  const ext = path.extname(fp).toLowerCase();
  try {
    if (ext === ".docx") { const r = await mammoth.extractRawText({ path: fp }); return r.value; }
    if (ext === ".pdf")  { const b = fs.readFileSync(fp); const d = await pdfParse(b); return d.text; }
    if (ext === ".txt")  return fs.readFileSync(fp, "utf-8");
  } catch (e) { console.error("提取错误:", e.message); }
  return "";
}

function chunkText(text, sz) {
  sz = sz || 600;
  const chunks = [];
  const paras = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
  for (const p of paras)
    for (let i = 0; i < p.length; i += sz)
      chunks.push(p.substring(i, i + sz).trim());
  return chunks;
}

// RAG
function simpleRAG(query, texts) {
  const qw = query.toLowerCase().split(/\s+/);
  const scores = texts.map((t, i) => {
    const low = t.toLowerCase();
    let s = 0;
    for (const w of qw) {
      if (w.length < 2) continue;
      const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(esc, "gi");
      const m = low.match(re);
      if (m) s += m.length * 2;
      if (low.includes(w)) s += 5;
    }
    return { idx: i, score: s };
  });
  scores.sort((a, b) => b.score - a.score);
  return scores.filter(x => x.score > 0).slice(0, 5).map(x => texts[x.idx]).slice(0, 3);
}

let kbTexts = [];
async function loadKB() {
  kbTexts = [];
  if (!fs.existsSync(KB_DIR)) return;
  const files = fs.readdirSync(KB_DIR).filter(f => /\.(pdf|txt)$/i.test(f));
  for (const f of files) {
    const text = await extractText(path.join(KB_DIR, f));
    const ps = text.split(/\n\s*\n/).filter(p => p.trim().length > 50);
    for (const p of ps)
      for (let i = 0; i < p.length; i += 800)
        kbTexts.push(p.substring(i, i + 800).trim());
  }
  console.log(`知识库加载完成: ${files.length} 篇论文, ${kbTexts.length} 文本块`);
}

const API_URL = "https://token.sensenova.cn/v1/chat/completions";

async function callLLM(msgs, temp) {
  temp = temp || 0.7;
  const key = process.env.SENSENOVA_API_KEY;
  if (!key) return { error: "未配置 API_KEY" };
  try {
    const r = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-v4-flash", messages: msgs, temperature: temp, stream: false })
    });
    const d = await r.json();
    if (d.error) return { error: d.error.message || JSON.stringify(d.error) };
    return { text: d.choices[0].message.content };
  } catch (e) { return { error: e.message }; }
}

async function extractRoles(text) {
  const key = process.env.SENSENOVA_API_KEY;
  if (key) {
    const r = await callLLM([
      { role: "system", content: "你是一个案例角色提取助手。从以下案例文本中提取所有关键的利益相关方人物/角色。考虑：政府官员、企业人员、群众、技术人员等各类角色。只输出JSON数组，格式[{\"name\":\"姓名\",\"title\":\"身份/职务\"}], 不要其他文字。每个对象必须包含name和title。" },
      { role: "user", content: text.substring(0, 6000) }
    ], 0.1);
    if (r.text) {
      try {
        const cl = r.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const roles = JSON.parse(cl);
        if (Array.isArray(roles) && roles.length) return roles.filter(x => x.name && x.title).slice(0, 12);
      } catch(e) {}
    }
  }
  // Fallback: keyword-based
  const lines = text.split("\n");
  const kws = ["书记","局长","主任","队长","镇长","乡长","村长","经理","总裁","总监","工程师","技术员","网格员","志愿者","村民","居民","商户","骑手","司机","教授","专家","代表","负责人","主席"];
  const found = [], seen = new Set();
  for (const line of lines) {
    for (const kw of kws) {
      const idx = line.indexOf(kw);
      if (idx >= 2) {
        let start = idx - 1;
        while (start > 0 && !/[。，；：、！？\s\n]/.test(line[start-1]) && idx-start < 6) start--;
        const name = line.substring(start, idx + kw.length).trim();
        if (name.length >= 2 && name.length <= 12 && !seen.has(name)) {
          seen.add(name);
          found.push({ name, title: kw });
          if (found.length >= 12) break;
        }
      }
    }
    if (found.length >= 12) break;
  }
  return found.length > 0 ? found : [{name:"分析人员",title:"角色1"},{name:"参与方",title:"角色2"},{name:"观察者",title:"角色3"}];
}

async function extractDPs(text) {
  const key = process.env.SENSENOVA_API_KEY;
  if (!key) return [];
  const r = await callLLM([
    { role: "system", content: "你是一个案例分析专家。阅读以下案例文本，找出案例发展过程中关键的3-5个决策节点。每个决策节点应该是案例中某个角色面临重要选择的时刻。\n\n输出格式为JSON数组，每个元素：{\"node\":\"决策节点描述\",\"question\":\"向用户提出的问题\",\"options\":[\"选项1\",\"选项2\",\"选项3\"]}\n\n注意：\n1. 每个决策节点必须基于案例真实内容\n2. options必须是从案例中提取的不同选择路径\n3. 只输出JSON，不要其他文字" },
    { role: "user", content: text.substring(0, 8000) }
  ], 0.3);
  if (!r.text) return [];
  try {
    const cl = r.text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const dps = JSON.parse(cl);
    if (Array.isArray(dps) && dps.length) return dps.slice(0, 5);
  } catch(e) {}
  return [];
}

async function loadCase(sid, filePath, fileName) {
  const sess = getSession(sid);
  sess.status = "loading"; sess.progress = 0;
  sess.caseName = fileName;
  sess.progress = 10;
  sess.caseText = await extractText(filePath);
  sess.progress = 30;
  sess.caseChunks = chunkText(sess.caseText);
  sess.progress = 50;
  sess.roles = await extractRoles(sess.caseText);
  sess.progress = 70;
  sess.modules.simulation.decisionPoints = await extractDPs(sess.caseText);
  sess.progress = 90;
  sess.status = "ready";
  sess.progress = 100;
  // Clean old sessions
  const keys = Object.keys(sessions);
  if (keys.length > 500) keys.slice(0, keys.length - 500).forEach(k => delete sessions[k]);
  return sess;
}

// Load simulation router
require('./sim-router')(app, sessions, callLLM, getActiveHistory, pushToActive, autoName);

// API: Get default cases
app.get("/api/default-cases", (req, res) => {
  const pubDir = path.join(__dirname, "public");
  const cases = [];
  if (fs.existsSync(pubDir)) {
    fs.readdirSync(pubDir).filter(f => f.endsWith(".docx")).forEach(f => {
      cases.push({ id: f.replace(/\./g, "_"), name: f.replace(/\.docx$/, ""), file: f });
    });
  }
  res.json({ cases });
});

// API: Load default case
app.post("/api/load-case", async (req, res) => {
  try {
    const sid = req.body.sid || crypto.randomBytes(8).toString("hex");
    const defFile = req.body.defaultFile;
    if (!defFile) return res.status(400).json({ error: "请指定案例文件" });
    const fp = path.join(__dirname, "public", defFile);
    if (!fs.existsSync(fp)) return res.status(404).json({ error: "案例文件不存在" });
    const sess = await loadCase(sid, fp, defFile);
    res.json({ success: true, sid, caseName: sess.caseName, roles: sess.roles, decisionPoints: sess.modules.simulation.decisionPoints });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// API: Upload case
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "请选择文件" });
    const sid = crypto.randomBytes(8).toString("hex");
    const sess = await loadCase(sid, file.path, file.originalname);
    res.json({ success: true, sid, caseName: sess.caseName, roles: sess.roles, decisionPoints: sess.modules.simulation.decisionPoints });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// API: Get session status
app.get("/api/session/:sid", (req, res) => {
  const sess = sessions[req.params.sid];
  if (!sess) return res.json({ error: "会话不存在", sid: req.params.sid });
  res.json({
    sid: req.params.sid, caseName: sess.caseName, roles: sess.roles,
    progress: sess.progress, status: sess.status,
    decisionPoints: sess.modules.simulation.decisionPoints,
    currentDecisionIdx: sess.modules.simulation.currentDecisionIdx
  });
});

// API: Chat
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sid, module, role } = req.body;
    if (!message) return res.status(400).json({ error: "消息不能为空" });
    const sess = sessions[sid];
    if (!sess) return res.status(400).json({ error: "会话不存在，请重新加载案例" });
    const mod = sess.modules[module];
    const activeHist = getActiveHistory(mod);
    if (!mod) return res.status(400).json({ error: "模块不存在" });

    let sys = "";
    let ctx = [];

    if (module === "advisor") {
      sys = "你是一位客观中立的公共管理政策顾问。回答要求：\n1. 所有回答必须严格基于案例文档内容\n2. 如果案例文档中没有相关信息，明确说明“案例中未提及”\n3. 禁止编造案例中不存在的内容\n4. 必须标注信息来源（引用案例原文片段）\n当前案例：" + sess.caseName;
      ctx = simpleRAG(message, sess.caseChunks);
    } else if (module === "stakeholder") {
      const r = role || (sess.roles.length > 0 ? sess.roles[0].name : "参与者");
      sys = "你正在扮演「" + r + "」这个角色。\n严格规则：\n1. 使用自然口语、情绪化表达\n2. 回答只能基于案例文档中的信息\n3. 如果案例文档中没有相关信息，用符合角色身份的口语表示不知道\n4. 禁止编造案例中不存在的情节、人物或细节\n5. 禁止调用任何外部知识\n当前案例：" + sess.caseName;
      ctx = simpleRAG(message, sess.caseChunks);
    } else if (module === "simulation") {
      const r = role || "参与者";
      const dps = sess.modules.simulation.decisionPoints;
      const dpInfo = dps.length ? "\n案例有以下决策节点待推进：" + dps.map((d,i) => "\n"+(i+1)+". "+d.node).join("") : "";
      sys = "你正在参与一场案例推演。你扮演的是「" + r + "」这个角色。\n严格规则：\n1. 用符合角色身份的口语化表达\n2. 严格基于案例文档推动情节发展\n3. 禁止编造案例中不存在的人物、事件或细节\n4. 如果用户问到你不知道的信息，回答“这个情况案例里没有提及”\n5. 保持角色一致性\n当前推演案例：" + sess.caseName + dpInfo;
      ctx = simpleRAG(message, sess.caseChunks);
    }

    let ctxStr = "";
    if (ctx.length) ctxStr = "\n【案例原文参考】\n" + ctx.join("\n---\n");
    const excerpt = sess.caseText.substring(0, 4000);
    const strict = "\n\n【硬性约束】你只能基于以上提供的案例原文内容回答。如果问题超出案例范围，你必须回答“案例材料中未涉及此内容”。严禁编造。\n";

    const msgs = [
      { role: "system", content: sys + strict + "\n\n【案例原文摘要】\n" + excerpt + "\n\n" + ctxStr },
      ...activeHist.slice(-8),
      { role: "user", content: message }
    ];

    const result = await callLLM(msgs, module === "stakeholder" ? 0.85 : 0.6);
    if (result.error) return res.status(500).json({ error: result.error });

    pushToActive(mod, { role: "user", content: message });
    pushToActive(mod, { role: "assistant", content: result.text });
    autoName(mod);

    res.json({ reply: result.text });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// API: Advance decision
app.post("/api/decision/advance", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const idx = sess.modules.simulation.currentDecisionIdx + 1;
  const dps = sess.modules.simulation.decisionPoints;
  sess.modules.simulation.currentDecisionIdx = idx;
  if (idx < dps.length) res.json({ decision: dps[idx], index: idx, total: dps.length });
  else res.json({ decision: null, index: idx, total: dps.length });
});

// API: Reset decisions
app.post("/api/decision/reset", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  sess.modules.simulation.currentDecisionIdx = -1;
  res.json({ success: true });
});

// API: Clear history
// API: Get role groups
app.get("/api/role-groups/:sid", async (req, res) => {
  const sess = sessions[req.params.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  if (sess.roles && sess.roles.length > 0) {
    // Use the existing roles (already extracted)
    res.json({ roles: sess.roles });
  } else {
    res.json({ roles: [] });
  }
});

// API: Get quick questions
app.get("/api/quick-questions/:sid/:module", async (req, res) => {
  const sess = sessions[req.params.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = req.params.module;
  // Check cache
  if (sess._quickQs && sess._quickQs[mod]) return res.json({ questions: sess._quickQs[mod] });
  const apiKey = process.env.SENSENOVA_API_KEY;
  if (!apiKey) {
    const fallback = { advisor: ['案例的核心矛盾是什么？','关键决策者有哪些？','政策工具有哪些？','案例的治理启示是什么？','主要利益冲突是什么？'], stakeholder: ['各方的核心诉求是什么？','冲突是怎么产生的？','各方有什么资源？','有哪些妥协方案？','案例中谁影响力最大？'], simulation: ['案例的背景是什么？','剧情走向如何？','关键转折点有哪些？','最终结果如何？','有什么经验教训？'] };
    if (!sess._quickQs) sess._quickQs = {};
    sess._quickQs[mod] = fallback[mod] || [];
    return res.json({ questions: sess._quickQs[mod] });
  }
  try {
    const excerpt = sess.caseText.substring(0, 3000);
    const prompts = {
      advisor: '根据以下案例摘要，生成5个决策情报顾问模块最常见的高频提问，输出JSON数组格式["q1","q2",...]。问题要针对此案例的具体内容，用中文。只输出JSON数组。案例摘要：',
      stakeholder: '根据以下案例摘要和角色列表，生成5个利益相关方博弈模块最常见的高频提问，输出JSON数组格式["q1","q2",...]。问题要针对此案例的具体角色和冲突，用中文。只输出JSON数组。角色：' + (sess.roles||[]).map(r=>r.name+'('+r.title+')').join(',') + ' 案例摘要：',
      simulation: '根据以下案例摘要，生成5个案例推演模块的探索性问题，输出JSON数组格式["q1","q2",...]。问题引导用户深入案例情境，用中文。只输出JSON数组。案例摘要：'
    };
    const r = await callLLM([{role:"system",content:"你是案例问题生成助手。"},{role:"user",content:prompts[mod] + excerpt.substring(0,2000)}], 0.3);
    if (r.text) {
      try {
        const cl = r.text.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
        const qs = JSON.parse(cl);
        if (Array.isArray(qs) && qs.length) {
          if (!sess._quickQs) sess._quickQs = {};
          sess._quickQs[mod] = qs.slice(0, 8);
          return res.json({ questions: sess._quickQs[mod] });
        }
      } catch(e) {}
    }
  } catch(e) {}
  // Fallback
  const fb = { advisor: ["案例的核心问题是什么？"], stakeholder: ["各方的诉求是什么？"], simulation: ["案例的关键情节？"] };
  if (!sess._quickQs) sess._quickQs = {};
  sess._quickQs[mod] = fb[mod] || [];
  res.json({ questions: sess._quickQs[mod] });
});

// API: List conversations
app.get("/api/conversations/:sid/:module", (req, res) => {
  const sess = sessions[req.params.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = sess.modules[req.params.module];
  if (!mod) return res.json({ error: "模块不存在" });
  ensureConv(mod);
  const list = Object.values(mod.conversations).map(c => ({ id: c.id, name: c.name, msgCount: c.history.length, created: c.created }));
  list.sort((a, b) => b.created - a.created);
  res.json({ conversations: list, active: mod.activeConv });
});

// API: Create conversation
app.post("/api/conversation/create", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = sess.modules[req.body.module];
  if (!mod) return res.json({ error: "模块不存在" });
  const id = generateId();
  const count = Object.keys(mod.conversations || {}).length + 1;
  mod.conversations[id] = { id, name: '会话 ' + count, history: [], created: Date.now() };
  mod.activeConv = id;
  res.json({ success: true, id, name: '会话 ' + count });
});

// API: Switch conversation
app.post("/api/conversation/switch", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = sess.modules[req.body.module];
  if (!mod) return res.json({ error: "模块不存在" });
  const id = req.body.conversationId;
  if (!mod.conversations || !mod.conversations[id]) return res.json({ error: '会话记录不存在' });
  mod.activeConv = id;
  res.json({ success: true, id });
});

// API: Delete conversation
app.post("/api/conversation/delete", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = sess.modules[req.body.module];
  if (!mod) return res.json({ error: "模块不存在" });
  const id = req.body.conversationId;
  if (!mod.conversations || !mod.conversations[id]) return res.json({ error: '会话记录不存在' });
  delete mod.conversations[id];
  const keys = Object.keys(mod.conversations);
  if (mod.activeConv === id) {
    mod.activeConv = keys.length > 0 ? keys[keys.length - 1] : null;
    if (!mod.activeConv) { const nid = generateId(); mod.conversations[nid] = { id: nid, name: '会话 1', history: [], created: Date.now() }; mod.activeConv = nid; }
  }
  res.json({ success: true, active: mod.activeConv });
});

// API: Rename conversation
app.post("/api/conversation/rename", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess) return res.json({ error: "会话不存在" });
  const mod = sess.modules[req.body.module];
  if (!mod) return res.json({ error: "模块不存在" });
  const conv = mod.conversations[req.body.conversationId];
  if (!conv) return res.json({ error: "会话记录不存在" });
  conv.name = req.body.name || conv.name;
  res.json({ success: true });
});

app.post("/api/clear", (req, res) => {
  const sess = sessions[req.body.sid];
  if (!sess || !req.body.module) return res.json({ error: "会话不存在" });
  sess.modules[req.body.module].history = [];
  res.json({ success: true });
});

// API: Status
app.get("/api/status", (req, res) => {
  res.json({ apiKey: !!process.env.SENSENOVA_API_KEY, kb: kbTexts.length > 0 ? "ready" : "empty" });
});

// API: Generate summary report
app.post("/api/simulation/report", async (req, res) => {
  try {
    const sess = sessions[req.body.sid];
    if (!sess) return res.json({ error: "会话不存在" });
    const history = sess.modules.simulation.history || [];
    if (history.length < 3) return res.json({ error: '推演内容不足，无法生成报告' });
    const excerpt = sess.caseText.substring(0, 4000);
    const histText = history.map(m => (m.character ? '[' + m.character + '] ' : '') + m.content).join('\n').substring(0, 4000);
    const sysPrompt = '你是一个案例教学分析专家。根据以下案例原文和推演历史，生成一份结构化的案例推演总结报告。\n\n'
      + '## 案例原文摘要\n' + excerpt.substring(0, 2000) + '\n\n'
      + '## 推演过程记录\n' + histText.substring(0, 3000) + '\n\n'
      + '请以JSON格式输出，包含以下字段：\n'
      + '1. caseReview: string - 案例核心情况回顾（200字以内）\n'
      + '2. keyChoices: array of {node, choice} - 用户的关键选择（列出推演过程中的决策节点和用户选择）\n'
      + '3. stakeholderPositions: array of {name, position} - 各利益方主要立场\n'
      + '4. decisionAnalysis: string - 决策节点分析（200字以内）\n'
      + '5. outcome: string - 推演结果说明（150字以内）\n'
      + '6. insights: array of string - 案例教学启示（3-5条）\n\n'
      + '严格基于案例原文和推演记录，禁止编造。只输出JSON，不要其他文字。';
    const result = await callLLM([{role:'system',content:sysPrompt},{role:'user',content:'请生成总结报告'}], 0.5);
    if (result.error) return res.status(500).json({ error: result.error });
    try {
      const bt3 = String.fromCharCode(96,96,96);
      const re1 = new RegExp(bt3 + 'json\\s*', 'g');
      const re2 = new RegExp(bt3 + '\\s*', 'g');
      const cl = result.text.replace(re1, '').replace(re2, '').trim();
      const report = JSON.parse(cl);
      return res.json({ success: true, report });
    } catch(e) {
      // Fallback: return raw text
      return res.json({ success: true, report: { caseReview: result.text.substring(0, 500), keyChoices: [], stakeholderPositions: [], decisionAnalysis: "", outcome: "", insights: [] } });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Start
async function start() {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(SESS_DIR)) fs.mkdirSync(SESS_DIR, { recursive: true });
  await loadKB();
  app.listen(PORT, '0.0.0.0', () => console.log("Case Agent 运行在 http://localhost:" + PORT));
}
start();
