/* ============================================================
 * 水利工程质量安全合规管理助手 —— 后端服务入口
 *
 * 依赖：仅 Node 内置模块（http/https/fs/path/stream/crypto），零第三方包。
 * 提供：
 *   - 静态服务前端（index.html / css/ / js/）
 *   - /api/* REST 接口（认证、用户、问题台账、规范、AI 配置）
 *   - /api/ai/** AI 代理（照片识别、对话、联网检索、流式 SSE）
 * 数据持久化到 server/data/*.json。
 *
 * 启动：node server/server.js   （默认端口 8123，可用环境变量 PORT 覆盖）
 * ============================================================ */

const http = require('http');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const auth = require('./auth');
const seed = require('./seed');
const ai = require('./ai');
const assistant = require('./assistant');
const { REGULATIONS } = require('./regulations');

const ROOT = path.join(__dirname, '..'); // 前端根目录（工作区）
const PORT = process.env.PORT || process.env.npm_package_config_port || 8123;

/* 兼容不识别 thinking 参数检测 */
const THINKING_HINT = /thinking/i;

/* ---------------- 工具 ---------------- */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

function sendErr(res, status, message) {
  sendJson(res, status, { error: message });
}

/* 解析请求体 JSON，带大小上限（照片 base64 较多，放宽到 30MB） */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 30 * 1024 * 1024;
    req.on('data', c => {
      size += c.length;
      if (size > MAX) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

/* 安全路径解析，防止目录穿越 */
function resolveSafe(rawPath) {
  const decoded = decodeURIComponent(rawPath);
  const rel = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let fp = path.join(ROOT, rel);
  const within = path.resolve(fp).startsWith(path.resolve(ROOT) + path.sep) || path.resolve(fp) === path.resolve(ROOT);
  if (!within) return null;
  fp = path.resolve(fp);
  // 禁止直接访问 data 目录与 server/backend 源码
  const upper = path.dirname(fp.toLowerCase());
  if (upper.startsWith(path.join(ROOT, 'server').toLowerCase())) return null;
  if (fp.toLowerCase().includes(path.join(ROOT, 'server').toLowerCase() + path.sep)) return null;
  return fp;
}

/* ---------------- 静态文件服务 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let fp = resolveSafe(pathname);
  if (!fp) return sendErr(res, 403, '禁止访问');
  if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
    fp = path.join(fp, 'index.html');
  }
  if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return sendErr(res, 404, 'Not Found');
  const ext = path.extname(fp).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // 流式返回文件，避免大文件占用内存
  const stream = fs.createReadStream(fp);
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  stream.pipe(res);
}

/* ---------------- 认证中间件辅助 ---------------- */
function authenticated(req) {
  const user = auth.authUser(auth.parseToken(req));
  return user;
}
function requireUser(user) {
  if (!user) return { status: 401, body: { error: '未登录或登录已失效' } };
  return null;
}
function requireAdmin(user) {
  if (!user) return { status: 401, body: { error: '未登录或登录已失效' } };
  if (user.role !== 'admin') return { status: 403, body: { error: '仅管理员可执行该操作' } };
  return null;
}

/* ---------------- 各路由处理器 ---------------- */
const API = {
  /* ---- 认证 ---- */
  async 'POST/api/auth/login'(req, res, user, body) {
    const u = String(body.username || ''), p = String(body.password || '');
    const r = auth.login(u, p);
    if (!r) return sendErr(res, 401, '账号或密码错误');
    return sendJson(res, 200, { token: r.token, user: r.user });
  },
  'POST/api/auth/logout'(req, res, user) {
    auth.logout(auth.parseToken(req));
    return sendJson(res, 200, { ok: true });
  },
  'GET/api/auth/me'(req, res, user) {
    if (!user) return sendErr(res, 401, '未登录');
    return sendJson(res, 200, { user: db.sanitizeUser(user) });
  },

  /* ---- 统计（首页） ---- */
  'GET/api/stats'(req, res, user) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    return sendJson(res, 200, db.stats());
  },

  /* ---- 用户管理（仅管理员） ---- */
  'GET/api/users'(req, res, user) {
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    return sendJson(res, 200, { users: db.listUsers().map(u => db.sanitizeUser(u)) });
  },
  async 'POST/api/users'(req, res, user, body) {
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    const username = String(body.username || '').trim();
    const name = String(body.name || '').trim();
    const password = String(body.password || '123456');
    const role = ['admin', 'auditor', 'builder'].includes(body.role) ? body.role : 'builder';
    if (!username || !name) return sendErr(res, 400, '请填写账号与姓名');
    if (db.findUserByUsername(username)) return sendErr(res, 409, '该账号已存在');
    const nu = db.saveUser({ id: body.id || db.uid('u'), username, password, name, role, phone: String(body.phone || ''), createdAt: Date.now() });
    return sendJson(res, 201, { user: db.sanitizeUser(nu) });
  },
  async 'PUT/api/users~role'(req, res, user, body) {
    // body: { id, role }
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    const u = db.findUserById(body.id);
    if (!u) return sendErr(res, 404, '用户不存在');
    const role = ['admin', 'auditor', 'builder'].includes(body.role) ? body.role : u.role;
    u.role = role;
    db.saveUser(u);
    return sendJson(res, 200, { user: db.sanitizeUser(u) });
  },
  'DELETE/api/users~(id)'(req, res, user, body, params) {
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    const u = db.findUserById(params.id);
    if (!u) return sendErr(res, 404, '用户不存在');
    if (u.id === user.id) return sendErr(res, 400, '不能删除当前登录账号');
    db.deleteUser(params.id);
    return sendJson(res, 200, { ok: true });
  },

  /* ---- 问题台账 ---- */
  'GET/api/issues'(req, res, user) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    return sendJson(res, 200, { issues: db.listIssues() });
  },
  'GET/api/issues~(id)'(req, res, user, body, params) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const i = db.getIssue(params.id);
    if (!i) return sendErr(res, 404, '问题不存在');
    return sendJson(res, 200, { issue: i });
  },
  async 'POST/api/issues'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const now = Date.now();
    const issue = {
      id: body.id || db.uid('i'),
      title: String(body.title || '未命名隐患').slice(0, 200),
      site: String(body.site || ''),
      note: String(body.note || ''),
      photos: Array.isArray(body.photos) ? body.photos.slice(0, 4) : [],
      risks: Array.isArray(body.risks) ? body.risks : [],
      summary: String(body.summary || ''),
      risk: ['high', 'medium', 'low'].includes(body.risk) ? body.risk : 'medium',
      status: 'pending',
      builderId: user.id,
      auditorId: null,
      aiFallback: !!body.aiFallback,
      createdAt: now,
      updatedAt: now,
      history: Array.isArray(body.history) && body.history.length
        ? body.history
        : [{ t: '提交审核', by: user.id, at: now, content: '施工员提交，等待审核员确认' }]
    };
    db.saveIssue(issue);
    return sendJson(res, 201, { issue });
  },
  async 'PUT/api/issues~(id)'(req, res, user, body, params) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const i = db.getIssue(params.id);
    if (!i) return sendErr(res, 404, '问题不存在');
    // 台账编辑：审核员与管理员；施工员仅可改自己的部位/说明等（保障性约束）
    if (user.role !== 'auditor' && user.role !== 'admin' && i.builderId !== user.id) {
      return sendErr(res, 403, '无权限编辑该台账');
    }
    if (body.title != null) i.title = String(body.title).slice(0, 200);
    if (body.site != null) i.site = String(body.site);
    if (body.note != null) i.note = String(body.note);
    if (body.risk != null && ['high', 'medium', 'low'].includes(body.risk)) i.risk = body.risk;
    if (body.status != null && Object.keys(auth.STATUS_META).includes(body.status) &&
        (user.role === 'admin' || user.role === 'auditor')) i.status = body.status;
    if (body.risks != null && Array.isArray(body.risks)) i.risks = body.risks;
    if (body.summary != null) i.summary = String(body.summary);
    i.updatedAt = Date.now();
    i.history = i.history || [];
    i.history.push({ t: '台账编辑', by: user.id, at: i.updatedAt, content: '台账被更新' });
    db.saveIssue(i);
    return sendJson(res, 200, { issue: i });
  },
  /* 状态流转专用（含审计 history） */
  async 'PUT/api/issues~(id)/status'(req, res, user, body, params) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const i = db.getIssue(params.id);
    if (!i) return sendErr(res, 404, '问题不存在');
    const st = String(body.status || '');
    const transitions = {
      confirmed: ['auditor', 'admin'],   // 确认入台账
      rectifying: ['auditor', 'admin'],  // 开始整改
      rectified: ['auditor', 'admin', 'builder'], // 标记已整改
      closed: ['auditor', 'admin'],      // 销号
      pending: []                         // 不可回退到待审核（或仅管理员）
    };
    const allowed = transitions[st] || [];
    if (!transitions[st]) return sendErr(res, 400, '非法状态');
    if (!allowed.includes(user.role)) return sendErr(res, 403, '无权限执行该状态变更');

    i.status = st;
    i.updatedAt = Date.now();
    i.history = i.history || [];
    const auditMsg = {
      confirmed: '审核员确认问题属实，纳入整改台账',
      rectifying: '已下达整改任务，进入整改中',
      rectified: '施工单位报告已完成整改',
      closed: '现场复核通过，完成销号'
    };
    const auditTitle = {
      confirmed: '审核确认',
      rectifying: '开始整改',
      rectified: '已整改',
      closed: '销号'
    };
    if (st === 'rectified') i.rectifiedAt = Date.now();
    i.history.push({ t: auditTitle[st] || st, by: user.id, at: Date.now(), content: auditMsg[st] || '' });
    if (st === 'confirmed') i.auditorId = user.id;
    db.saveIssue(i);
    return sendJson(res, 200, { issue: i });
  },
  'DELETE/api/issues~(id)'(req, res, user, body, params) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const i = db.getIssue(params.id);
    if (!i) return sendErr(res, 404, '问题不存在');
    if (user.role === 'builder' && i.builderId !== user.id) {
      return sendErr(res, 403, '仅能删除自己提交的问题');
    }
    db.deleteIssue(params.id);
    return sendJson(res, 200, { ok: true });
  },

  /* ---- 规范 ---- */
  'GET/api/regulations'(req, res, user) {
    return sendJson(res, 200, { regulations: REGULATIONS });
  },

  /* ---- AI 助手聊天历史 ---- */
  'GET/api/chat/history'(req, res, user) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    return sendJson(res, 200, { history: db.getChatHistory() });
  },
  async 'POST/api/chat/history'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    db.pushChatMessage({ role: body.role, content: body.content, at: body.at || Date.now() });
    return sendJson(res, 201, { history: db.getChatHistory() });
  },
  'DELETE/api/chat/history'(req, res, user) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    db.clearChatHistory();
    return sendJson(res, 200, { ok: true });
  },

  /* ---- AI 配置（仅管理员） ---- */
  'GET/api/ai/config'(req, res, user) {
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    return sendJson(res, 200, db.publicAIConfig());
  },
  async 'PUT/api/ai/config'(req, res, user, body) {
    const err = requireAdmin(user); if (err) return sendErr(res, err.status, err.body.error);
    const cfg = {};
    if (body.baseUrl != null) cfg.baseUrl = String(body.baseUrl);
    if (body.model != null) cfg.model = String(body.model);
    if (body.thinking === 'enabled' || body.thinking === 'disabled') cfg.thinking = body.thinking;
    // 仅当传入了新的 apiKey 且非掩码时才覆盖；空字符串表示清空
    if (body.apiKey != null) {
      const current = db.getAIConfig();
      if (String(body.apiKey).trim() === '' || String(body.apiKey).startsWith('***')) {
        /* 保留原密钥（掩码返回的不覆盖） */
      } else {
        cfg.apiKey = String(body.apiKey);
      }
      if (String(body.apiKey) === 'CLEAR') cfg.apiKey = '';
    }
    db.setAIConfig(cfg);
    return sendJson(res, 200, db.publicAIConfig());
  },

  /* ---- AI 代理 ---- */
  async 'POST/api/ai/analyze'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const photos = Array.isArray(body.photos) ? body.photos : [];
    if (!photos.length) return sendErr(res, 400, '请至少上传一张图片');
    if (photos.length > 6) return sendErr(res, 400, '最多上传6张');
    const result = await ai.analyze(photos, String(body.note || ''));
    return sendJson(res, 200, result);
  },
  async 'POST/api/ai/search'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const results = await ai.searchWeb(String(body.query || ''));
    return sendJson(res, 200, { results, ok: results != null });
  },
  async 'POST/api/ai/chat'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const ctx = assistant.buildLedgerContext();
    const searchResults = body.searchResults || null;
    // 若前端已自带 system（含台账快照），则原样传递；否则由后端动态构建
    const alreadyHasSystem = messages[0] && messages[0].role === 'system';
    const full = alreadyHasSystem
      ? messages.slice(-25)
      : [{ role: 'system', content: assistant.systemPromptForAssistant(ctx, searchResults) }, ...messages.slice(-20)];
    try {
      const text = await ai.chat(full);
      return sendJson(res, 200, { text, fallback: false });
    } catch (e) {
      const q = (messages[messages.length - 1] || {}).content || '';
      const local = assistant.assistantLocalReply(q, ctx);
      return sendJson(res, 200, {
        text: local + '\n\n（注：AI 在线接口暂不可用，以上为本机台账统计生成的回答。可在「AI 接口」页配置在线接口。）',
        fallback: true, error: String((e && e.message) || e)
      });
    }
  },
  /* ---- 流式对话（SSE）。前端 ai.js 的 chatStream 读取 data: 行。 ---- */
  async 'POST/api/ai/chat/stream'(req, res, user, body) {
    const err = requireUser(user); if (err) return sendErr(res, err.status, err.body.error);
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const ctx = assistant.buildLedgerContext();
    const searchResults = body.searchResults || null;
    const alreadyHasSystem = messages[0] && messages[0].role === 'system';
    const full = alreadyHasSystem
      ? messages.slice(-25)
      : [{ role: 'system', content: assistant.systemPromptForAssistant(ctx, searchResults) }, ...messages.slice(-20)];

    /* 尝试打开上游流；失败 / 状态非 200 时降级为非流式并包装为一条 SSE。 */
    let upstream;
    try {
      upstream = await ai.chatStream(full);
    } catch (e) {
      return streamFallbackSSE(res, messages, ctx, searchResults);
    }
    if (upstream.status !== 200) {
      // 尝试读取错误响应体（小），判断是否因 thinking 参数不兼容
      const bodyText = await readStreamText(upstream);
      if ((upstream.status === 400 || upstream.status === 422) && THINKING_HINT.test(bodyText)) {
        // 去除 thinking 参数再试一次
        const retry = await ai.chat(full.map(m => m)); // chat 内部会去 thinking
        return streamTextSSE(res, retry.text || retry);
      }
      return streamFallbackSSE(res, messages, ctx, searchResults);
    }
    // 成功：转发上游 SSE 原始流（DeepSeek 返回 OpenAI 兼容 SSE）
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    upstream.pipe(res);
    upstream.on('error', () => res.end());
    return null;
  }
};

/* 读取流为纯文本 */
function readStreamText(stream) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on('data', c => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', () => resolve(''));
  });
}

/* 以一条 SSE 输出整段文本 */
function streamTextSSE(res, text) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  const chunks = String(text).match(/.{1,6}/gs) || [String(text)];
  let i = 0;
  const timer = setInterval(() => {
    if (i >= chunks.length) {
      clearInterval(timer);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] }) + '\n\n');
    i++;
  }, 10);
}

/* 流式端点降级：用非流式结果输出为一条 SSE（含 fallback 说明） */
function streamFallbackSSE(res, messages, ctx, searchResults) {
  const q = (messages[messages.length - 1] || {}).content || '';
  try {
    ai.chat([{ role: 'system', content: assistant.systemPromptForAssistant(ctx, searchResults) }, ...messages.slice(-20)])
      .then(text => streamTextSSE(res, text + '\n\n（注：AI 接口暂不可用，以上为本机台账统计生成的回答。）'))
      .catch(() => {
        const local = assistant.assistantLocalReply(q, ctx) + '\n\n（注：AI 在线接口暂不可用，以上为本机台账统计生成的回答。）';
        streamTextSSE(res, local);
      });
  } catch (e) {
    streamTextSSE(res, 'AI 服务暂不可用，请稍后再试。');
  }
  return null;
}

/* ---------------- 路由匹配 ---------------- */
function routeMatch(key) {
  // key 形如 'POST/api/issues~(id)/status'
  const m = key.match(/^(GET|POST|PUT|DELETE)(\/[^\s]*)$/);
  if (!m) return null;
  return { method: m[1], templ: m[2] };
}
function compileTemplate(templ) {
  // 模板中 ~(name) 表示一段路径参数（前面的 ~ 代表路径分隔符 /）
  const names = [];
  const src = templ.replace(/~\(([^)]+)\)/g, (g, name) => { names.push(name); return '/([^/]+)'; });
  return { re: new RegExp('^' + src + '$'), names };
}
const routeTable = Object.keys(API).map(k => {
  const r = routeMatch(k);
  if (!r) return null;
  return { method: r.method, templ: r.templ, compiled: compileTemplate(r.templ), handler: API[k], key: k };
}).filter(Boolean);

function matchRoute(pathname, method) {
  for (const r of routeTable) {
    if (r.method !== method) continue;
    const mm = pathname.match(r.compiled.re);
    if (mm) {
      const params = {};
      r.compiled.names.forEach((n, i) => params[n] = decodeURIComponent(mm[i + 1]));
      return { handler: r.handler, params, key: r.key };
    }
  }
  return null;
}

/* ---------------- HTTP 主服务 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = u.pathname;

  // CORS 宽松（便于前端跨端口联调）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  if (pathname.startsWith('/api/')) {
    try {
      const body = (req.method === 'POST' || req.method === 'PUT')
        ? await readBody(req).catch(e => ({ __error: e.message }))
        : null;
      if (body && body.__error) return sendErr(res, 400, body.__error);
      const user = authenticated(req);
      const route = matchRoute(pathname, req.method);
      if (!route) return sendErr(res, 404, '接口不存在: ' + req.method + ' ' + pathname);
      const result = await route.handler(req, res, user, body || {}, route.params);
      // handler 自行写响应时返回 null；否则返回 {status, body}
      if (result && typeof result === 'object' && !result._sent) {
        return sendJson(res, result.status || 200, result.body != null ? result.body : result);
      }
    } catch (e) {
      console.error('[api error]', req.method, pathname, e);
      if (!res.headersSent) sendErr(res, 500, '服务器内部错误：' + String((e && e.message) || e));
      else res.end();
    }
    return;
  }

  // 静态资源
  if (req.method === 'GET') {
    return serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
  }
  sendErr(res, 405, 'Method Not Allowed');
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

/* ---------------- 启动 ---------------- */
seed.seed();
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log('');
  console.log('====================================================');
  console.log(' 水利工程质量安全合规管理助手 · 后端已启动');
  console.log(' 访问地址:  http://127.0.0.1:' + PORT + '/');
  console.log(' 数据目录:  ' + path.join(__dirname, 'data'));
  console.log('====================================================');
});