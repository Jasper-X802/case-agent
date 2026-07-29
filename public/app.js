// State
let S = { sid: null, caseName: '', roles: [], curTab: 'advisor', sidebarOpen: true };
let simRunning = false;
let selectedRoles = [];
let quickQuestions = { advisor: [], stakeholder: [], simulation: [] };

// Theme
function initTheme() {
  const t = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', t);
}
function toggleTheme() {
  const c = document.documentElement.getAttribute('data-theme');
  const n = c === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', n);
  localStorage.setItem('theme', n);
}

// Router
function go(page) {
  document.getElementById('app').innerHTML = '';
  page === 'home' ? renderHome() : renderSim();
}

// ===== Home =====
function renderHome() {
  const app = document.getElementById('app');
  app.innerHTML = document.getElementById('home-page').innerHTML;
  initTheme();
  document.getElementById('home-theme').onclick = toggleTheme;
  setupUpload(); loadCases();
}

function setupUpload() {
  const z = document.getElementById('upload-zone');
  const fi = document.getElementById('file-input');
  document.getElementById('upload-btn').onclick = () => fi.click();
  z.onclick = () => fi.click();
  z.ondragover = e => { e.preventDefault(); z.classList.add('dragover'); };
  z.ondragleave = () => z.classList.remove('dragover');
  z.ondrop = e => { e.preventDefault(); z.classList.remove('dragover'); if (e.dataTransfer.files[0]) doUpload(e.dataTransfer.files[0]); };
  fi.onchange = e => { if (e.target.files[0]) doUpload(e.target.files[0]); };
}

async function loadCases() {
  try {
    const r = await fetch('/api/default-cases');
    const d = await r.json();
    const grid = document.getElementById('case-grid'); grid.innerHTML = '';
    if (!d.cases||!d.cases.length) { grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3)">暂无默认案例</p>'; return; }
    d.cases.forEach(c => {
      const cd = document.createElement('div'); cd.className = 'case-card';
      cd.innerHTML = '<div class="case-card-title">'+c.name.replace(/\.docx$/,'').substring(0,22)+'</div><div class="case-card-desc">点击加载此案例</div>';
      cd.onclick = () => loadCase(c.file); grid.appendChild(cd);
    });
  } catch(e) { document.getElementById('case-grid').innerHTML = '<p>加载失败: '+e.message+'</p>'; }
}

function doUpload(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['docx','pdf','txt'].includes(ext)) { alert('仅支持 docx/pdf/txt'); return; }
  if (file.size > 50*1024*1024) { alert('文件超过50MB'); return; }
  const fd = new FormData(); fd.append('file', file);
  showProgress(0);
  fetch('/api/upload', {method:'POST',body:fd})
    .then(r=>r.json()).then(d => {
      if (d.success) { Object.assign(S, {sid:d.sid,caseName:d.caseName,roles:d.roles||[]});
        simProgress(() => go('sim')); }
      else { alert('上传失败: '+(d.error||'')); hideProgress(); }
    }).catch(e => { alert(e.message); hideProgress(); });
}

function loadCase(file) {
  showProgress(0);
  fetch('/api/load-case', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({defaultFile:file})})
    .then(r=>r.json()).then(d => {
      if (d.success) { Object.assign(S, {sid:d.sid,caseName:d.caseName,roles:d.roles||[]});
        simProgress(() => go('sim')); }
      else { alert(d.error||''); hideProgress(); }
    }).catch(e => { alert(e.message); hideProgress(); });
}

function showProgress(p) {
  let o = document.getElementById('prog-overlay');
  if (!o) { document.body.appendChild(document.getElementById('progress-overlay').content.cloneNode(true)); o = document.getElementById('prog-overlay'); }
  const f = document.getElementById('prog-fill'); const t = document.getElementById('prog-txt');
  if (f) f.style.width = (p||0)+'%';
}
function hideProgress() {
  const o = document.getElementById('prog-overlay'); if (o) o.remove();
}

function simProgress(cb) {
  const steps = [0,18,35,50,65,82,100];
  const texts = ['准备中','解析文档','文本处理','提取角色','分析决策','初始化','完成'];
  let i = 0;
  function tick() {
    if (i >= steps.length) { setTimeout(() => { hideProgress(); cb(); }, 150); return; }
    const f = document.getElementById('prog-fill'); const t = document.getElementById('prog-txt');
    if (f) f.style.width = steps[i]+'%'; if (t) t.textContent = texts[i];
    i++; setTimeout(tick, 280);
  }
  tick();
}

// ===== Simulation =====
function renderSim() {
  hideProgress();
  const app = document.getElementById('app');
  app.innerHTML = document.getElementById('sim-page').innerHTML;
  initTheme();
  document.getElementById('sim-theme').onclick = toggleTheme;
  document.getElementById('back-home').onclick = () => go('home');
  document.getElementById('sim-case-label').textContent = (S.caseName||'').substring(0,16);

  // Tab switching
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      S.curTab = t.dataset.tab;
      document.getElementById('tab-'+S.curTab).classList.add('active');
      loadConvList();
    };
  });
  document.querySelector('.tab').click();

  // New conversation
  document.getElementById('btn-new-conv').onclick = createConv;
  document.getElementById('btn-menu').onclick = () => {
    const sb = document.getElementById('sidebar');
    S.sidebarOpen = !S.sidebarOpen; sb.style.display = S.sidebarOpen ? 'flex' : 'none';
  };

  // Quick questions
  loadQuickQuestions();

  // Module inputs
  setupMod('advisor'); setupMod('stakeholder'); setupMod('simulation');
  loadRolePanel();

  // Start sim
  document.getElementById('btn-start-sim').onclick = startSim;

  // Load conversations
  loadConvList();
}

function setupMod(mod) {
  const inp = document.getElementById('inp-'+mod); if (!inp) return;
  const btn = document.querySelector('[data-mod="'+mod+'"]');
  function send() {
    const t = inp.value.trim(); if (!t) return;
    addMsg(mod, 'user', t); inp.value = '';
    chat(mod, t);
  }
  if (btn) btn.onclick = send;
  inp.onkeydown = e => { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); send(); } };
  inp.oninput = () => { inp.style.height='auto'; inp.style.height=Math.min(inp.scrollHeight,80)+'px'; };
}

function addMsg(mod, role, content, avatar) {
  const c = document.getElementById('msgs-'+mod); if (!c) return;
  const w = c.querySelector('.welc'); if (w) w.remove();
  const msg = document.createElement('div'); msg.className = 'msg '+role;
  if (role==='ai' && avatar) {
    const r = document.createElement('div'); r.className = 'ar';
    r.innerHTML = '<span class="av">'+avatar.charAt(0)+'</span><span class="an">'+avatar+'</span>';
    msg.appendChild(r);
  }
  if (role==='ai' && !avatar && content.startsWith('【旁白】')) {
    const l = document.createElement('div'); l.className = 'nl';
    l.textContent = '★ 旁白 narration'; msg.appendChild(l);
  }
  const d = document.createElement('div'); d.textContent = content; msg.appendChild(d);
  c.appendChild(msg); c.scrollTop = c.scrollHeight;
}

async function chat(mod, msg) {
  try {
    const role = S.roles[0]?.name || '用户';
    const r = await fetch('/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,sid:S.sid,module:mod,role})});
    const d = await r.json();
    if (d.reply) addMsg(mod, 'ai', d.reply, role);
    else addMsg(mod, 'ai', '[错误] '+(d.error||''));
  } catch(e) { addMsg(mod, 'ai', '[网络错误] '+e.message); }
}

// ===== Conversations =====
async function loadConvList() {
  const list = document.getElementById('conv-list'); if (!list) return;
  list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">加载中...</div>';
  try {
    const r = await fetch('/api/conversations/'+S.sid+'/'+S.curTab);
    const d = await r.json();
    list.innerHTML = '';
    if (!d.conversations||!d.conversations.length) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3);font-size:12px">暂无对话，点击上方新建</div>'; return;
    }
    d.conversations.forEach(c => {
      const item = document.createElement('div');
      item.className = 'conv-item' + (c.id===d.active ? ' active' : '');
      item.innerHTML = '<div class="conv-name">'+c.name+'</div><div class="conv-meta">'+c.msgCount+' 条消息</div>'
        + '<button class="conv-del" data-cid="'+c.id+'">✕</button>';
      item.onclick = (e) => { if (e.target.closest('.conv-del')) return; switchConv(c.id); };
      const del = item.querySelector('.conv-del');
      if (del) del.onclick = (e) => { e.stopPropagation(); deleteConv(c.id); };
      list.appendChild(item);
    });
  } catch(e) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text3)">加载失败</div>'; }
}

async function createConv() {
  try {
    const r = await fetch('/api/conversation/create', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid,module:S.curTab})});
    const d = await r.json();
    if (d.success) {
      // Clear current messages
      const c = document.getElementById('msgs-'+S.curTab);
      if (c) c.innerHTML = '<div class="welc"><h3>新对话</h3><p>开始新的对话</p></div>';
      loadConvList();
    }
  } catch(e) {}
}

async function switchConv(id) {
  try {
    await fetch('/api/conversation/switch', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid,module:S.curTab,conversationId:id})});
    loadConvList();
    // Could reload messages from history - for now just clear
    const c = document.getElementById('msgs-'+S.curTab);
    if (c) c.innerHTML = '<div class="welc"><h3>已切换</h3></div>';
  } catch(e) {}
}

async function deleteConv(id) {
  if (!confirm('确定删除此对话？')) return;
  try {
    const r = await fetch('/api/conversation/delete', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid,module:S.curTab,conversationId:id})});
    const d = await r.json();
    if (d.success) {
      const c = document.getElementById('msgs-'+S.curTab);
      if (c) c.innerHTML = '<div class="welc"><h3>已删除</h3></div>';
      loadConvList();
    }
  } catch(e) {}
}

// ===== Simulation =====
async function startSim() {
  if (simRunning) return; simRunning = true;
  const btn = document.getElementById('btn-start-sim'); btn.textContent = '推演中...'; btn.disabled = true;
  const c = document.getElementById('msgs-simulation'); const w = c?.querySelector('.welc'); if (w) w.remove();
  try {
    const r = await fetch('/api/simulation/start', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid, selectedRoles})});
    const d = await r.json();
    if (d.error) { addMsg('simulation','ai','[错误] '+d.error); simRunning=false; return; }
    if (d.narration) addMsg('simulation','ai','【旁白】'+d.narration);
    for (const c of (d.characters||[])) {
      if (!c||!c.name||!c.content) continue;
      await delay(600); addMsg('simulation','ai',c.content,c.name);
    }
    await delay(400);
    if (d.options && d.options.length > 0 && d.options[0]) {
      showDecision(d.decisionPrompt||'', d.options||[]);
    } else {
      // Simulation complete - generate report
      addMsg('simulation', 'ai', '【推演结束】所有决策节点已完成，正在生成总结报告...');
      await delay(1000);
      generateReport();
    }
  } catch(e) { addMsg('simulation','ai','[错误] '+e.message); }
  simRunning=false; btn.textContent='▶ 继续推演'; btn.disabled=false;
}

async function continueSim(choice) {
  simRunning = true;
  try {
    addMsg('simulation','user','【决策】'+choice);
    const r = await fetch('/api/simulation/round', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid,choice,selectedRoles})});
    const d = await r.json();
    if (d.error) { addMsg('simulation','ai','[错误] '+d.error); return; }
    if (d.narration) addMsg('simulation','ai','【旁白】'+d.narration);
    for (const c of (d.characters||[])) {
      if (!c||!c.name||!c.content) continue;
      await delay(600); addMsg('simulation','ai',c.content,c.name);
    }
    await delay(400);
    if (d.options && d.options.length > 0 && d.options[0]) {
      showDecision(d.decisionPrompt||'', d.options||[]);
    } else {
      // First round but no decisions - still show report option
      addMsg('simulation', 'ai', '【提示】推演已完成初始场景。如需继续，请点击继续推演。');
    }
  } catch(e) { addMsg('simulation','ai','[错误] '+e.message); }
  simRunning=false;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== Decision Modal =====
function showDecision(q, opts) {
  let o = document.getElementById('dec-overlay');
  if (!o) { document.body.appendChild(document.getElementById('decision-modal').content.cloneNode(true)); o = document.getElementById('dec-overlay'); }
  document.getElementById('dec-question').textContent = q||'请选择您的行动方案：';
  const oc = document.getElementById('dec-options'); oc.innerHTML = '';
  (opts||[]).forEach((opt,i) => {
    const b = document.createElement('button'); b.className = 'dopt';
    b.textContent = (i+1)+'. '+opt;
    b.onclick = () => { closeDec(); continueSim(opt); }; oc.appendChild(b);
  });
  document.getElementById('dec-input').value = '';
  document.getElementById('dec-submit').onclick = () => {
    const v = document.getElementById('dec-input').value.trim();
    if (v) { closeDec(); continueSim(v); } else alert('请输入您的决策');
  };
  document.getElementById('dec-close').onclick = closeDec;
}
function closeDec() { const o = document.getElementById('dec-overlay'); if (o) o.remove(); }


// ===== Summary Report =====
async function generateReport() {
  try {
    const r = await fetch('/api/simulation/report', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid})});
    const d = await r.json();
    if (d.success && d.report) {
      showReport(d.report);
    } else {
      addMsg('simulation', 'ai', '[报告生成失败] ' + (d.error||''));
    }
  } catch(e) {
    addMsg('simulation', 'ai', '[报告生成错误] ' + e.message);
  }
}

function showReport(report) {
  const c = document.getElementById('msgs-simulation');
  if (!c) return;
  
  // Remove the sim-start button if present
  const sa = document.getElementById('sim-start-area');
  if (sa) sa.style.display = 'none';
  
  const card = document.createElement('div');
  card.className = 'report-card';
  
  let html = '<div class="report-head">📋 案例推演总结报告</div>';
  
  if (report.caseReview) {
    html += '<div class="report-section"><div class="report-label">📖 案例核心回顾</div><div class="report-text">'+report.caseReview+'</div></div>';
  }
  
  if (report.keyChoices && report.keyChoices.length) {
    html += '<div class="report-section"><div class="report-label">🎯 关键选择</div>';
    report.keyChoices.forEach((kc, i) => {
      html += '<div class="report-choice"><span class="rc-node">节点'+(i+1)+': '+(kc.node||'')+'</span><span class="rc-choice">→ 选择: '+(kc.choice||'')+'</span></div>';
    });
    html += '</div>';
  }
  
  if (report.stakeholderPositions && report.stakeholderPositions.length) {
    html += '<div class="report-section"><div class="report-label">👥 各方立场</div>';
    report.stakeholderPositions.forEach(sp => {
      html += '<div class="report-stakeholder"><span class="rs-name">'+(sp.name||'')+'</span><span class="rs-pos">'+(sp.position||'')+'</span></div>';
    });
    html += '</div>';
  }
  
  if (report.decisionAnalysis) {
    html += '<div class="report-section"><div class="report-label">🔍 决策分析</div><div class="report-text">'+report.decisionAnalysis+'</div></div>';
  }
  
  if (report.outcome) {
    html += '<div class="report-section"><div class="report-label">🏁 推演结果</div><div class="report-text outcome">'+report.outcome+'</div></div>';
  }
  
  if (report.insights && report.insights.length) {
    html += '<div class="report-section"><div class="report-label">💡 教学启示</div><ul class="report-insights">'+report.insights.map(i => '<li>'+i+'</li>').join('')+'</ul></div>';
  }
  
  card.innerHTML = html;
  c.appendChild(card);
  c.scrollTop = c.scrollHeight;
  
  // Add "重新推演" button
  const restartBtn = document.createElement('button');
  restartBtn.className = 'btn btn-primary btn-lg';
  restartBtn.style.cssText = 'margin:20px auto;display:block';
  restartBtn.textContent = '🔄 重新推演';
  restartBtn.onclick = () => {
    // Reset simulation
    fetch('/api/decision/reset', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sid:S.sid})});
    document.getElementById('btn-start-sim').textContent = '▶ 开始推演';
    document.getElementById('btn-start-sim').disabled = false;
    // Show start button
    const sa = document.getElementById('sim-start-area');
    if (sa) sa.style.display = 'flex';
    // Remove report card
    card.remove();
  };
  c.appendChild(restartBtn);
}

// Init
document.addEventListener('DOMContentLoaded', () => go('home'));
// ===== Load Quick Questions =====
async function loadQuickQuestions() {
  const tabs = ['advisor','stakeholder','simulation'];
  for (const mod of tabs) {
    try {
      const r = await fetch('/api/quick-questions/'+S.sid+'/'+mod);
      const d = await r.json();
      if (d.questions && d.questions.length) {
        quickQuestions[mod] = d.questions;
        renderQuickQs(mod);
      }
    } catch(e) {}
  }
}

function renderQuickQs(mod) {
  const msgs = document.getElementById('msgs-'+mod);
  if (!msgs) return;
  const qs = quickQuestions[mod] || [];
  if (qs.length === 0) return;
  const welc = msgs.querySelector('.welc');
  if (!welc) return;
  // Add quick question cards below welcome
  let qArea = welc.querySelector('.quick-qs');
  if (!qArea) {
    qArea = document.createElement('div');
    qArea.className = 'quick-qs';
    welc.appendChild(qArea);
  }
  qArea.innerHTML = '<div class="qq-scroll">' +
    qs.map(q => '<button class="qq-btn" data-q="'+q.replace(/"/g,'&quot;')+'">'+q+'</button>').join('') +
    '</div>';
  // Attach click handlers
  qArea.querySelectorAll('.qq-btn').forEach(btn => {
    btn.onclick = () => {
      const inp = document.getElementById('inp-'+mod);
      if (inp) {
        inp.value = btn.textContent;
        // Trigger send
        sendModule(mod);
      }
    };
  });
}

function sendModule(mod) {
  const inp = document.getElementById('inp-'+mod);
  if (!inp || !inp.value.trim()) return;
  addMsg(mod, 'user', inp.value.trim());
  const msg = inp.value.trim();
  inp.value = '';
  inp.style.height = 'auto';
  chat(mod, msg);
}

// ===== Role Panel =====
async function loadRolePanel() {
  try {
    const r = await fetch('/api/role-groups/'+S.sid);
    const d = await r.json();
    if (d.roles && d.roles.length) {
      renderRolePanel(d.roles);
    }
  } catch(e) {}
}

function renderRolePanel(roles) {
  // Add role panel to all tabs that need it
  const tabs = ['simulation'];
  for (const mod of tabs) {
    const msgs = document.getElementById('msgs-'+mod);
    if (!msgs) continue;
    const welc = msgs.querySelector('.welc');
    if (!welc) continue;
    let rp = welc.querySelector('.role-panel');
    if (!rp) {
      rp = document.createElement('div');
      rp.className = 'role-panel';
      welc.insertBefore(rp, welc.firstChild);
    }
    rp.innerHTML = '<div class="rp-title">👥 选择参与角色</div>' +
      '<div class="rp-grid">' +
      roles.map((r,i) => '<label class="rp-item'+(i===0?' active':'')+'"><input type="checkbox" class="rp-cb"'+(i===0?' checked':'')+' value="'+r.name+'" data-title="'+(r.title||'')+'"><span class="rp-name">'+r.name+'</span><span class="rp-title-text">'+(r.title||'')+'</span></label>').join('') +
      '</div>' +
      '<button class="btn btn-primary btn-sm" id="btn-confirm-roles">确认角色</button>';
    
    // Handle checkbox changes
    rp.querySelectorAll('.rp-cb').forEach(cb => {
      cb.onchange = () => {
        cb.closest('.rp-item').classList.toggle('active', cb.checked);
        updateStartBtn();
      };
    });
    
    // Handle confirm button
    rp.querySelector('#btn-confirm-roles').onclick = () => {
      const checked = rp.querySelectorAll('.rp-cb:checked');
      selectedRoles = Array.from(checked).map(c => ({ name: c.value, title: c.dataset.title }));
      updateStartBtn();
      // Show confirm message
      const feed = document.createElement('div');
      feed.style.cssText = 'font-size:12px;color:var(--accent);padding:4px 0;text-align:center';
      feed.textContent = '✅ 已选定 ' + selectedRoles.length + ' 位角色参与推演';
      rp.appendChild(feed);
      setTimeout(() => feed.remove(), 2000);
    };

    // Initialize button state
    updateStartBtn();
  }
}

function updateStartBtn() {
  const btn = document.getElementById('btn-start-sim');
  if (!btn) return;
  const checked = document.querySelectorAll('.rp-cb:checked');
  if (checked.length === 0) {
    btn.disabled = true;
    btn.style.opacity = '0.4';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}
