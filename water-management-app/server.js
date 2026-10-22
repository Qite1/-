'use strict';
// 水利工程质量安全合规管理助手 - 后端服务（纯 Node 零依赖）
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./server/db');
const token = require('./server/auth');
const { analyzeImageAsync, hasVisionApi, getAiConfig } = require('./server/inspection');
const { buildWorkbook } = require('./server/excel');
const regs = require('./server/regulations.json');
const company = require('./server/company.js');

const ROOT = __dirname; // server.js 位于应用根目录
const PUBLIC = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const PORT = process.env.PORT || 8380;
const HOST = '127.0.0.1';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limitMb = 40) {
  return new Promise((resolve, reject) => {
    let data = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitMb * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      data.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(data)));
    req.on('error', reject);
  });
}

function authUser(req) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  const payload = t ? token.verify(t) : null;
  if (!payload) return null;
  return db.findUserById(payload.uid);
}

function requireRole(roles) {
  return (user) => (user && roles.includes(user.role) ? true : false);
}

const isAdmin = requireRole(['admin']);
const isReviewer = requireRole(['admin', 'reviewer']);
const isAny = requireRole(['admin', 'reviewer', 'worker']);

// 脱敏显示 Key（保留头尾各 4 位）
function maskKey(k) {
  if (!k) return '';
  const s = String(k);
  if (s.length <= 8) return s.slice(0, 2) + '****';
  return s.slice(0, 4) + '…' + s.slice(-4);
}

// 逐站生成 Excel：把一条审核单(findings 数组)写成两张表(隐患清单 / 汇总)
function buildInspectionWorkbook(ins, reviewerName, meta) {
  const findings = ins.findings || [];
  const sheet1Rows = [
    ['序号', '照片文件名', '问题类型', '风险等级', '隐患类型', '隐患描述', '规范依据', '整改意见', '是否待现场核实'],
  ];
  let idx = 1;
  findings.forEach((f) => {
    sheet1Rows.push([
      idx++,
      f.photo,
      f.type || '安全',
      f.risk,
      f.category,
      f.description,
      f.regulation,
      f.rectification,
      f.uncertain ? '是，请现场核查' : '否',
    ]);
  });

  const topRisk = findings.length ? maxRisk(findings) : '无';
  const sheet2Rows = [
    ['项目', '内容'],
    ['审核单编号', ins.code],
    ['上传单位/人员', (ins.uploader || '') + '（' + (ins.uploaderRoleName || '') + '）'],
    ['工程名称', ins.project],
    ['审核日期', ins.createdAt.slice(0, 10)],
    ['照片数量', ins.photoCount || 0],
    ['隐患条目数', findings.length],
    ['最高风险等级', topRisk],
    ['审核状态', ins.statusText || ins.status],
    ['递交审核员', reviewerName || ins.reviewerName || '待确认'],
    ['备注', ins.remark || ''],
  ];

  const sheets = [
    { name: '安全隐患审核', rows: sheet1Rows, colWidths: [6, 18, 10, 10, 14, 42, 42, 42, 16] },
    { name: '审核信息', rows: sheet2Rows, colWidths: [14, 46] },
  ];
  return buildWorkbook(sheets, { title: ins.code });
}

// 工作台概览导出：把所有审核单/台账汇总为"问题与整改台账"Excel
function buildOverviewWorkbook(ledgers, inspections) {
  // 台账主表
  const rows1 = [
    ['序号', '台账编号', '来源审核单', '工程名称', '责任施工员', '审核员', '最高风险', '状态', '生成时间'],
  ];
  ledgers.forEach((l, i) => {
    rows1.push([
      i + 1, l.code, l.inspectionCode, l.project, l.workerName, l.reviewerName, l.topRisk || '提示', l.statusText, (l.confirmedAt || '').slice(0, 19).replace('T', ' '),
    ]);
  });
  // 问题明细表（多条问题）
  const rows2 = [
    ['序号', '所在台账', '来源审核单', '问题类型', '风险等级', '问题描述', '规范依据', '整改意见', '是否待核查', '核查要点'],
  ];
  let k = 1;
  (ledgers.length ? ledgers : inspections).forEach((src) => {
    const codeStr = src.code || src.inspectionCode || '';
    const fromCode = src.inspectionCode || codeStr;
    (src.findings || []).forEach((f) => {
      rows2.push([
        k++, codeStr, fromCode,
        f.type || '安全', f.risk, f.description, f.regulation, f.rectification,
        f.uncertain ? '是' : '否',
        f.confirmNote || (f.uncertain ? '现场核查该部位' : ''),
      ]);
    });
  });

  const sheets = [
    { name: '整改台账汇总', rows: rows1, colWidths: [6, 20, 18, 20, 14, 14, 10, 16, 20] },
    { name: '问题与整改明细', rows: rows2, colWidths: [6, 20, 18, 10, 10, 46, 42, 44, 10, 30] },
  ];
  return buildWorkbook(sheets, { title: '问题与整改台账概览' });
}

function maxRisk(findings) {
  const order = { 重大: 3, 较大: 2, 一般: 1, 提示: 0 };
  let best = '提示';
  for (const f of findings) if (order[f.risk] > order[best]) best = f.risk;
  return best;
}

function roleName(r) {
  return { admin: '管理员', reviewer: '审核员', worker: '施工员' }[r] || r;
}

async function handleApi(req, res, url) {
  const u = new URL(url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;
  let body = null;

  if (p === '/api/login' && req.method === 'POST') {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const user = db.verifyLogin(body.username, body.password);
    if (!user) return sendJson(res, 401, { ok: false, msg: '账号或密码错误' });
    const t = token.issue(user);
    return sendJson(res, 200, {
      ok: true,
      token: t,
      user: { id: user.id, username: user.username, name: user.name, role: user.role, project: user.project },
    });
  }

  if (p === '/api/me' && req.method === 'GET') {
    const user = authUser(req);
    if (!user) return sendJson(res, 401, { ok: false, msg: '未登录' });
    return sendJson(res, 200, { ok: true, user: publicUserObj(user) });
  }

  // ---- 规范查询 ----
  if (p === '/api/regulations/categories' && req.method === 'GET') {
    const cats = Object.entries(regs.categories).map(([key, name]) => ({
      key, name,
      count: (regs.standards || []).filter((s) => s.category === key).length,
    }));
    return sendJson(res, 200, { ok: true, categories: cats });
  }

  if (p === '/api/regulations' && req.method === 'GET') {
    const q = (u.searchParams.get('q') || '').trim().toLowerCase();
    const cat = u.searchParams.get('category') || '';
    let standards = (regs.standards || []).slice();
    if (cat) standards = standards.filter((s) => s.category === cat);
    if (q) {
      standards = standards.filter((s) => {
        const hay = (s.code + s.name + (s.fulltext || '') + s.clauses.map((c) => c.title + c.text).join(' ')).toLowerCase();
        return hay.includes(q);
      });
    }
    // 命中摘要：记录命中的条款，便于前端聚焦
    const list = standards.map((s) => {
      const matchedClauses = s.clauses.filter((c) => {
        if (!q) return true;
        return (c.title + c.text + c.req).toLowerCase().includes(q);
      });
      return {
        code: s.code, name: s.name, category: s.category,
        categoryName: regs.categories[s.category],
        link: s.link || '', linkType: s.linkType || 'search',
        fulltext: s.fulltext || '',
        clauseCount: s.clauses.length,
        matchedClauses: matchedClauses.length ? matchedClauses : s.clauses,
      };
    });
    return sendJson(res, 200, { ok: true, total: list.length, standards: list });
  }

  // ---- 公司简介 ----
  if (p === '/api/company/profile' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, company });
  }

  // ---- AI 接口状态（供前端展示识别引擎来源）----
  if (p === '/api/ai/status' && req.method === 'GET') {
    const cfg = getAiConfig();
    return sendJson(res, 200, {
      ok: true,
      aiEnabled: !!cfg,
      provider: cfg ? cfg.provider || (cfg.source === 'env' ? '环境变量' : '网页配置') : '',
      url: cfg ? cfg.url.replace(/https?:\/\//, '') : '',
      model: cfg ? cfg.model : '',
      source: cfg ? cfg.source : '',
      hint: cfg ? '照片 AI 识别已启用（' + (cfg.provider || cfg.source) + '）。' : '未配置 AI 接口。请管理员在「设置」中填写视觉模型接口 URL / Key / 模型，保存后即长期启用真实 AI 识别。',
    });
  }

  // ---- 管理员：AI 接口配置（持久化到 data/ai-config.json）----
  if (p === '/api/ai/config' && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const cfg = getAiConfig();
    const fp = path.join(__dirname, 'data', 'ai-config.json');
    let fileSaved = false;
    try { fileSaved = fs.existsSync(fp); } catch (e) { /* ignore */ }
    return sendJson(res, 200, {
      ok: true,
      configured: !!cfg,
      provider: cfg ? cfg.provider || '' : '',
      url: cfg ? cfg.url : '',
      keyMasked: cfg ? maskKey(cfg.key) : '',
      model: cfg ? cfg.model : '',
      key: fileSaved ? '' : '',   // 不回传明文
      fileSaved,
    });
  }
  if (p === '/api/ai/config' && req.method === 'POST') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '仅管理员可配置 AI 接口' });
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const url = String(body.url || '').trim();
    const key = String(body.key || '').trim();
    const model = String(body.model || '').trim() || 'gpt-4o-mini';
    const provider = String(body.provider || '网页配置').trim();
    if (!url) return sendJson(res, 400, { ok: false, msg: '接口 URL 不能为空' });
    if (!/^https?:\/\//.test(url)) return sendJson(res, 400, { ok: false, msg: 'URL 需以 http(s):// 开头' });
    // 未填 Key 时复用已保存的 Key（半隐藏重配置场景）
    let effKey = key;
    if (!effKey) {
      const cur = getAiConfig();
      if (cur) effKey = cur.key;
    }
    if (!effKey) return sendJson(res, 400, { ok: false, msg: 'API Key 不能为空' });
    try {
      fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
      fs.writeFileSync(path.join(__dirname, 'data', 'ai-config.json'), JSON.stringify({ provider, url, key: effKey, model, savedAt: new Date().toISOString() }, null, 2));
      return sendJson(res, 200, { ok: true, msg: 'AI 接口已配置并长期启用', aiEnabled: true });
    } catch (e) {
      return sendJson(res, 500, { ok: false, msg: '保存失败：' + e.message });
    }
  }
  if (p === '/api/ai/config' && req.method === 'DELETE') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '仅管理员可清除 AI 配置' });
    try {
      fs.rmSync(path.join(__dirname, 'data', 'ai-config.json'), { force: true });
      return sendJson(res, 200, { ok: true, msg: '已清除 AI 配置', aiEnabled: false });
    } catch (e) {
      return sendJson(res, 500, { ok: false, msg: '清除失败：' + e.message });
    }
  }

  // ---- 管理员：用户管理 ----
  if (p === '/api/admin/users' && req.method === 'GET') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    return sendJson(res, 200, { ok: true, users: db.listUsers() });
  }

  if (p === '/api/admin/users' && req.method === 'POST') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    try {
      const created = db.createUser({
        username: body.username,
        password: body.password,
        name: body.name,
        role: body.role,
        project: body.project,
      });
      return sendJson(res, 200, { ok: true, user: created });
    } catch (e) {
      return sendJson(res, 400, { ok: false, msg: e.code === 'USER_EXISTS' ? '用户名已存在' : '创建失败' });
    }
  }

  if (p.startsWith('/api/admin/users/') && req.method === 'PUT') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const id = p.slice('/api/admin/users/'.length);
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const updated = db.updateUserRole(id, body.role, body.project);
    if (!updated) return sendJson(res, 404, { ok: false, msg: '用户不存在' });
    return sendJson(res, 200, { ok: true, user: updated });
  }

  if (p.startsWith('/api/admin/users/') && req.method === 'DELETE') {
    const user = authUser(req);
    if (!isAdmin(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const id = p.slice('/api/admin/users/'.length);
    db.deleteUser(id);
    return sendJson(res, 200, { ok: true });
  }

  // ---- 施工员：上传并 AI 审核 ----
  if (p === '/api/worker/upload' && req.method === 'POST') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    body = JSON.parse((await readBody(req, 80)).toString('utf8') || '{}');
    if (!body.photo && (!body.files || !body.files.length)) {
      return sendJson(res, 400, { ok: false, msg: '未收到照片' });
    }

    const items = Array.isArray(body.files) && body.files.length ? body.files : [body.photo];
    const saved = [];
    const perPhoto = [];   // {name, decodeStatus, features, findings}
    const hints = (body.hints || '').trim();

    for (const [i, item] of items.entries()) {
      const b64 = item.data || item.base64 || '';
      const mime = item.mime || 'image/jpeg';
      if (!b64) continue;
      let buf;
      try {
        buf = Buffer.from(b64, 'base64');
      } catch (e) {
        return sendJson(res, 400, { ok: false, msg: '图片数据格式错误' });
      }
      const ext = extOf(mime);
      const fname = sanitize(item.name || `photo_${Date.now()}_${i + 1}.${ext}`);
      const fpath = path.join(UPLOAD_DIR, fname);
      fs.writeFileSync(fpath, buf);

      const analysis = await analyzeImageAsync(fpath, { photoName: fname, hints });
      // 每个照片标记其识别来源（像素/规则/回退）
      (analysis.findings || []).forEach((f) => { f.photo = fname; f.source = f.source || 'pixel'; });
      perPhoto.push({
        fname,
        path: `/uploads/${fname}`,
        decodeStatus: analysis.decodeStatus,
        features: analysis.features || null,
        findings: analysis.findings || [],
        engine: analysis.engine,
      });
      saved.push({ fname, path: `/uploads/${fname}` });
    }

    // 跨照片去重：同一隐患(id)只保留一行；图片名合并以便追溯
    const seen = new Set();
    const uniqueFindings = [];
    for (const p of perPhoto) {
      for (const f of p.findings || []) {
        const key = f.id || (f.category + '|' + f.description);
        const existing = uniqueFindings.find((x) => (x.id || (x.category + '|' + x.description)) === key);
        if (existing) {
          if (!existing.photos) existing.photos = [existing.photo];
          if (!existing.photos.includes(f.photo)) existing.photos.push(f.photo);
          continue;
        }
        f.photos = [f.photo];
        uniqueFindings.push(f);
      }
    }

    const now = new Date();
    const code = 'WQ' + now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '-' + crypto.randomUUID().slice(0, 4).toUpperCase();
    const ins = {
      code,
      uploaderId: user.id,
      uploader: user.name,
      uploaderRole: user.role,
      uploaderRoleName: roleName(user.role),
      project: body.project || user.project || '未填写',
      photos: saved,
      photoAnalysis: perPhoto,
      photoCount: saved.length,
      findings: uniqueFindings,
      topRisk: uniqueFindings.length ? maxRisk(uniqueFindings) : '无',
      hints: body.hints || '',
      status: 'submitted', // submitted -> confirming -> confirmed
      statusText: '已递交待审核',
      submittedAt: now.toISOString(),
    };
    db.addInspection(ins);
    const riskStats = { 重大: 0, 较大: 0, 一般: 0, 提示: 0 };
    uniqueFindings.forEach((f) => (riskStats[f.risk] = (riskStats[f.risk] || 0) + 1));
    const aiEnabled = hasVisionApi();
    const engines = Array.from(new Set(perPhoto.map((p) => p.engine).filter(Boolean)));
    const engineLabel = aiEnabled
      ? 'AI 视觉引擎' + (engines.includes('vision-api-error-fallback') ? '（失败已回退本地引擎）' : '')
      : '本地识别引擎';
    return sendJson(res, 200, {
      ok: true,
      inspection: jsonSafe(ins),
      riskStats,
      msg: `已上传 ${saved.length} 张照片，${engineLabel}共识别 ${uniqueFindings.length} 项隐患，最高风险「${ins.topRisk}」`,
    });
  }

  // ---- 审核单查询 ----
  if (p === '/api/inspections' && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    let list = db.listInspections();
    if (user.role === 'worker') list = list.filter((i) => i.uploaderId === user.id);
    // 管理员与审核员查看全部审核单（含待审核）
    return sendJson(res, 200, { ok: true, inspections: list.map(jsonSafe) });
  }

  // 待审核计数：审核员工作台
  if (p === '/api/review/todo' && req.method === 'GET') {
    const user = authUser(req);
    if (!isReviewer(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const todo = db.listInspections({ status: 'submitted' });
    return sendJson(res, 200, { ok: true, count: todo.length });
  }

  // ---- Excel 导出：施工员递交 / 审核员下载（须在通用 GET 之前匹配）----
  if (p.startsWith('/api/inspections/') && p.endsWith('/excel') && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const id = p.slice('/api/inspections/'.length, -'/excel'.length);
    const ins = db.getInspection(id);
    if (!ins) return sendJson(res, 404, { ok: false, msg: '不存在' });
    const reviewer =
      (ins.reviewerId && db.findUserById(ins.reviewerId)) || null;
    const buf = buildInspectionWorkbook(ins, reviewer ? reviewer.name : '', {});
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(ins.code + '_安全隐患审核.xlsx')}`,
      'Content-Length': buf.length,
    });
    res.end(buf);
    return;
  }

  if (p.startsWith('/api/inspections/') && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const id = p.slice('/api/inspections/'.length);
    const ins = db.getInspection(id);
    if (!ins) return sendJson(res, 404, { ok: false, msg: '不存在' });
    return sendJson(res, 200, { ok: true, inspection: jsonSafe(ins) });
  }

  // ---- 审核员：确认 / 打回 ----
  if (p.startsWith('/api/inspections/') && (p.endsWith('/confirm') || p.endsWith('/reject')) && req.method === 'POST') {
    const user = authUser(req);
    if (!isReviewer(user)) return sendJson(res, 403, { ok: false, msg: '只有审核员可操作' });
    const action = p.endsWith('/confirm') ? 'confirm' : 'reject';
    const id = p.slice('/api/inspections/'.length, action === 'confirm' ? -'/confirm'.length : -'/reject'.length);
    const ins = db.getInspection(id);
    if (!ins) return sendJson(res, 404, { ok: false, msg: '不存在' });
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');

    if (action === 'confirm') {
      const updated = db.updateInspection(id, {
        status: 'confirmed',
        statusText: '已确认并生成台账',
        reviewerId: user.id,
        reviewerName: user.name,
        reviewerComment: body.comment || '',
        confirmedAt: new Date().toISOString(),
      });
      // 生成本台账条目
      db.addLedger({
        code: ins.code + '-T',
        inspectionId: ins.id,
        inspectionCode: ins.code,
        workerId: ins.uploaderId,
        workerName: ins.uploader,
        reviewerId: user.id,
        reviewerName: user.name,
        project: ins.project,
        findings: ins.findings,
        topRisk: ins.topRisk,
        status: 'pending', // pending(待整改) -> rectifying -> rectified -> closed
        statusText: '待落实整改',
        remark: body.comment || '',
        confirmedAt: new Date().toISOString(),
      });
      return sendJson(res, 200, { ok: true, inspection: jsonSafe(updated) });
    } else {
      const updated = db.updateInspection(id, {
        status: 'rejected',
        statusText: '已打回',
        reviewerId: user.id,
        reviewerName: user.name,
        reviewerComment: body.comment || '请补充影像资料或现场复核',
        rejectedAt: new Date().toISOString(),
      });
      return sendJson(res, 200, { ok: true, inspection: jsonSafe(updated) });
    }
  }

  // ---- 台账 ----
  if (p === '/api/ledgers' && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    let list = db.listLedgers();
    if (user.role === 'worker') list = list.filter((l) => l.workerId === user.id);
    return sendJson(res, 200, { ok: true, ledgers: list.map(jsonSafe) });
  }

  // ---- 工作台概览：问题与整改台账导出 Excel ----
  if (p === '/api/overview/excel' && req.method === 'GET') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const ledgers = db.listLedgers();
    const inspections = db.listInspections();
    const scope = user.role === 'worker'
      ? { ledgers: ledgers.filter((l) => l.workerId === user.id), inspections: inspections.filter((i) => i.uploaderId === user.id) }
      : { ledgers, inspections };
    const buf = buildOverviewWorkbook(scope.ledgers, scope.inspections);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('问题与整改台账概览.xlsx')}`,
      'Content-Length': buf.length,
    });
    res.end(buf);
    return;
  }

  if (p.startsWith('/api/ledgers/') && p.endsWith('/status') && req.method === 'POST') {
    const user = authUser(req);
    if (!isAny(user)) return sendJson(res, 403, { ok: false, msg: '无权限' });
    const id = p.slice('/api/ledgers/'.length, -'/status'.length);
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const newStatus = body.status;
    const map = {
      pending: '待落实整改',
      rectifying: '整改中',
      rectified: '已完成整改',
      closed: '已闭环销号',
    };
    if (!map[newStatus]) return sendJson(res, 400, { ok: false, msg: '状态非法' });
    // 施工员只能把 pending->rectifying / rectifying->rectified
    const ledger = db.getLedger(id);
    if (!ledger) return sendJson(res, 404, { ok: false, msg: '不存在' });
    db.updateLedger(id, {
      status: newStatus,
      statusText: map[newStatus],
      updatedAt: new Date().toISOString(),
      rectificationNote: body.note || ledger.rectificationNote || '',
      rectifiedAt: newStatus === 'rectified' ? new Date().toISOString() : ledger.rectifiedAt,
    });
    return sendJson(res, 200, { ok: true, ledger: jsonSafe(db.getLedger(id)) });
  }

  // ---- 台账删除（管理员 / 审核员权限） ----
  if (p.startsWith('/api/ledgers/') && p.endsWith('/delete') && req.method === 'DELETE') {
    const user = authUser(req);
    if (!isReviewer(user)) return sendJson(res, 403, { ok: false, msg: '仅管理员与审核员可删除台账条目' });
    const id = p.slice('/api/ledgers/'.length, -'/delete'.length);
    const ledger = db.getLedger(id);
    if (!ledger) return sendJson(res, 404, { ok: false, msg: '不存在' });
    // 若台账由某审核单确认生成，删除时将该审核单退回“待审核”，便于重新确认
    if (ledger.inspectionId) {
      const ins = db.getInspection(ledger.inspectionId);
      if (ins) {
        db.updateInspection(ins.id, {
          status: 'submitted', statusText: '已递交待审核',
          reviewerId: null, reviewerName: null, reviewerComment: null, confirmedAt: null,
        });
      }
    }
    db.deleteLedger(id);
    return sendJson(res, 200, { ok: true, msg: '台账条目已删除' });
  }

  // ---- 上传照片浏览 ----
  if (p.startsWith('/uploads/') && req.method === 'GET') {
    const fname = path.basename(p);
    const fpath = path.join(UPLOAD_DIR, fname);
    if (!fs.existsSync(fpath)) return sendJson(res, 404, { ok: false, msg: '资源不存在' });
    const ext = path.extname(fpath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(fpath).pipe(res);
    return;
  }

  return sendJson(res, 404, { ok: false, msg: '接口不存在' });
}

// ---------- helpers ----------
function publicUserObj(u) {
  return { id: u.id, username: u.username, name: u.name, role: u.role, project: u.project };
}

function jsonSafe(x) {
  return JSON.parse(JSON.stringify(x, (k, v) => (k === 'passwordHash' ? undefined : v)));
}

function sanitize(name) {
  const base = path.basename(String(name).replace(/[\\/]/g, '_'));
  return base.replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
}

function extOf(mime) {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  return 'jpg';
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = u.pathname;

  if (p.startsWith('/api')) {
    try {
      return await handleApi(req, res, req.url);
    } catch (e) {
      console.error('[API ERROR]', e);
      if (!res.headersSent) return sendJson(res, 500, { ok: false, msg: '服务器内部错误' });
    }
    return;
  }

  // 静态资源
  let filePath = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC, 'index.html');
  const ext = path.extname(filePath).toLowerCase();
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(data);
});

server.listen(PORT, HOST, () => {
  console.log(`\n═ 水利工程质量安全合规管理助手 ═`);
  console.log(`服务已启动： http://${HOST}:${PORT}`);
  console.log(`初始账号：admin/admin123(管理员)、reviewer/review123(审核员)、worker/worker123(施工员)\n`);
});