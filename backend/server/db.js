/* ============================================================
 * 数据存储层（JSON 文件持久化）
 *
 * 后端把本系统全部数据持久化到 server/data/*.json。
 * 数据结构与前端原 localStorage 完全一致：
 *   - users:        用户列表
 *   - issues:       问题/整改台账
 *   - aiConfig:     管理员配置的 AI 接口参数
 *   - chatHistory:  AI 助手对话历史（按最近使用全局存储，兼容前端语义）
 *   - session:      会话映射（token -> userId）
 * 写入采用"读-改-写"并约定写后落盘，适合作业级小规模应用。
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  users: 'users.json',
  issues: 'issues.json',
  aiConfig: 'ai-config.json',
  chatHistory: 'chat-history.json',
  session: 'session.json'
};

/* 确保数据目录存在 */
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(key) {
  return path.join(DATA_DIR, FILES[key]);
}

/* 读取 JSON，文件不存在返回 fallback */
function read(key, fallback) {
  ensureDir();
  const fp = filePath(key);
  try {
    if (!fs.existsSync(fp)) return fallback;
    const raw = fs.readFileSync(fp, 'utf-8');
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function write(key, val) {
  ensureDir();
  fs.writeFileSync(filePath(key), JSON.stringify(val, null, 2), 'utf-8');
}

/* ---------------- 通用 ID ---------------- */
function uid(prefix) {
  const n = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  return (prefix ? prefix + '_' : 'id_') + n;
}

/* ---------------- 用户 ---------------- */
function listUsers() {
  return read('users', []);
}
function findUserByLogin(username, password) {
  return listUsers().find(u => u.username === String(username || '').trim() && u.password === password);
}
function findUserById(id) {
  return listUsers().find(u => u.id === id) || null;
}
function findUserByUsername(username) {
  return listUsers().find(u => u.username === String(username || '').trim()) || null;
}
function saveUser(user) {
  const list = listUsers();
  const i = list.findIndex(u => u.id === user.id);
  if (i >= 0) list[i] = user; else list.push(user);
  write('users', list);
  return user;
}
function deleteUser(id) {
  write('users', listUsers().filter(u => u.id !== id));
}

/* 去掉敏感字段的对外视图 */
function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

/* ---------------- 问题台账 ---------------- */
function listIssues() {
  return read('issues', []);
}
function getIssue(id) {
  return listIssues().find(x => x.id === id) || null;
}
function saveIssue(issue) {
  if (!issue.updatedAt) issue.updatedAt = Date.now();
  const list = listIssues();
  const i = list.findIndex(x => x.id === issue.id);
  if (i >= 0) list[i] = issue; else list.push(issue);
  write('issues', list);
  return issue;
}
function deleteIssue(id) {
  write('issues', listIssues().filter(x => x.id !== id));
}

/* ---------------- AI 配置 ---------------- */
const DEFAULT_AI_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: '',
  thinking: 'disabled'
};
function getAIConfig() {
  return Object.assign({}, DEFAULT_AI_CONFIG, read('aiConfig', {}));
}
function setAIConfig(cfg) {
  write('aiConfig', Object.assign({}, getAIConfig(), cfg));
  return getAIConfig();
}
/* AI 配置对外不泄露完整密钥，只给掩码用于界面展示 */
function publicAIConfig() {
  const c = getAIConfig();
  return {
    baseUrl: c.baseUrl,
    model: c.model,
    thinking: c.thinking,
    hasApiKey: !!c.apiKey,
    apiKeyMask: c.apiKey ? maskKey(c.apiKey) : ''
  };
}
function maskKey(k) {
  const s = String(k);
  if (s.length <= 4) return '****';
  return s.slice(0, 3) + '****' + s.slice(-4);
}

/* ---------------- AI 助手聊天历史 ---------------- */
const CHAT_MAX = 60;
function getChatHistory() {
  return read('chatHistory', []);
}
function pushChatMessage(msg) {
  const list = getChatHistory();
  list.push({ role: msg.role, content: String(msg.content || ''), at: msg.at || Date.now() });
  if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  write('chatHistory', list);
  return list;
}
function clearChatHistory() {
  write('chatHistory', []);
}

/* ---------------- 会话（token -> userId）---------------- */
/* token 由 auth.js 生成，这里只负责持久化映射，重启不丢登录态 */
function getSessionByToken(token) {
  return read('session', {})[token] || null;
}
function setSession(token, userId) {
  const m = read('session', {});
  if (userId == null) delete m[token]; else m[token] = userId;
  write('session', m);
}

/* ---------------- 待审核统计辅助（供首页/AI 上下文复用）---------------- */
function stats() {
  const issues = listIssues();
  return {
    total: issues.length,
    pending: issues.filter(i => i.status === 'pending').length,
    confirmed: issues.filter(i => i.status === 'confirmed' || i.status === 'rectifying').length,
    rectified: issues.filter(i => i.status === 'rectified' || i.status === 'closed').length,
    high: issues.filter(i => i.risk === 'high').length
  };
}

module.exports = {
  uid,
  listUsers, findUserByLogin, findUserById, findUserByUsername, saveUser, deleteUser, sanitizeUser,
  listIssues, getIssue, saveIssue, deleteIssue,
  getAIConfig, setAIConfig, publicAIConfig, DEFAULT_AI_CONFIG,
  getChatHistory, pushChatMessage, clearChatHistory, CHAT_MAX,
  getSessionByToken, setSession,
  stats
};