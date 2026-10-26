/* ============================================================
 * 认证与权限
 * 使用 Node 内置 crypto 生成随机 token 作会话标识，
 * 前端在 localStorage 持久化该 token（对应原 wm_session 语义）。
 * ============================================================ */

const crypto = require('crypto');
const db = require('./db');

const ROLES = {
  admin:   { label: '管理员', badge: 'admin' },
  auditor: { label: '审核员', badge: 'confirmed' },
  builder: { label: '施工员', badge: 'pending' }
};

const STATUS_META = {
  pending:    { label: '待审核', cls: 'pending' },
  confirmed:  { label: '已确认', cls: 'confirmed' },
  rectifying: { label: '整改中', cls: 'rectifying' },
  rectified:  { label: '已整改', cls: 'rectified' },
  closed:     { label: '已销号', cls: 'closed' }
};

const RISK_META = {
  high:   { label: '高', cls: 'high' },
  medium: { label: '中', cls: 'medium' },
  low:    { label: '低', cls: 'low' }
};

function createToken() {
  return crypto.randomBytes(32).toString('hex');
}

/* 登录：成功返回 {token, user}；失败返回 null */
function login(username, password) {
  const user = db.findUserByLogin(username, password);
  if (!user) return null;
  const token = createToken();
  db.setSession(token, user.id);
  return { token, user: db.sanitizeUser(user) };
}

function logout(token) {
  db.setSession(token, null);
}

/* 依据 token 取当前已登录且仍存在的用户，失败返回 null */
function authUser(token) {
  if (!token) return null;
  const userId = db.getSessionByToken(token);
  if (!userId) return null;
  return db.findUserById(userId) || null;
}

/* 从请求头解析 Bearer token */
function parseToken(req) {
  const h = req.headers['authorization'] || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

module.exports = {
  ROLES, STATUS_META, RISK_META,
  login, logout, authUser, parseToken
};