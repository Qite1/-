'use strict';
/* 水利工程质量安全合规管理助手 - 前端逻辑 */
const API = {
  async req(method, url, data, isForm) {
    const headers = {};
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    let body;
    if (data instanceof FormData) {
      body = data; // 不使用Content-Type以自动边界
    } else if (data !== undefined) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(data);
    }
    const res = await fetch(url, { method, headers, body });
    if (!res.ok) {
      let msg = '请求失败(' + res.status + ')';
      try {
        const j = await res.json();
        if (j && j.msg) msg = j.msg;
      } catch (e) {}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('json')) return res.json();
    return res;
  },
  login(u, p) { return this.req('POST', '/api/login', { username: u, password: p }); },
  me() { return this.req('GET', '/api/me'); },
  getUsers() { return this.req('GET', '/api/admin/users'); },
  createUser(o) { return this.req('POST', '/api/admin/users', o); },
  setUser(id, o) { return this.req('PUT', '/api/admin/users/' + id, o); },
  delUser(id) { return this.req('DELETE', '/api/admin/users/' + id); },
  upload(payload) { return this.req('POST', '/api/worker/upload', payload); },
  getInspections() { return this.req('GET', '/api/inspections'); },
  confirmInspection(id, note) { return this.req('POST', '/api/inspections/' + id + '/confirm', { comment: note }); },
  rejectInspection(id, note) { return this.req('POST', '/api/inspections/' + id + '/reject', { comment: note }); },
  getLedgers() { return this.req('GET', '/api/ledgers'); },
  setLedgerStatus(id, status, note) { return this.req('POST', '/api/ledgers/' + id + '/status', { status, note }); },
  delLedger(id) { return this.req('DELETE', '/api/ledgers/' + id + '/delete'); },
  regCategories() { return this.req('GET', '/api/regulations/categories'); },
  regQuery(q, cat) { return this.req('GET', '/api/regulations?q=' + encodeURIComponent(q || '') + '&category=' + encodeURIComponent(cat || '')); },
  overviewExcelUrl() { return '/api/overview/excel'; },
  companyProfile() { return this.req('GET', '/api/company/profile'); },
  aiStatus() { return this.req('GET', '/api/ai/status'); },
  aiConfig() { return this.req('GET', '/api/ai/config'); },
  saveAiConfig(d) { return this.req('POST', '/api/ai/config', d); },
  clearAiConfig() { return this.req('DELETE', '/api/ai/config'); },
  excelUrl(id) { return '/api/inspections/' + id + '/excel'; },
};

const ROLE_NAME = { admin: '管理员', reviewer: '审核员', worker: '施工员' };

let state = { user: null, view: 'dashboard' };

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function riskBadge(r) { return '<span class="badge risk-' + esc(r) + '">' + esc(r) + '</span>'; }
function roleBadge(r) { return '<span class="badge role-' + esc(r) + '">' + esc(ROLE_NAME[r] || r) + '</span>'; }
function statusBadge(s) {
  const key = {
    '已递交待审核': 'submitted',
    '已提交待审核': 'submitted',
    '已确认并生成台账': 'confirmed',
    '已打回': 'rejected',
    '待落实整改': 'confirmed',
    '整改中': 'rectifying',
    '已完成整改': 'rectified',
    '已闭环销号': 'closed',
  }[s] || 'confirmed';
  return '<span class="badge st-' + key + '">' + esc(s) + '</span>';
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:74px;right:20px;z-index:99;padding:11px 18px;border-radius:8px;color:#fff;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.2);background:' + (type === 'err' ? '#c0392b' : '#0e5a9e') + ';';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function openModal(title, bodyHtml, footHtml) {
  const root = $('#modalRoot');
  root.innerHTML =
    '<div class="modal-mask"><div class="modal"><div class="modal-head"><span>' + esc(title) + '</span><button class="x" onclick="closeModal()">×</button></div>' +
    '<div class="modal-body">' + bodyHtml + '</div>' +
    (footHtml ? '<div class="modal-foot">' + footHtml + '</div>' : '') +
    '</div></div>';
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

/* ================= 登录 ================= */
function showLogin() {
  $('#loginPage').classList.remove('hidden');
  $('#appPage').classList.add('hidden');
}
function showApp() {
  $('#loginPage').classList.add('hidden');
  $('#appPage').classList.remove('hidden');
}

async function doLogin(e) {
  e.preventDefault();
  $('#loginError').textContent = '';
  const u = $('#loginUser').value.trim();
  const p = $('#loginPass').value;
  if (!u || !p) { $('#loginError').textContent = '请输入账号和密码'; return; }
  try {
    const r = await API.login(u, p);
    localStorage.setItem('token', r.token);
    state.user = r.user;
    afterLogin();
  } catch (err) {
    $('#loginError').textContent = err.message;
  }
}

function afterLogin() {
  showApp();
  renderChrome();
  switchView('dashboard');
}

function renderChrome() {
  const u = state.user;
  $('#topUserName').textContent = u.name + '（' + u.project + '）';
  $('#topRoleBadge').textContent = ROLE_NAME[u.role];
  $('#footProject').textContent = u.project;
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', u.role !== 'admin'));
  $('#navUploadText').textContent = u.role === 'admin' || u.role === 'reviewer' ? '巡检查看' : '现场巡检上报';
  $$('.nav-item').forEach((it) => {
    const v = it.dataset.view;
    // 上传视图：仅施工员可用完整上报；管理员/审核员也展示但指向检查
  });
  // 侧边栏可见性
  const canUpload = ['admin', 'worker'].includes(u.role);
  const up = $('.nav-item[data-view="upload"]');
  if (up) up.classList.toggle('hidden', !canUpload);
}

function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  $$('.view').forEach((s) => s.classList.add('hidden'));
  const target = $('#view-' + view);
  if (target) target.classList.remove('hidden');
  const loader = { dashboard: renderDashboard, upload: renderUpload, inspections: renderInspections, ledgers: renderLedgers, regulations: renderRegulations, settings: renderSettings, users: renderUsers };
  if (loader[view]) loader[view]();
}

/* ================= 公司简介 ================= */
function companyPanel(c, ai) {
  if (!c || !c.name) return '';
  const quals = (c.qualifications || []);
  const projs = (c.projects || []);
  const tm = c.team || {};
  const ach = (c.achievements || []);
  const ct = c.contact || {};
  return `
    <div class="panel" style="background:linear-gradient(135deg,#0a3d74,#0e5a9e);color:#fff;border:none">
      <div class="panel-body" style="padding:26px 28px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <img src="assets/logo.svg" width="52" height="52" alt="logo">
          <div>
            <div style="font-size:22px;font-weight:800;letter-spacing:1px">${esc(c.name)}</div>
            <div style="opacity:.85;margin-top:2px">${esc(c.slogan || '')}</div>
          </div>
        </div>
        <div style="margin-top:14px;line-height:1.85;opacity:.95;font-size:14px">${esc(c.intro || '')}</div>
        <div class="small" style="margin-top:12px;opacity:.8">📍 ${esc(ct.address || '')}　·　☎ ${esc(ct.tel || '')}　·　✉ ${esc(ct.email || '')}</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">🏅 企业资质</div>
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
        ${quals.length ? quals.map((q) => `<div class="stat" style="border-left-color:var(--ok)"><div class="lbl" style="font-size:13px;font-weight:600;color:var(--ink)">${esc(q.name)}</div><div class="small" style="margin-top:4px">${esc(q.note || '')}</div><div class="small" style="color:var(--navy-2);margin-top:2px">等级：${esc(q.level || '')}</div></div>`).join('') : '<div class="small">暂无资质数据</div>'}
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">🏗 代表性项目</div>
      <div class="panel-body" style="padding:16px 20px">
        <table class="tbl"><thead><tr><th>项目名称</th><th>类型</th><th>范围</th><th>工期</th><th>状态</th></tr></thead><tbody>
          ${projs.map((p) => `<tr><td>${esc(p.name || '')}</td><td>${esc(p.type || '')}</td><td>${esc(p.unit || '')}</td><td>${esc(p.year || '')}</td><td>${esc(p.result || '')}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    ${c.background ? `
    <div class="panel" style="border-left:5px solid #1680c8">
      <div class="panel-head">🏢 企业背景 · ${esc(c.background.parent || '母公司')}</div>
      <div class="panel-body" style="padding:16px 20px;line-height:1.85;color:#33414f;font-size:13px">
        ${esc(c.background.parentDesc || '')}
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
          ${(c.background.qualifications || []).map((q) => `<span class="filter-chip">${esc(q.name)}</span>`).join('')}
        </div>
      </div>
    </div>
    ` : ''}

    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-head">👥 团队实力</div>
        <div class="panel-body">
          <div class="grid grid-2" style="margin-bottom:12px">
            <div class="stat"><div class="num">${esc(tm.members || 0)}</div><div class="lbl">员工总数</div></div>
            <div class="stat"><div class="num">${esc(tm.engineers || 0)}</div><div class="lbl">工程技术员</div></div>
            <div class="stat"><div class="num">${esc(tm.registered || 0)}</div><div class="lbl">注册执业人员</div></div>
            <div class="stat green"><div class="num">✓</div><div class="lbl">安全团队：${esc(tm.safetyTeam || '—')}</div></div>
          </div>
          <div class="small" style="line-height:1.8;color:#33414f">${esc(tm.desc || '')}</div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">🏆 荣誉成就</div>
        <div class="panel-body">
          <ul style="margin:0;padding-left:18px;line-height:1.9">${ach.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        </div>
      </div>
    </div>

    <div class="panel" style="border-left:5px solid ${ai && ai.aiEnabled ? 'var(--ok)' : 'var(--warn)'}">
      <div class="panel-body" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px 20px">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="risk-pill ${ai && ai.aiEnabled ? '重大' : '较大'}"></span>
          <b>照片 AI 识别引擎：</b>
          <span>${ai && ai.aiEnabled ? '✅ 已启用（真实视觉模型 · ' + esc(ai.model || 'AI') + '）' : '⚠ 未启用（需配置视觉模型接口）'}</span>
        </div>
        ${ai && !ai.aiEnabled ? `<button class="btn btn-outline btn-sm" onclick="alert('${esc('请为服务端配置环境变量 VISION_API_URL 与 VISION_API_KEY 后重启服务。')}')">查看配置说明</button>` : ''}
      </div>
    </div>`;
}

/* ================= 工作台 ================= */
async function renderDashboard() {
  const el = $('#view-dashboard');
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const calls = [API.getInspections(), API.getLedgers(), API.companyProfile(), API.aiStatus()];
    if (state.user.role === 'reviewer' || state.user.role === 'admin') {
      calls.push(API.req('GET', '/api/review/todo'));
    }
    const results = await Promise.all(calls);
    const insp = results[0].inspections;
    const led = results[1].ledgers;
    const company = results[2].company || {};
    const ai = results[3] || {};
    const todo = results[4] || null;
    const reviewTodo = todo ? todo.count : 0;
    const my = insp.filter((i) => state.user.role === 'worker' ? i.uploaderId === state.user.id : true);
    const now = new Date();
    const todoLedgers = led.filter((l) => (state.user.role === 'worker' ? l.workerId === state.user.id : true) && ['pending', 'rectifying'].includes(l.status));

    let major = 0, larger = 0, normal = 0;
    my.forEach((i) => (i.findings || []).forEach((f) => { if (f.risk === '重大') major++; else if (f.risk === '较大') larger++; else if (f.risk === '一般') normal++; }));
    const totalFind = major + larger + normal;

    const greeting = now.getHours() < 12 ? '上午好' : now.getHours() < 18 ? '下午好' : '晚上好';
    el.innerHTML = `
      <div class="panel"><div class="panel-body" style="padding:26px 24px">
        <h2 style="margin:0 0 6px;color:var(--navy-1)">${greeting}，${esc(state.user.name)}</h2>
        <div class="small">当前身份：${roleBadge(state.user.role)} &nbsp;·&nbsp; 所属工程：${esc(state.user.project)}</div>
        <div class="flow-line" style="margin-top:16px"></div>
      </div></div>

      ${companyPanel(company, ai)}

      <div class="grid grid-4" style="margin-bottom:20px">
        <div class="stat"><div class="num">${totalFind}</div><div class="lbl">累计识别隐患条目</div></div>
        <div class="stat red"><div class="num">${major}</div><div class="lbl">重大隐患</div></div>
        <div class="stat orange"><div class="num">${larger}</div><div class="lbl">较大隐患</div></div>
        ${(state.user.role === 'reviewer' || state.user.role === 'admin')
          ? `<div class="stat"><div class="num">${reviewTodo}</div><div class="lbl">待审核单</div></div>`
          : `<div class="stat green"><div class="num">${todoLedgers.length}</div><div class="lbl">待整改台账</div></div>`}
      </div>

      <div class="panel">
        <div class="panel-head">
          <span>📑 问题与整改概览（可预览 · 可导出）</span>
          <div style="display:flex;gap:10px">
            <button class="btn btn-outline btn-sm" onclick="previewOverview()">👁 预览明细</button>
            <a class="btn btn-primary btn-sm" href="${API.overviewExcelUrl()}" target="_blank" rel="noopener">⬇ 导出概览Excel</a>
          </div>
        </div>
        <div class="panel-body" style="padding:16px 20px">
          <table class="tbl"><thead><tr>
            <th>来源单</th><th>问题类型</th><th>风险</th><th>问题描述</th><th>整改意见</th><th>待核查</th><th>关联台账</th>
          </tr></thead>
          <tbody id="overviewRows"></tbody></table>
          <div class="small" style="margin-top:8px;color:var(--steel)">共 <b id="overviewCount">0</b> 条问题记录；点击「预览明细」查看完整内容，或导出为 Excel（含整改台账汇总 + 问题与整改明细两张表）。</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="panel"><div class="panel-head">📷 最近巡检记录</div><div class="panel-body" id="dashRecent"></div></div>
        <div class="panel"><div class="panel-head">🧾 整改台账进度</div><div class="panel-body" id="dashLedgers"></div></div>
      </div>`;

    // 概览：合并台账与近期审核单的问题明细
    const overviewItems = [];
    (led || []).forEach((l) => {
      (l.findings || []).forEach((f) => overviewItems.push({ ...f, fromCode: l.inspectionCode, ledgerCode: l.code, ledgerStatus: l.statusText }));
    });
    if (!overviewItems.length) {
      (my || []).forEach((i) => {
        (i.findings || []).forEach((f) => overviewItems.push({ ...f, fromCode: i.code, ledgerCode: '-', ledgerStatus: i.statusText }));
      });
    }
    $('#overviewCount').textContent = overviewItems.length;
    const oRows = overviewItems.slice(0, 12);
    $('#overviewRows').innerHTML = oRows.length
      ? oRows.map((f) => `<tr>
          <td class="mono small">${esc(f.fromCode || '')}</td>
          <td><span class="badge ${f.type === '质量' ? 'role-worker' : 'role-admin'}">${esc(f.type || '安全')}</span></td>
          <td>${riskBadge(f.risk)}</td>
          <td class="wrap">${esc(f.description)}${f.uncertain ? '<div class="small" style="color:var(--warn)">⚠ 建议现场核查</div>' : ''}</td>
          <td class="wrap">${esc(f.rectification)}</td>
          <td>${f.uncertain ? '是' : '否'}</td>
          <td class="mono small">${esc(f.ledgerCode || '—')}</td>
        </tr>`).join('')
      : '<tr><td colspan="7"><div class="empty">暂无问题记录</div></td></tr>';

    const recent = my.slice(0, 5);
    $('#dashRecent').innerHTML = recent.length
      ? '<table class="tbl"><thead><tr><th>单号</th><th>照片</th><th>风险</th><th>状态</th><th>时间</th></tr></thead><tbody>' +
          recent.map((i) => '<tr><td class="mono">' + esc(i.code) + '</td><td>' + (i.photoCount || 0) + '张</td><td>' + riskBadge(i.topRisk) + '</td><td>' + statusBadge(i.statusText) + '</td><td class="small">' + fmtDate(i.submittedAt).slice(0, 16) + '</td></tr>').join('') +
        '</tbody></table>'
      : '<div class="empty"><div class="e-ico">📷</div>暂无巡检记录</div>';

    const ld = todoLedgers.slice(0, 5);
    $('#dashLedgers').innerHTML = ld.length
      ? ld.map((l) => {
          const pct = l.status === 'pending' ? 15 : l.status === 'rectifying' ? 55 : 100;
          return '<div style="margin-bottom:14px"><div class="small" style="display:flex;justify-content:space-between"><span class="mono">' + esc(l.code) + '</span><span>' + esc(l.statusText) + '</span></div>' +
            '<div class="progress"><div style="width:' + pct + '%"></div></div></div>';
        }).join('')
      : '<div class="empty"><div class="e-ico">🗂</div>暂无待整改台账</div>';
  } catch (e) {
    el.innerHTML = '<div class="empty" style="color:var(--danger)">加载失败：' + esc(e.message) + '</div>';
  }
}

async function previewOverview() {
  try {
    const [insRes, ledRes] = await Promise.all([API.getInspections(), API.getLedgers()]);
    const ledgers = ledRes.ledgers || [];
    const inspections = insRes.inspections || [];
    const overview = [];
    [...ledgers].forEach((l) => {
      (l.findings || []).forEach((f) => overview.push({ ...f, fromCode: l.inspectionCode, ledgerCode: l.code, ledgerStatus: l.statusText }));
    });
    if (!overview.length) {
      [...inspections].forEach((i) => {
        (i.findings || []).forEach((f) => overview.push({ ...f, fromCode: i.code, ledgerCode: '-', ledgerStatus: i.statusText }));
      });
    }
    const safetyCount = overview.filter((f) => f.type !== '质量').length;
    const qualityCount = overview.length - safetyCount;
    const needCheck = overview.filter((f) => f.uncertain).length;
    openModal('问题与整改概览',
      `<div class="small" style="margin-bottom:10px">共 ${overview.length} 条记录　·　安全类 ${safetyCount} 条　·　质量类 ${qualityCount} 条　·　建议现场核查 ${needCheck} 条</div>` +
      (overview.length ? overview.map((f, i) => `<div class="finding-card">
        <div class="fc-head"><span class="mono">#${i + 1}</span>
          ${riskBadge(f.risk)}
          <span class="badge ${f.type === '质量' ? 'role-worker' : 'role-admin'}">${esc(f.type || '安全')}</span>
          <span style="color:var(--steel)">${esc(f.category)}</span>
          <span class="small" style="margin-left:auto;color:#999"><span class="mono">${esc(f.fromCode || '')}</span></span>
        </div>
        <div class="fc-body">
          <div class="row"><b>问题描述</b><span>${esc(f.description)}</span></div>
          <div class="row"><b>规范依据</b><span>${esc(f.regulation)}</span></div>
          <div class="row"><b>整改意见</b><span style="color:var(--navy-2)">${esc(f.rectification)}</span></div>
          ${f.uncertain ? `<div class="row"><b>核查提示</b><span style="color:var(--warn)">⚠ ${esc(f.confirmNote || '建议现场核查该部位')}</span></div>` : ''}
          <div class="row"><b>整改台账</b><span class="mono small">${esc(f.ledgerCode || '—')}（${esc(f.ledgerStatus || '')}）</span></div>
        </div></div>`).join('')
      : '<div class="empty">暂无问题记录</div>'),
      `<button class="btn btn-ghost" style="color:var(--steel);border-color:var(--line)" onclick="closeModal()">关闭</button>
       <a class="btn btn-primary" href="${API.overviewExcelUrl()}" target="_blank" rel="noopener">⬇ 导出Excel</a>`);
  } catch (e) {
    toast(e.message, 'err');
  }
}
window.previewOverview = previewOverview;

/* ================= 上传巡检 ================= */
let pendingPhotos = [];
let pendingHints = '';
let uploading = false;

function renderUpload() {
  const el = $('#view-upload');
  if (state.user.role !== 'admin' && state.user.role !== 'worker') {
    el.innerHTML = '<div class="panel"><div class="panel-body"><div class="empty">上传巡检仅对 <b>施工员</b> 开放。</div></div></div>';
    return;
  }
  el.innerHTML = `
    <div class="panel"><div class="panel-head">📷 现场照片 AI 安全巡检</div><div class="panel-body">
      <div class="dropzone" id="dropzone">
        <div style="font-size:40px">📸</div>
        <div style="font-size:15px;font-weight:600;margin:8px 0">点击选择或拖拽施工现场照片到此处</div>
        <div class="small">支持 JPG / PNG / WEBP，可多选</div>
      </div>
      <input type="file" id="fileInput" accept="image/*" multiple hidden>
      <div class="photo-grid" id="photoGrid"></div>
      <div style="margin-top:16px">
        <label style="font-weight:600;color:var(--navy-1);font-size:13px">现场补充描述（可选，帮助 AI 更精准判定）</label>
        <textarea id="hintsInput" class="field-input" style="margin-top:6px" placeholder="例如：基坑临边未设置防护栏杆，边坡有开裂，施工人员未佩戴安全帽…"></textarea>
      </div>
      <div style="display:flex;gap:12px;margin-top:14px;align-items:center">
        <button class="btn btn-primary" id="uploadBtn">🚀 上传并 AI 审核</button>
        <span class="small">上传后系统将依据《水利水电工程施工安全管理导则 SL 721-2015》等规范自动识别隐患并生成整改意见</span>
      </div>
      <div id="uploadResult" style="margin-top:18px"></div>
    </div></div>`;

  const dz = $('#dropzone'), fi = $('#fileInput');
  dz.onclick = () => fi.click();
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
  dz.ondragleave = () => dz.classList.remove('drag');
  dz.ondrop = (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); };
  fi.onchange = () => addFiles(fi.files);

  $('#uploadBtn').onclick = doUpload;
  $('#hintsInput').value = pendingHints;
  renderPhotoGrid();
}

function addFiles(fileList) {
  Array.from(fileList).forEach((f) => {
    if (!f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      pendingPhotos.push({ name: f.name, mime: f.type, data: e.target.result.split(',')[1] });
      renderPhotoGrid();
    };
    reader.readAsDataURL(f);
  });
}

function renderPhotoGrid() {
  const g = $('#photoGrid');
  if (!g) return;
  g.innerHTML = pendingPhotos.map((p, i) =>
    '<div class="photo-thumb"><img src="data:' + p.mime + ';base64,' + p.data + '"><div class="cap">' + esc(p.name) + '</div><button class="del" onclick="removePhoto(' + i + ')">×</button></div>'
  ).join('');
}
window.removePhoto = (i) => { pendingPhotos.splice(i, 1); renderPhotoGrid(); };

async function doUpload() {
  if (uploading) return;
  const dataFiles = pendingPhotos.filter((p) => p.data);
  if (!dataFiles.length) { toast('请先选择照片', 'err'); return; }
  if (dataFiles.length > 20) { toast('单次最多上传 20 张', 'err'); return; }
  uploading = true;
  const btn = $('#uploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> AI 审核中…';
  $('#uploadResult').innerHTML = '<div class="empty">正在上传照片并对照规范智能审核…</div>';
  try {
    const r = await API.upload({ files: dataFiles, hints: $('#hintsInput').value.trim(), project: state.user.project });
    pendingPhotos = [];
    pendingHints = $('#hintsInput').value.trim();
    renderPhotoGrid();
    $('#uploadResult').innerHTML = buildUploadResult(r.inspection);
    toast(r.msg || '审核完成');
  } catch (err) {
    $('#uploadResult').innerHTML = '<div class="empty" style="color:var(--danger)">' + esc(err.message) + '</div>';
  } finally {
    uploading = false;
    btn.disabled = false;
    btn.textContent = '🚀 上传并 AI 审核';
  }
}

function buildUploadResult(ins) {
  return `
    <div style="border-top:1px solid var(--line);padding-top:16px">
      <div class="toolbar">
        <span style="font-weight:700;color:var(--navy-1)">AI 审核结果 — ${esc(ins.code)}</span>
        ${riskBadge(ins.topRisk)}
        <a class="btn btn-outline btn-sm" href="${API.excelUrl(ins.id)}">⬇ 下载审核清单(Excel)</a>
      </div>
      <div class="small" style="margin-bottom:12px">${esc(ins.msg || '')} · 生成时间：${fmtDate(ins.createdAt)} · 状态：${statusBadge(ins.statusText)}</div>
      <div class="flow-line" style="margin-bottom:16px"></div>
      ${(ins.findings || []).map((f, idx) => findingCard(idx + 1, f)).join('')}
    </div>`;
}

function findingCard(idx, f) {
  return `<div class="finding-card">
    <div class="fc-head"><span class="mono">#${idx}</span> ${riskBadge(f.risk)}
      <span class="badge ${f.type === '质量' ? 'role-worker' : 'role-admin'}">${esc(f.type || '安全')}</span>
      <span style="color:var(--steel)">${esc(f.category)}</span>
      ${f.source ? `<span class="small" style="color:#999">[${esc(f.source)}]</span>` : ''}
      <span class="small" style="margin-left:auto;color:#999">${esc(f.photo)}</span></div>
    <div class="fc-body">
      <div class="row"><b>问题描述</b><span>${esc(f.description)}</span></div>
      <div class="row"><b>规范依据</b><span>${esc(f.regulation)}</span></div>
      <div class="row"><b>整改意见</b><span style="color:var(--navy-2)">${esc(f.rectification)}</span></div>
      ${f.uncertain ? `<div class="row"><b>核查提示</b><span style="color:var(--warn)">⚠ ${esc(f.confirmNote || '建议施工员现场核查该部位')}</span></div>` : ''}
    </div></div>`;
}

/* ================= 审核单管理 ================= */
async function renderInspections() {
  const el = $('#view-inspections');
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await API.getInspections();
    const list = r.inspections;
    el.innerHTML = `
      <div class="panel">
        <div class="panel-head">▤ 审核单管理（共 ${list.length} 单）</div>
        <div class="panel-body" style="padding:16px 20px">
        ${list.length ? `<table class="tbl">
          <thead><tr><th>审核单号</th><th>项目</th><th>上报单位</th><th>照片</th><th>最高风险</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${list.map((i) => `
            <tr>
              <td class="mono">${esc(i.code)}</td>
              <td>${esc(i.project)}</td>
              <td>${esc(i.uploader)}（${esc(i.uploaderRoleName)}）</td>
              <td>${i.photos ? i.photos.length : 0} 张</td>
              <td>${riskBadge(i.topRisk)}</td>
              <td>${statusBadge(i.statusText)}</td>
              <td class="small">${fmtDate(i.submittedAt).slice(0, 16)}</td>
              <td>
                <button class="btn btn-outline btn-sm" onclick="viewInspection('${i.id}')">详情</button>
                ${state.user.role !== 'worker' ? `<a class="btn btn-outline btn-sm" href="${API.excelUrl(i.id)}">Excel</a>` : ''}
                ${(state.user.role === 'reviewer' || state.user.role === 'admin') && i.status === 'submitted' ? `
                  <button class="btn btn-primary btn-sm" onclick="reviewConfirm('${i.id}')">确认</button>
                  <button class="btn btn-danger btn-sm" onclick="reviewReject('${i.id}')">打回</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody></table>` : '<div class="empty"><div class="e-ico">▤</div>暂无审核单</div>'}
        </div>
      </div>`;
  } catch (e) {
    el.innerHTML = '<div class="empty" style="color:var(--danger)">' + esc(e.message) + '</div>';
  }
}

async function viewInspection(id) {
  try {
    const r = await API.req('GET', '/api/inspections/' + id);
    const i = r.inspection;
    const uploadedPhotos = (i.photos || []).map((p) => `<div class="photo-thumb" style="flex:0 0 auto;width:130px"><img src="${esc(p.path)}" style="height:90px"><div class="cap">${esc(p.fname)}</div></div>`).join('');
    openModal('审核单 ' + i.code,
      `<div class="form-row"><span class="small">项目：${esc(i.project)}　上报人：${esc(i.uploader)}　状态：${statusBadge(i.statusText)}</span></div>
       <div class="small" style="margin-bottom:10px">提交时间：${fmtDate(i.submittedAt)}　最高风险：${riskBadge(i.topRisk)}</div>
       ${i.photos && i.photos.length ? '<div style="display:flex;gap:8px;overflow-x:auto;margin-bottom:14px">' + uploadedPhotos + '</div>' : ''}
       <div class="panel" style="margin-bottom:0"><div class="panel-head" style="font-size:13px">隐患清单</div><div class="panel-body" style="padding:12px">${(i.findings || []).map((f, x) => findingCard(x + 1, f)).join('') || '<div class="empty">无隐患条目</div>'}</div></div>`,
      `<button class="btn btn-ghost" style="color:var(--steel);border-color:var(--line)" onclick="closeModal()">关闭</button>
       <a class="btn btn-outline" href="${API.excelUrl(id)}">下载 Excel</a>`);
    // 内嵌 photo-thumb 需要修复宽度样式：重建
  } catch (e) { toast(e.message, 'err'); }
}
window.viewInspection = viewInspection;

async function reviewConfirm(id) {
  const note = prompt('审核确认意见（可留空）：', '确认无误，同意生成整改台账，请限期整改并反馈闭环。');
  if (note === null) return;
  try {
    await API.confirmInspection(id, note);
    toast('已确认并生成整改台账');
    renderInspections();
    if (state.view === 'dashboard') renderDashboard();
  } catch (e) { toast(e.message, 'err'); }
}
window.reviewConfirm = reviewConfirm;

async function reviewReject(id) {
  const note = prompt('打回原因：', '影像资料不足或需现场复核，请补充后重新递交。');
  if (note === null) return;
  try {
    await API.rejectInspection(id, note);
    toast('已打回');
    renderInspections();
  } catch (e) { toast(e.message, 'err'); }
}
window.reviewReject = reviewReject;

/* ================= 整改台账 ================= */
async function renderLedgers() {
  const el = $('#view-ledgers');
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const r = await API.getLedgers();
    const list = r.ledgers;
    el.innerHTML = `
      <div class="panel"><div class="panel-head">☷ 问题与整改意见台账（共 ${list.length} 条）</div>
      <div class="panel-body" style="padding:16px 20px">
      ${list.length ? '<table class="tbl"><thead><tr><th>台账编号</th><th>来源单号</th><th>隐患条目</th><th>最高风险</th><th>责任施工员</th><th>确认审核员</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
        list.map((l) => `<tr>
          <td class="mono">${esc(l.code)}</td>
          <td class="mono small">${esc(l.inspectionCode)}</td>
          <td>${l.findings ? l.findings.length : 0} 项</td>
          <td>${riskBadge(l.topRisk)}</td>
          <td>${esc(l.workerName)}</td>
          <td>${esc(l.reviewerName)}</td>
          <td>${statusBadge(l.statusText)}</td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="viewLedger('${l.id}')">明细</button>
            ${state.user.role === 'worker' && l.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="ledgerMove('${l.id}','rectifying')">开始整改</button>` : ''}
            ${state.user.role === 'worker' && l.status === 'rectifying' ? `<button class="btn btn-primary btn-sm" onclick="ledgerMove('${l.id}','rectified')">完成整改</button>` : ''}
            ${(state.user.role === 'reviewer' || state.user.role === 'admin') && l.status === 'rectified' ? `<button class="btn btn-sm" style="background:var(--ok);color:#fff" onclick="ledgerMove('${l.id}','closed')">验收销号</button>` : ''}
            ${(state.user.role === 'reviewer' || state.user.role === 'admin') ? `<button class="btn btn-danger btn-sm" onclick="confirmDelLedger('${l.id}','${esc(l.code)}')">删除</button>` : ''}
          </td></tr>`).join('') + '</tbody></table>' : '<div class="empty"><div class="e-ico">🗂</div>暂无台账</div>'}
      </div></div>`;
  } catch (e) { el.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; }
}

async function viewLedger(id) {
  try {
    const r = await API.getLedgers();
    const l = r.ledgers.find((x) => x.id === id) || {};
    openModal('台账 ' + l.code,
      `<div class="small" style="margin-bottom:14px">来源审核单：<span class="mono">${esc(l.inspectionCode)}</span>　·　确认审核员：${esc(l.reviewerName)}　·　责任施工员：${esc(l.workerName)}　·　状态：${statusBadge(l.statusText)}</div>
       ${(l.findings || []).map((f, x) => findingCard(x + 1, f)).join('')}
       ${l.remark ? '<div class="small" style="margin-top:10px;color:var(--steel)">审核意见：' + esc(l.remark) + '</div>' : ''}`,
      `<button class="btn btn-ghost" style="color:var(--steel);border-color:var(--line)" onclick="closeModal()">关闭</button>`);
  } catch (e) { toast(e.message, 'err'); }
}
window.viewLedger = viewLedger;

async function ledgerMove(id, status) {
  const notes = {
    rectifying: '整改中',
    rectified: '请填写整改完成情况说明：',
    closed: '销号前请确认整改到位，确认销号？',
  };
  let note = '';
  if (status === 'rectified') {
    note = prompt(notes.rectified, '已按照整改意见完成整改，附图见附件。');
    if (note === null) return;
  } else if (status === 'closed') {
    if (!confirm(notes.closed)) return;
    note = '现场复核确认整改到位，予以销号。';
  } else {
    note = notes.rectifying;
  }
  try {
    await API.setLedgerStatus(id, status, note);
    toast('台账状态已更新');
    renderLedgers();
  } catch (e) { toast(e.message, 'err'); }
}
window.ledgerMove = ledgerMove;

async function confirmDelLedger(id, code) {
  if (!confirm('确认删除台账「' + code + '」？\n删除后该台账将从整改台账中移除，其来源审核单将退回“待审核”状态。此操作不可恢复。')) return;
  try {
    await API.delLedger(id);
    toast('台账条目已删除');
    renderLedgers();
    if (state.view === 'dashboard') renderDashboard();
  } catch (e) { toast(e.message, 'err'); }
}
window.confirmDelLedger = confirmDelLedger;

/* ================= 规范查询 ================= */
let regState = { q: '', category: '' };

async function renderRegulations() {
  const el = $('#view-regulations');
  el.innerHTML = '<div class="empty">加载中…</div>';
  try {
    const [catRes, listRes] = await Promise.all([API.regCategories(), API.regQuery(regState.q, regState.category)]);
    const cats = catRes.categories || [];

    el.innerHTML = `
      <div class="panel"><div class="panel-head">≣ 水利工程质量与安全规范查询</div>
      <div class="panel-body">
        <div class="toolbar" style="align-items:flex-start">
          <input id="regSearchInput" class="field-input" style="max-width:320px" placeholder="输入关键词检索，如：临边、支护、漏电、救生…" value="${esc(regState.q)}">
          <button class="btn btn-primary" onclick="doRegSearch()">检索</button>
          <button class="btn btn-outline" onclick="resetReg()">重置</button>
        </div>
        <div class="toolbar" id="regCats">
          <span class="filter-chip ${!regState.category ? 'active' : ''}" data-cat="" onclick="regCat('')">全部(${listRes.total})</span>
          ${cats.map((c) => `<span class="filter-chip ${regState.category === c.key ? 'active' : ''}" data-cat="${esc(c.key)}" onclick="regCat('${esc(c.key)}')">${esc(c.name)}(${c.count})</span>`).join('')}
        </div>
        <div class="small" style="margin:6px 0 12px">共收录 <b>${listRes.total}</b> 项相关规范 / 技术标准</div>
        <div id="regResult"></div>
      </div></div>`;

    const resBox = $('#regResult');
    if (!listRes.standards.length) {
      resBox.innerHTML = '<div class="empty"><div class="e-ico">🔍</div>未检索到相关规范，请调整关键词或分类</div>';
      return;
    }
    resBox.innerHTML = listRes.standards.map((s) => `
        <div class="finding-card">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span class="mono" style="font-weight:700;white-space:nowrap">${esc(s.code)}</span>
            <span style="font-weight:700;flex:1;min-width:180px">${esc(s.name)}</span>
            <span class="badge role-reviewer">${esc(s.categoryName || s.category || '')}</span>
            ${s.link ? `<a class="btn btn-primary btn-sm" href="${esc(s.link)}" target="_blank" rel="noopener">🔗 链接 / 权威检索</a>` : ''}
          </div>
        </div>`).join('');
  } catch (e) {
    el.innerHTML = '<div class="empty" style="color:var(--danger)">' + esc(e.message) + '</div>';
  }
}
window.renderRegulations = renderRegulations;

function doRegSearch() {
  regState.q = ($('#regSearchInput').value || '').trim();
  renderRegulations();
}
window.doRegSearch = doRegSearch;

function regCat(key) {
  regState.category = key;
  renderRegulations();
}
window.regCat = regCat;

function resetReg() {
  regState = { q: '', category: '' };
  renderRegulations();
}
window.resetReg = resetReg;

/* ================= AI 接口设置 ================= */
const AI_PRESETS = [
  { key: 'openrouter', name: 'OpenRouter（多模型）', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'moonshotai/kimi-latest' },
  { key: 'zhipu', name: '智谱 GLM（推荐免费视觉）', url: 'https://openai.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4v-flash' },
  { key: 'qwen', name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-vl-plus' },
  { key: 'custom', name: '自定义 OpenAI 兼容', url: '', model: '' },
];
function settingsConfig() {
  API.aiConfig().then((r) => {
    const el = $('#view-settings');
    const cur = AI_PRESETS.find((p) => p.url && r.url && p.url.replace(/https?:\/\//, '') === r.url.replace(/https?:\/\//, ''));
    el.innerHTML = `
      <div class="panel"><div class="panel-head">⚙ AI 视觉识别接口设置（仅管理员）</div><div class="panel-body">
        <div class="${r.configured ? 'panel' : 'panel'}" style="border-left:5px solid ${r.configured ? 'var(--ok)' : 'var(--warn)'};padding:0">
          <div class="panel-body" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
            <b>当前状态：${r.configured ? '✅ 已启用 · ' + esc(r.provider || '') + (r.keyMasked ? ' · Key：' + esc(r.keyMasked) : '') : '⚠ 未启用（照片 AI 审核将提示需配置）'}</b>
            ${r.configured ? `<button class="btn btn-outline btn-sm" onclick="clearAiConfig()">清除配置</button>` : ''}
          </div>
        </div>
        <div class="small" style="margin:12px 0">接入 OpenAI 兼容的视觉大模型接口后，系统每次上传照片都由模型按<b>水利规范提示词</b>做真实语义识别（区分安全/质量问题、三色安全帽、不确定项→施工员现场核查）。Key 仅保存在服务端，不暴露前台。</div>
        <div class="form-row"><span class="small">选择服务商</span>
          <select id="aiProvider" class="field-input" onchange="aiPickProvider()">
            ${AI_PRESETS.map((p) => `<option value="${p.key}" ${cur && cur.key === p.key ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row"><span class="small">接口 URL（chat/completions）</span><input id="aiUrl" class="field-input" placeholder="https://…/chat/completions" value="${esc(r.url || '')}"></div>
        <div class="form-row"><span class="small">模型名称</span><input id="aiModel" class="field-input" placeholder="如 glm-4v-flash / qwen-vl-plus" value="${esc(r.model || '')}"></div>
        <div class="form-row"><span class="small">API Key ${r.configured ? '（已配置，留空则保持不变）' : '（必填）'}</span><input id="aiKey" class="field-input" type="password" placeholder="sk-…" value=""></div>
        <div class="toolbar" style="margin-top:8px">
          <button class="btn btn-primary" onclick="saveAiConfig()">💾 保存并启用</button>
          <button class="btn btn-ghost" onclick="testAiConfig()">🧪 测试连接</button>
          <span id="aiMsg" class="small"></span>
        </div>
      </div></div>`;
    // 自定义回顾
    if (!cur) { const s = $('#aiProvider'); if (s) s.value = 'custom'; }
  });
}
function aiPickProvider() {
  const p = AI_PRESETS.find((x) => x.key === $('#aiProvider').value);
  if (p) { $('#aiUrl').value = p.url; $('#aiModel').value = p.model; $('#aiMsg').textContent = ''; }
}
function testAiConfig() {
  const msg = $('#aiMsg'); if (msg) msg.textContent = '请先保存配置，再点击「保存并启用」后即可测试。';
  // 完整测试需在保存后进行，此处提示即可
}
function saveAiConfig() {
  const url = ($('#aiUrl').value || '').trim();
  const key = ($('#aiKey').value || '').trim();
  const model = ($('#aiModel').value || '').trim();
  const provider = (AI_PRESETS.find((x) => x.key === $('#aiProvider').value) || {}).name || '网页配置';
  const msg = $('#aiMsg');
  if (!url) { if (msg) msg.textContent = '请填写接口 URL'; return; }
  if (!/^https?:\/\//.test(url)) { if (msg) msg.textContent = 'URL 需以 http(s):// 开头'; return; }
  // 若已配置且未填新key，带上客户端保存的掩码占位由后端忽略 —— 这里要求重填或服务器已配置
  API.saveAiConfig({ provider, url, key, model }).then((r) => {
    if (msg) { msg.style.color = 'var(--ok)'; msg.textContent = r.ok ? '✅ 已保存并长期启用 AI 识别' : '保存失败'; }
    renderSettings();
  }).catch((e) => { if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = e.message; } });
}
function clearAiConfig() {
  if (!confirm('确定清除 AI 识别配置？清除后照片 AI 审核将提示需配置。')) return;
  API.clearAiConfig().then((r) => { toast(r.msg, 'ok'); renderSettings(); });
}
window.renderSettings = renderSettings;
window.aiPickProvider = aiPickProvider;
window.testAiConfig = testAiConfig;
window.saveAiConfig = saveAiConfig;
window.clearAiConfig = clearAiConfig;
function renderSettings() {
  const el = $('#view-settings');
  if (state.user.role !== 'admin') { el.innerHTML = '<div class="panel"><div class="panel-body"><div class="empty">无权限</div></div></div>'; return; }
  el.innerHTML = '<div class="empty">加载中…</div>';
  settingsConfig();
}

/* ================= 用户管理 ================= */
function renderUsers() {
  const el = $('#view-users');
  if (state.user.role !== 'admin') { el.innerHTML = '<div class="panel"><div class="panel-body"><div class="empty">无权限</div></div></div>'; return; }
  el.innerHTML = '<div class="empty">加载中…</div>';
  API.getUsers().then((r) => {
    el.innerHTML = `
      <div class="toolbar">
        <button class="btn btn-primary" onclick="showAddUser()">＋ 新增用户</button>
        <span class="small">管理员可创建账号并赋予【施工员 / 审核员 / 管理员】身份</span>
      </div>
      <div class="panel"><div class="panel-head">⚙ 用户账号与身份管理（共 ${r.users.length} 人）</div>
      <div class="panel-body" style="padding:16px 20px">
      <table class="tbl"><thead><tr><th>姓名</th><th>账号</th><th>所属工程</th><th>身份</th><th>创建时间</th><th>操作</th></tr></thead><tbody>
      ${r.users.map((u) => `<tr>
        <td>${esc(u.name)}</td>
        <td class="mono">${esc(u.username)}</td>
        <td>${esc(u.project)}</td>
        <td>${roleBadge(u.role)}</td>
        <td class="small">${fmtDate(u.createdAt).slice(0, 10)}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="editUserRole('${u.id}')">调整身份</button>
          ${state.user.id !== u.id ? `<button class="btn btn-danger btn-sm" onclick="delUser('${u.id}','${esc(u.name)}')">删除</button>` : ''}
        </td></tr>`).join('')}
      </tbody></table></div></div>`;
  }).catch((e) => el.innerHTML = '<div class="empty">' + esc(e.message) + '</div>');
}

function showAddUser() {
  openModal('新增用户',
    `<div class="form-row"><label>姓名</label><input id="nuName" class="field-input" placeholder="如：王工"></div>
     <div class="form-row"><label>登录账号</label><input id="nuUser" class="field-input" placeholder="如：wang"></div>
     <div class="form-row"><label>初始密码</label><input id="nuPass" class="field-input" type="text" value="123456"></div>
     <div class="form-row"><label>所属工程</label><input id="nuProject" class="field-input" value="${esc(state.user.project)}"></div>
     <div class="form-row"><label>身份</label>
       <select id="nuRole" class="field-input">
         <option value="worker">施工员</option>
         <option value="reviewer">审核员</option>
         <option value="admin">管理员</option>
       </select></div>`,
    `<button class="btn btn-ghost" style="color:var(--steel);border-color:var(--line)" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="submitAddUser()">创建</button>`);
}
window.showAddUser = showAddUser;

async function submitAddUser() {
  const name = $('#nuName').value.trim(), username = $('#nuUser').value.trim(), password = $('#nuPass').value.trim();
  if (!name || !username || !password) { toast('请完整填写', 'err'); return; }
  try {
    await API.createUser({ name, username, password, role: $('#nuRole').value, project: $('#nuProject').value.trim() });
    toast('用户创建成功');
    closeModal(); renderUsers();
  } catch (e) { toast(e.message, 'err'); }
}
window.submitAddUser = submitAddUser;

async function editUserRole(id) {
  const users = (await API.getUsers()).users;
  const u = users.find((x) => x.id === id);
  if (!u) return;
  openModal('调整身份 — ' + u.name,
    `<div class="form-row"><label>所属工程</label><input id="euProject" class="field-input" value="${esc(u.project || '')}"></div>
     <div class="form-row"><label>身份</label>
       <select id="euRole" class="field-input">
         <option value="worker" ${u.role === 'worker' ? 'selected' : ''}>施工员</option>
         <option value="reviewer" ${u.role === 'reviewer' ? 'selected' : ''}>审核员</option>
         <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理员</option>
       </select></div>`,
    `<button class="btn btn-ghost" style="color:var(--steel);border-color:var(--line)" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" onclick="submitEditRole('${id}')">保存</button>`);
}
window.editUserRole = editUserRole;

async function submitEditRole(id) {
  try {
    await API.setUser(id, { role: $('#euRole').value, project: $('#euProject').value.trim() });
    toast('身份已更新');
    closeModal(); renderUsers();
  } catch (e) { toast(e.message, 'err'); }
}
window.submitEditRole = submitEditRole;

async function delUser(id, name) {
  if (!confirm('确认删除用户「' + name + '」？')) return;
  try {
    await API.delUser(id);
    toast('已删除');
    renderUsers();
  } catch (e) { toast(e.message, 'err'); }
}
window.delUser = delUser;

/* ================= 初始化 ================= */
function init() {
  $('#loginForm').addEventListener('submit', doLogin);
  $('#logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('token');
    location.reload();
  });
  $$('.nav-item').forEach((n) => n.addEventListener('click', () => switchView(n.dataset.view)));

  const token = localStorage.getItem('token');
  if (token) {
    API.me().then((r) => { state.user = r.user; afterLogin(); })
      .catch(() => showLogin());
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);