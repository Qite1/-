/* ============================================================
 * 数据层：后端 REST API 桥接（替代原 localStorage）
 *
 * 本文件为前端提供与旧版一致的同步 Store 接口，但底层改为调用后端
 * server/server.js 提供的 /api/* REST 接口：
 *   - init()            初始化：恢复会话 + 从服务端拉取全量数据到内存缓存
 *   - login/logout      登录 / 退出
 *   - users/issues      用户 / 问题台账增删改查
 *   - aiConfig          AI 接口参数读写
 *   - chatHistory       AI 助手对话历史
 *
 * 策略：内存缓存保证渲染同步顺畅；所有写操作在更新缓存的同时异步持久化
 * 到后端。后端不可达时登录/初始化会给出明确提示，仍可离线部分使用。
 * ============================================================ */

/* 后端 API 基址：默认同源 /api；如需跨源可在 window.WM_API_BASE 指定 */
const WM_API_BASE = (typeof window !== 'undefined' && window.WM_API_BASE)
  ? window.WM_API_BASE.replace(/\/+$/, '')
  : '/api';

/* 会话 token 持久化键（原 localStorage wm_session 语义） */
const WM_TOKEN_KEY = 'wm_session_token';

const Store = (() => {
  /* ---------------- 内存缓存 ---------------- */
  const cache = {
    users: [],
    issues: [],
    chatHistory: [],
    aiConfig: null,     // {baseUrl,model,apiKey,thinking} 仅本地需用的参数
    token: null,
    currentUser: null,
    online: true
  };

  const uid = () => 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  const hasLS = () => (typeof localStorage !== 'undefined');

  /* 读取本地持久化的 token */
  function loadToken() {
    try {
      const t = hasLS() ? localStorage.getItem(WM_TOKEN_KEY) : null;
      cache.token = t || null;
    } catch (e) { cache.token = null; }
    return cache.token;
  }
  function saveToken(t) {
    cache.token = t || null;
    try {
      if (hasLS()) {
        if (t) localStorage.setItem(WM_TOKEN_KEY, t); else localStorage.removeItem(WM_TOKEN_KEY);
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------------- 底层请求 ---------------- */
  async function request(path, method, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (cache.token) headers['Authorization'] = 'Bearer ' + cache.token;
    let resp;
    try {
      resp = await fetch(WM_API_BASE + path, {
        method: method || 'GET',
        headers,
        body: body != null ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      cache.online = false;
      const err = new Error('无法连接后端服务，请先启动 node backend/server/server.js。若以 file:// 打开，请改用 http:// 访问。');
      err.notOnline = true;
      throw err;
    }
    if (resp.status === 204) return null;
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || ('请求失败 ' + resp.status));
      err.status = resp.status;
      err.notOnline = false;
      throw err;
    }
    cache.online = true;
    return data;
  }

  /* ---------------- 初始化 ---------------- */
  async function init() {
    loadToken();
    // 1) 用 token 恢复当前用户（无效则清 token）
    if (cache.token) {
      try {
        const me = await request('/auth/me');
        cache.currentUser = (me && me.user) || null;
      } catch (e) {
        if (e.notOnline) { cache.online = false; throw e; }
        saveToken(null);
        cache.currentUser = null;
      }
    }
    // 2) 拉取全量数据（仅登录后）
    if (cache.currentUser) {
      try {
        const [u, i, c, h] = await Promise.all([
          request('/users'),
          request('/issues'),
          request('/ai/config'),
          request('/chat/history')
        ]);
        cache.users = (u && u.users) || [];
        cache.issues = (i && i.issues) || [];
        cache.chatHistory = (h && h.history) || [];
        cache.aiConfig = c ? { baseUrl: c.baseUrl, model: c.model, apiKey: '', thinking: c.thinking } : null;
      } catch (e) {
        if (e.notOnline) { cache.online = false; throw e; }
        cache.users = cache.users || [];
        cache.issues = cache.issues || [];
      }
    }
    return cache.currentUser;
  }

  /* ---------------- 认证 ---------------- */
  async function login(username, password) {
    const r = await request('/auth/login', 'POST', { username, password });
    cache.token = r.token;
    saveToken(r.token);
    cache.currentUser = r.user;
    // 登录后拉取全量数据
    await init();
    return r.user;
  }
  async function logout() {
    try { await request('/auth/logout', 'POST'); } catch (e) { /* ignore */ }
    saveToken(null);
    cache.currentUser = null;
    cache.users = [];
    cache.issues = [];
    cache.chatHistory = [];
  }
  function getSession() { return cache.token; }
  function setSession(token) { if (token) saveToken(token); else logout(); }

  /* ---------------- 用户（同步缓存 + 异步持久化） ---------------- */
  function listUsers() { return cache.users; }
  function getUserByLogin(username, password) {
    return cache.users.find(u => u.username === String(username || '').trim() && u.password === password) || null;
  }
  function findUserById(id) { return cache.users.find(u => u.id === id) || null; }
  function findByUsername(username) {
    return cache.users.find(u => u.username === String(username || '').trim()) || null;
  }
  function saveUser(user) {
    const i = cache.users.findIndex(u => u.id === user.id);
    if (i >= 0) cache.users[i] = user; else cache.users.push(user);
    persistUser(user);
    return user;
  }
  function createUser(user) {
    if (!user.id) user.id = uid();
    if (!user.createdAt) user.createdAt = Date.now();
    cache.users.push(user);
    request('/users', 'POST', user).catch(() => {});
    return user;
  }
  function deleteUser(id) {
    cache.users = cache.users.filter(u => u.id !== id);
    request('/users/' + encodeURIComponent(id), 'DELETE').catch(() => {});
  }
  function persistUser(user) {
    if (!user.id) return;
    const payload = { username: user.username, name: user.name, password: user.password, role: user.role, phone: user.phone };
    request('/users', 'PUT', Object.assign({ id: user.id }, payload)).catch(() => {});
  }

  /* ---------------- 问题台账 ---------------- */
  function listIssues() { return cache.issues; }
  function getIssue(id) { return cache.issues.find(i => i.id === id) || null; }
  function saveIssue(issue) {
    if (!issue.updatedAt) issue.updatedAt = Date.now();
    const i = cache.issues.findIndex(x => x.id === issue.id);
    const existed = i >= 0;
    if (existed) cache.issues[i] = issue; else cache.issues.push(issue);
    if (existed) {
      // 更新已有台账
      const payload = {
        title: issue.title, site: issue.site, note: issue.note,
        risk: issue.risk, status: issue.status,
        risks: issue.risks, summary: issue.summary, photos: issue.photos,
        history: issue.history
      };
      request('/issues/' + encodeURIComponent(issue.id), 'PUT', payload).catch(() => {});
    } else {
      // 新建问题
      request('/issues', 'POST', issue).catch(() => {});
    }
    return issue;
  }
  function deleteIssue(id) {
    cache.issues = cache.issues.filter(x => x.id !== id);
    request('/issues/' + encodeURIComponent(id), 'DELETE').catch(() => {});
  }
  /* 状态流转（确认/开始整改/标记整改/销号）：
     在缓存中同步推进（审核确认、标记整改等需记录操作人与时间），并异步调用后端 */
  function transitionIssue(id, status) {
    const i = getIssue(id);
    if (!i) return;
    i.status = status;
    i.updatedAt = Date.now();
    if (status === 'rectified') i.rectifiedAt = Date.now();
    if (status === 'confirmed') i.auditorId = cache.currentUser ? cache.currentUser.id : i.auditorId;
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
    i.history.push({ t: auditTitle[status] || status, by: cache.currentUser ? cache.currentUser.id : '', at: Date.now(), content: auditMsg[status] || '' });
    request('/issues/' + encodeURIComponent(id) + '/status', 'PUT', { status }).catch(() => {});
  }

  /* ---------------- AI 配置 ---------------- */
  function getAIConfig() {
    return cache.aiConfig || { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '', thinking: 'disabled' };
  }
  function setAIConfig(cfg) {
    cache.aiConfig = Object.assign({}, cache.aiConfig || {}, cfg);
    request('/ai/config', 'PUT', cfg).catch(() => {});
    return cache.aiConfig;
  }

  /* ---------------- AI 助手聊天历史 ---------------- */
  const CHAT_MAX = 60;
  function getChatHistory() { return cache.chatHistory; }
  function pushChatMessage(msg) {
    cache.chatHistory.push({ role: msg.role, content: String(msg.content || ''), at: msg.at || Date.now() });
    if (cache.chatHistory.length > CHAT_MAX) cache.chatHistory.splice(0, cache.chatHistory.length - CHAT_MAX);
    request('/chat/history', 'POST', { role: msg.role, content: String(msg.content || ''), at: msg.at || Date.now() }).catch(() => {});
    return cache.chatHistory;
  }
  function clearChatHistory() {
    cache.chatHistory = [];
    request('/chat/history', 'DELETE').catch(() => {});
  }

  return {
    uid,
    init, login, logout,
    getSession, setSession,
    getUserByLogin, listUsers, saveUser, createUser, deleteUser, findByUsername, findUserById,
    listIssues, saveIssue, getIssue, deleteIssue, transitionIssue,
    getAIConfig, setAIConfig,
    getChatHistory, pushChatMessage, clearChatHistory,
    get currentUser() { return cache.currentUser; }
  };
})();

/* 角色元信息（与原版一致） */
const ROLES = {
  admin:   { label: '管理员', badge: 'admin' },
  auditor: { label: '审核员', badge: 'confirmed' },
  builder: { label: '施工员', badge: 'pending' }
};
const RISK_META = {
  high:   { label: '高', cls: 'high' },
  medium: { label: '中', cls: 'medium' },
  low:    { label: '低', cls: 'low' }
};
const STATUS_META = {
  pending:    { label: '待审核', cls: 'pending' },
  confirmed:  { label: '已确认', cls: 'confirmed' },
  rectifying: { label: '整改中', cls: 'rectifying' },
  rectified:  { label: '已整改', cls: 'rectified' },
  closed:     { label: '已销号', cls: 'closed' }
};

/* node 环境下导出（浏览器加载时 module 未定义，不受影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Store;
}