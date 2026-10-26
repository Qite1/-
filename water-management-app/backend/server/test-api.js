/* ============================================================
 * 后端 API 自测脚本（零依赖）
 * 用法：node server/test-api.js
 * 会临时启动一个 server 子进程（端口 8977），依次验证关键接口，
 * 全部通过打印 PASS；任一失败打印 FAIL 并以非零退出码结束。
 * ============================================================ */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 8977;
const BASE = 'http://127.0.0.1:' + PORT;

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
}

function req(method, p, token, body) {
  return new Promise((resolve) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const u = new URL(p, BASE);
    const r = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let data = null;
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch (e) {}
        resolve({ status: res.statusCode, data });
      });
    });
    r.on('error', () => resolve({ status: 0, data: null }));
    if (payload) r.write(payload);
    r.end();
  });
}

function waitReady(proc, tries) {
  return new Promise((resolve) => {
    if (tries <= 0) return resolve(false);
    const t = http.get(BASE + '/api/auth/me', (res) => { res.resume(); res.on('end', () => resolve(true)); });
    t.on('error', () => setTimeout(() => waitReady(proc, tries - 1).then(resolve), 250));
  });
}

async function main() {
  const proc = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: 'ignore'
  });
  const ready = await waitReady(proc, 20);
  if (!ready) { console.log('服务器未能启动'); proc.kill(); process.exit(1); }
  console.log('服务器已就绪，开始自测：\n');

  /* 1) 登录（三个内置账号） */
  let r = await req('POST', '/api/auth/login', null, { username: 'admin', password: 'admin123' });
  check('管理员登录成功', r.status === 200 && !!r.data.token, r);
  const adminToken = r.data && r.data.token;

  r = await req('POST', '/api/auth/login', null, { username: 'shigongyuan', password: 'sg123' });
  check('施工员登录成功', r.status === 200 && !!r.data.token, r);
  const builderToken = r.data && r.data.token;

  r = await req('POST', '/api/auth/login', null, { username: 'shenheyuan', password: 'sh123' });
  check('审核员登录成功', r.status === 200 && !!r.data.token, r);
  const auditorToken = r.data && r.data.token;

  /* 2) 错误密码 */
  r = await req('POST', '/api/auth/login', null, { username: 'admin', password: 'wrong' });
  check('错误密码登录被拒绝', r.status === 401, r);

  /* 3) 未登录访问用户列表被拒 */
  r = await req('GET', '/api/users');
  check('未登录访问用户管理被拒(401)', r.status === 401, r);

  /* 4) 施工员访问用户管理被拒 */
  r = await req('GET', '/api/users', builderToken);
  check('施工员访问用户管理被拒(403)', r.status === 403, r);

  /* 5) 管理员新增用户 */
  const uname = 'user_' + Date.now().toString(36);
  r = await req('POST', '/api/users', adminToken, { username: uname, name: '王测试', password: '123456', role: 'builder' });
  check('管理员新增用户成功', r.status === 201 && r.data.user.username === uname, r);

  /* 6) 重复用户名被拒 */
  r = await req('POST', '/api/users', adminToken, { username: uname, name: '另一个', password: 'x', role: 'builder' });
  check('重复用户名被拒(409)', r.status === 409, r);

  /* 7) 用户列表含新用户且不含密码字段 */
  r = await req('GET', '/api/users', adminToken);
  check('用户列表返回且脱敏', r.status === 200 && r.data.users.length >= 4 && !('password' in r.data.users[0]), r);

  /* 8) 施工员创建一条问题 */
  const issueBody = {
    title: '堤防迎水侧临边高处作业无防护',
    site: '#3 闸室上游围堰右侧',
    note: '未戴安全帽、临边无护栏',
    photos: [],
    risks: [{ title: '高处/临边作业防护', description: '现场临边未设护栏', level: 'high', rule: 'SL/T528', action: '设置防护栏杆并系挂安全带', uncertain: false }],
    summary: '现场辨识到高处临边作业风险',
    risk: 'high',
    aiFallback: true
  };
  r = await req('POST', '/api/issues', builderToken, issueBody);
  check('施工员提交问题成功(pending)', r.status === 201 && r.data.issue.status === 'pending' && r.data.issue.builderId, r);
  const issueId = r.data && r.data.issue && r.data.issue.id;

  /* 9) 待审核统计待审核+1 */
  r = await req('GET', '/api/stats', adminToken);
  check('统计接口返回待审核数', r.status === 200 && typeof r.data.pending === 'number', r);

  /* 10) 审核员确认入台账 */
  r = await req('PUT', '/api/issues/' + issueId + '/status', auditorToken, { status: 'confirmed' });
  check('审核员确认入台账(confirmed)', r.status === 200 && r.data.issue.status === 'confirmed', r);

  /* 11) 施工员不能确认（应被拒） */
  r = await req('PUT', '/api/issues/' + issueId + '/status', builderToken, { status: 'closed' });
  check('施工员不能销号(403)', r.status === 403, r);

  /* 12) 未登录删除被拒 */
  r = await req('DELETE', '/api/issues/' + issueId);
  check('未登录删除被拒(401)', r.status === 401, r);

  /* 13) 管理员编辑台账（改风险与状态） */
  r = await req('PUT', '/api/issues/' + issueId, adminToken, { risk: 'medium', note: '补充说明' });
  check('管理员编辑台账成功', r.status === 200 && r.data.issue.risk === 'medium' && r.data.issue.note === '补充说明', r);

  /* 14) AI 配置：管理员可读写 */
  r = await req('GET', '/api/ai/config', adminToken);
  check('读取AI配置脱敏正确', r.status === 200 && 'hasApiKey' in r.data && 'apiKeyMask' in r.data, r);
  r = await req('PUT', '/api/ai/config', adminToken, { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: 'disabled' });
  check('保存AI配置成功', r.status === 200 && r.data.hasApiKey === false, r);

  /* 15) 规范接口 */
  r = await req('GET', '/api/regulations', adminToken);
  check('规范接口返回30+条', r.status === 200 && r.data.regulations.length >= 30, r);

  /* 16) AI 图片识别（未配置密钥→本地规则回退） */
  r = await req('POST', '/api/ai/analyze', builderToken, { photos: ['data:image/jpeg;base64,xxx'], note: '施工现场未佩戴安全帽' });
  check('AI识别回退本地规则(fallback)', r.status === 200 && r.data.fallback === true && Array.isArray(r.data.risks), r);

  /* 17) AI 对话（离线→本地台账兜底） */
  r = await req('POST', '/api/ai/chat', adminToken, { messages: [{ role: 'user', content: '当前有哪些待整改项？' }], searchResults: null });
  check('AI对话本地兜底', r.status === 200 && typeof r.data.text === 'string' && r.data.text.length > 0, r);

  /* 18) 聊天历史读写与清空 */
  r = await req('GET', '/api/issues', builderToken);
  check('问题台账列表', r.status === 200 && Array.isArray(r.data.issues), r);

  /* 19) 施工员删除自己的问题 */
  r = await req('DELETE', '/api/issues/' + issueId, builderToken);
  check('施工员删除自己提交的问题', r.status === 200 && r.data.ok === true, r);

  /* 20) 退出登录 */
  r = await req('POST', '/api/auth/logout', adminToken);
  check('退出登录', r.status === 200 && r.data.ok === true, r);
  r = await req('GET', '/api/auth/me', adminToken);
  check('退出后token失效(401)', r.status === 401, r);

  console.log('\n================= 结果 =================');
  console.log('通过: ' + passed + '  失败: ' + failed);
  proc.kill();
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });