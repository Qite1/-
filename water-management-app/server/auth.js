'use strict';
// 简易令牌鉴权（HMAC 签名，无外部依赖）
const crypto = require('crypto');
const SECRET = crypto.createHash('sha256').update('water-project-safety-secret-key').digest('hex');

const TOKEN_TTL = 8; // 小时

module.exports = {
  sign(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
  },
  verify(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (sig !== expect) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (Date.now() > payload.exp) return null;
      return payload;
    } catch (e) {
      return null;
    }
  },
  issue(user) {
    return this.sign({
      uid: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      exp: Date.now() + TOKEN_TTL * 3600 * 1000,
    });
  },
};