/* ============================================================
 * 内置演示数据种子
 * 首次启动时如无用户，则写入与前端一致的演示账号。
 * ============================================================ */

const db = require('./db');

function seed() {
  const users = db.listUsers();
  if (users.length) return { seeded: false, count: users.length };

  const now = Date.now();
  db.saveUser({ id: db.uid('u'), username: 'admin', password: 'admin123', name: '系统管理员', role: 'admin', phone: '', createdAt: now });
  db.saveUser({ id: db.uid('u'), username: 'shenheyuan', password: 'sh123', name: '张审核员', role: 'auditor', phone: '', createdAt: now });
  db.saveUser({ id: db.uid('u'), username: 'shigongyuan', password: 'sg123', name: '李施工员', role: 'builder', phone: '13800000000', createdAt: now });

  return { seeded: true, count: db.listUsers().length };
}

module.exports = { seed };