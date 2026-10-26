/* ============ 数据层：localStorage 持久化 ============
 * 纯前端自包含版本，可在 GitHub Pages 等静态站点直接运行。
 * 数据保存在浏览器本地（localStorage），包含演示账号种子。
 * 同时兼容 app.js 调用的 init/login/logout/transitionIssue 接口。 */

const Store = (() => {
  const USERS_KEY = 'wm_users';
  const ISSUES_KEY = 'wm_issues';
  const AI_KEY = 'wm_ai_config';
  const SESSION_KEY = 'wm_session';
  const CHAT_KEY = 'wm_chat_history';
  const CHAT_MAX = 60;

  const uid = () => 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  const hasLS = () => (typeof localStorage !== 'undefined');
  const read = (key, fallback) => {
    try { const v = hasLS() ? localStorage.getItem(key) : null; return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  };
  const write = (key, val) => { if (hasLS()) localStorage.setItem(key, JSON.stringify(val)); };

  // ------- 用户 -------
  function seedUsers() {
    const list = read(USERS_KEY, []);
    if (list.length) return;
    list.push(
      { id: uid(), username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin', phone: '', createdAt: Date.now() },
      { id: uid(), username: 'shenheyuan', password: 'sh123', name: '张审核员', role: 'auditor', phone: '', createdAt: Date.now() },
      { id: uid(), username: 'shigongyuan', password: 'sg123', name: '李施工员', role: 'builder', phone: '13800000000', createdAt: Date.now() }
    );
    write(USERS_KEY, list);
  }

  const getUserByLogin = (username, password) =>
    read(USERS_KEY, []).find(u => u.username === String(username || '').trim() && u.password === String(password || ''));

  const listUsers = () => read(USERS_KEY, []);

  function saveUser(user) {
    const list = read(USERS_KEY, []);
    const i = list.findIndex(u => u.id === user.id);
    if (i >= 0) list[i] = user; else list.push(user);
    write(USERS_KEY, list);
    return user;
  }

  const createUser = (user) => { user.id = uid(); user.createdAt = Date.now(); saveUser(user); return user; };
  const deleteUser = (id) => write(USERS_KEY, read(USERS_KEY, []).filter(u => u.id !== id));
  const findByUsername = (username) => read(USERS_KEY, []).find(u => u.username === String(username || '').trim());
  const findUserById = (id) => read(USERS_KEY, []).find(u => u.id === id) || null;

  // ------- 问题台账 -------
  const listIssues = () => read(ISSUES_KEY, []);

  function saveIssue(issue) {
    if (!issue.updatedAt) issue.updatedAt = Date.now();
    const list = read(ISSUES_KEY, []);
    const i = list.findIndex(x => x.id === issue.id);
    if (i >= 0) list[i] = issue; else list.push(issue);
    write(ISSUES_KEY, list);
    return issue;
  }
  const getIssue = (id) => read(ISSUES_KEY, []).find(x => x.id === id);
  const deleteIssue = (id) => write(ISSUES_KEY, read(ISSUES_KEY, []).filter(x => x.id !== id));

  /* 状态流转（审核确认 / 开始整改 / 标记整改 / 销号）：本地推进并记录审计 history */
  const AUDIT_MSG = {
    confirmed: '审核员确认问题属实，纳入整改台账',
    rectifying: '已下达整改任务，进入整改中',
    rectified: '施工单位报告已完成整改',
    closed: '现场复核通过，完成销号'
  };
  const AUDIT_TITLE = {
    confirmed: '审核确认',
    rectifying: '开始整改',
    rectified: '已整改',
    closed: '销号'
  };
  function transitionIssue(id, status) {
    const i = getIssue(id);
    if (!i) return;
    const me = getSession();
    i.status = status;
    i.updatedAt = Date.now();
    if (status === 'rectified') i.rectifiedAt = Date.now();
    if (status === 'confirmed') i.auditorId = me ? me.id : i.auditorId;
    i.history = i.history || [];
    i.history.push({ t: AUDIT_TITLE[status] || status, by: me ? me.id : '', at: Date.now(), content: AUDIT_MSG[status] || '' });
    saveIssue(i);
  }

  // ------- AI 配置（默认接入 DeepSeek 多模态，密钥由管理员在「AI 接口」页面填写） -------
  const getAIConfig = () => read(AI_KEY, { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '', thinking: 'disabled' });
  const setAIConfig = (cfg) => { write(AI_KEY, cfg); return cfg; };

  // ------- AI 助手聊天历史 -------
  const getChatHistory = () => read(CHAT_KEY, []);
  function pushChatMessage(msg) {
    const list = read(CHAT_KEY, []);
    list.push({ role: msg.role, content: String(msg.content || ''), at: msg.at || Date.now() });
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
    write(CHAT_KEY, list);
    return list;
  }
  const clearChatHistory = () => { if (hasLS()) localStorage.removeItem(CHAT_KEY); };

  // ------- 会话 -------
  const getSession = () => read(SESSION_KEY, null);
  const setSession = (s) => s ? write(SESSION_KEY, s) : (hasLS() && localStorage.removeItem(SESSION_KEY));

  /* ------- 兼容 app.js 的异步初始化与登录（同步实现，返回 Promise） ------- */
  function init() { seedUsers(); return Promise.resolve(getSession() || null); }
  function login(username, password) {
    return new Promise((resolve, reject) => {
      seedUsers();
      const user = getUserByLogin(username, password);
      if (!user) return reject(new Error('账号或密码错误'));
      setSession({ id: user.id });
      resolve(user);
    });
  }
  function logout() { setSession(null); return Promise.resolve(); }

  return {
    uid, init, login, logout,
    getUserByLogin, listUsers, saveUser, createUser, deleteUser, findByUsername, findUserById,
    listIssues, saveIssue, getIssue, deleteIssue, transitionIssue,
    getAIConfig, setAIConfig, getSession, setSession,
    getChatHistory, pushChatMessage, clearChatHistory,
    seedUsers
  };
})();

/* 角色元信息 */
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