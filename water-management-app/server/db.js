'use strict';
// 简易 JSON 文件数据库：用户、审核单、台账
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB = {
  users: [],       // {id, username, passwordHash, name, role, project, createdAt, updatedAt}
  inspections: [], // 审核单，每个 = 一次上传的多照片
  ledgers: [],     // 台账条目，审核员确认后生成
};

let db = null;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(String(pw)).digest('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  if (db) return db;
  if (!fs.existsSync(DB_FILE)) {
    db = { ...EMPTY_DB, users: [] };
    seedUsers();
    db.inspections = [];
    db.ledgers = [];
    save();
  } else {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      db = { ...EMPTY_DB, users: [] };
    }
  }
  return db;
}

function save() {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}

function seedUsers() {
  // 初始账号：管理员 / 审核员 / 施工员
  db.users.push(makeUser('admin', 'admin123', '系统管理员', 'admin', '示例枢纽工程'));
  db.users.push(makeUser('reviewer', 'review123', '张审核', 'reviewer', '示例枢纽工程'));
  db.users.push(makeUser('worker', 'worker123', '李施工', 'worker', '示例枢纽工程'));
}

function makeUser(username, password, name, role, project) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    username,
    passwordHash: hashPassword(password),
    name,
    role,            // 'admin' 'reviewer' 'worker'
    project,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- 用户 ----------
function findUserByUsername(username) {
  load();
  return db.users.find((u) => u.username === username);
}

function findUserById(id) {
  load();
  return db.users.find((u) => u.id === id);
}

function listUsers() {
  load();
  return db.users.map(publicUser);
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    project: u.project,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function createUser({ username, password, name, role, project }) {
  load();
  if (findUserByUsername(username)) {
    const e = new Error('用户名已存在');
    e.code = 'USER_EXISTS';
    throw e;
  }
  const u = makeUser(username, password, name, role, project);
  db.users.push(u);
  save();
  return publicUser(u);
}

function updateUserRole(id, role, project) {
  load();
  const u = findUserById(id);
  if (!u) return null;
  u.role = role;
  if (project) u.project = project;
  u.updatedAt = new Date().toISOString();
  save();
  return publicUser(u);
}

function deleteUser(id) {
  load();
  const idx = db.users.findIndex((u) => u.id === id);
  if (idx < 0) return false;
  db.users.splice(idx, 1);
  save();
  return true;
}

function verifyLogin(username, password) {
  const u = findUserByUsername(username);
  if (!u) return null;
  if (u.passwordHash !== hashPassword(password)) return null;
  return u;
}

// ---------- 审核单 ----------
function addInspection(ins) {
  load();
  ins.id = ins.id || crypto.randomUUID();
  ins.createdAt = ins.createdAt || new Date().toISOString();
  db.inspections.unshift(ins);
  save();
  return ins;
}

function listInspections(filter = {}) {
  load();
  let arr = db.inspections.slice();
  if (filter.status) arr = arr.filter((i) => i.status === filter.status);
  if (filter.uploaderId) arr = arr.filter((i) => i.uploaderId === filter.uploaderId);
  if (filter.reviewerId) arr = arr.filter((i) => i.reviewerId === filter.reviewerId);
  return arr;
}

function getInspection(id) {
  load();
  return db.inspections.find((i) => i.id === id) || null;
}

function updateInspection(id, patch) {
  load();
  const ins = getInspection(id);
  if (!ins) return null;
  Object.assign(ins, patch);
  ins.updatedAt = new Date().toISOString();
  save();
  return ins;
}

// ---------- 台账 ----------
function addLedger(ledger) {
  load();
  ledger.id = ledger.id || crypto.randomUUID();
  ledger.createdAt = ledger.createdAt || new Date().toISOString();
  db.ledgers.unshift(ledger);
  save();
  return ledger;
}

function listLedgers(filter = {}) {
  load();
  let arr = db.ledgers.slice();
  if (filter.workerId) arr = arr.filter((l) => l.workerId === filter.workerId);
  return arr;
}

function getLedger(id) {
  load();
  return db.ledgers.find((l) => l.id === id) || null;
}

function updateLedger(id, patch) {
  load();
  const l = getLedger(id);
  if (!l) return null;
  Object.assign(l, patch);
  l.updatedAt = new Date().toISOString();
  save();
  return l;
}

function deleteLedger(id) {
  load();
  const idx = db.ledgers.findIndex((l) => l.id === id);
  if (idx < 0) return false;
  db.ledgers.splice(idx, 1);
  save();
  return true;
}

module.exports = {
  load,
  save,
  verifyLogin,
  findUserById,
  findUserByUsername,
  listUsers,
  createUser,
  updateUserRole,
  deleteUser,
  addInspection,
  listInspections,
  getInspection,
  updateInspection,
  addLedger,
  listLedgers,
  getLedger,
  updateLedger,
  deleteLedger,
  hashPassword,
};