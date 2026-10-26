/* ============================================================
 * AI 接口层（后端代理）
 *
 * 前端不再直接携带 API Key 调 DeepSeek，而是经由后端：
 *   POST /api/ai/analyze      —— 照片隐患识别
 *   POST /api/ai/chat         —— 非流式对话
 *   POST /api/ai/chat/stream  —— 流式对话（SSE）
 *   POST /api/ai/search       —— 联网检索（DeepSeek Search API）
 *
 * 调用失败 / 未配置时回退到本地规则识别（同前端语义），保证离线可用。
 * 使用 Node 内置 https/http 模块，零第三方依赖。
 * ============================================================ */

const http = require('http');
const https = require('https');
const db = require('./db');

/* 本地规则关键词回退（同前端 ai.js） */
const KEYWORDS = [
  { kw: ['安全帽', '头盔'], title: '个人防护装备——未佩戴安全帽', rule: '《水利安全生产标准化通用规范》SL/T528', action: '立即要求作业人员佩戴合格安全帽，并加强入场安全交底与日常检查记录。' },
  { kw: ['安全带', '临边', '护栏', '围栏'], title: '高处/临边作业防护', rule: '《水利水电工程施工安全管理导则》及高处作业有关规定', action: '临边高处作业需设置牢固防护栏杆、安全网并正确系挂安全带，完善警示标识。' },
  { kw: ['基坑', '支护', '挡土'], title: '基坑/沟槽开挖支护', rule: '《水利水电工程基坑施工安全技术规范》', action: '基坑开挖应按规定放坡或设置支护体系，设置上下通道，并做好排水与位移监测。' },
  { kw: ['电线', '电缆', '电箱', '配电'], title: '临时用电安全隐患', rule: '《施工现场临时用电安全技术规范》JGJ46', action: '规范三级配电两级保护，杜绝私拉乱接，线缆架空或穿管敷设并设漏电保护装置。' },
  { kw: ['脚手架', '支架', '排架'], title: '脚手架/模板支架搭设', rule: '《水利水电工程施工安全技术规范》相关规定', action: '支架须按方案搭设并验收合格后使用，设置连墙、剪刀撑，严禁超载堆放。' },
  { kw: ['盾构', '隧洞', '渗漏', '裂缝'], title: '水工结构/衬砌质量隐患', rule: '《水工混凝土施工规范》SL677及质量验收规程', action: '对裂缝、渗漏部位查明原因，按方案采取灌浆/封堵处理，并加强质量验收与观测。' },
  { kw: ['围堰', '水下滑坡', '洪水', '水位'], title: '度汛与围堰安全', rule: '《水利水电工程围堰设计规范》SL645', action: '复核围堰防渗与稳定，制定度汛预案，强化汛期巡查与应急物资配备。' },
  { kw: ['机械', '设备', '吊装', '挖掘机'], title: '机械设备作业安全', rule: '《施工人员安全技术操作规程》', action: '机械作业前检查调试，持证上岗，明确指挥信号，禁止无关人员进入作业半径。' },
  { kw: ['混凝土', '振捣', '蜂窝', '麻面'], title: '混凝土施工质量缺陷', rule: '《水工混凝土施工规范》SL677-2014', action: '加强分层浇筑与振捣控制，对蜂窝麻面按缺陷处理方案修补并履行质量验收程序。' },
  { kw: ['救生衣', '水上', '船', '水位'], title: '水上/临水作业防护', rule: '《水利水电工程施工安全管理导则》水上作业规定', action: '水上及临水作业须穿戴救生衣，配备救生器材并落实专人监护。' }
];

/* DeepSeek 视觉识别前置提示词 */
function systemPrompt() {
  return [
    '你是一名专业的水利工程质量安全合规助手，我提供几张照片，你依据水利工程安全、质量技术规范自动识别图片中的隐患并生成整改意见。',
    '识别要求：',
    '1) 逐张识别照片中存在的质量隐患与安全隐患（如高处作业未佩戴安全带、临边临水未设防护、深基坑无支护、' +
    '临时用电私拉乱接、脚手架不规范、围堰渗漏、混凝土浇筑缺陷、施工机械防护缺失、安全帽/救生衣未穿戴等）。',
    '2) 对每一项隐患引用适用的水利工程规范条款（如 SL176、SL223、SL/T528、SL677、JGJ46 等），并给出具体、可执行的整改措施。',
    '3) 对无法从照片中确证的隐患（可能被遮挡、角度不清、需要现场复核），请明确标注“需现场核实”。',
    '你必须以 JSON 返回，不要输出任何其他内容，格式如下：',
    '{"risks":[{"title":"隐患标题","description":"隐患描述与规范依据","level":"high|medium|low",' +
    '"rule":"引用的规范名称与条款","action":"针对性整改措施","uncertain":false}],' +
    '"summary":"整体简要评估"}',
    '其中 uncertain=true 表示该隐患需要在现场由施工员进一步核实确认。'
  ].join('\n');
}

/* ---- 底层 HTTP(S) JSON 请求工具 ---- */
function rootRequest(url, options, bodyRaw) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const u = new URL(url);
    const opts = {
      method: options.method || 'GET',
      hostname: u.hostname,
      port: u.port || (mod === https ? 443 : 80),
      path: u.pathname + u.search,
      protocol: u.protocol,
      headers: Object.assign({}, options.headers || {})
    };
    if (bodyRaw != null && !opts.headers['content-length']) {
      opts.headers['content-length'] = Buffer.byteLength(bodyRaw);
    }
    const req = mod.request(opts, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        bodyText: Buffer.concat(chunks).toString('utf-8')
      }));
    });
    req.on('error', reject);
    if (bodyRaw != null) req.write(bodyRaw);
    req.end();
  });
}

function jsonRequest(url, method, headers, payload) {
  const bodyRaw = payload != null ? JSON.stringify(payload) : null;
  return rootRequest(url, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
  }, bodyRaw).then(r => {
    let data = null;
    try { data = JSON.parse(r.bodyText); } catch (e) { /* 非 JSON */ }
    return { status: r.status, bodyText: r.bodyText, data };
  });
}

/* ---- 图片识别：调用 DeepSeek 多模态 ---- */
async function callRemoteAnalyze(photosDataUrl, extraNote) {
  const c = db.getAIConfig();
  if (!c.baseUrl || !c.apiKey) throw Object.assign(new Error('未配置AI服务地址或密钥'), { status: 400 });

  const imageParts = photosDataUrl.map(url => ({ type: 'image_url', image_url: { url } }));
  const userText = (extraNote ? ('现场补充说明：' + extraNote + '\n') : '') +
    '请识别以上施工现场照片中的质量与安全隐患，并按水利工程安全质量规范给出整改意见。';

  const url = String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions';

  const mkBody = ({ jsonMode, maxTokens, thinking }) => {
    const body = {
      model: c.model, temperature: 0.3, max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: [{ type: 'text', text: userText }, ...imageParts] }
      ]
    };
    if (jsonMode) body.response_format = { type: 'json_object' };
    if (thinking) body.thinking = { type: thinking };
    return body;
  };

  const post = async (body) => {
    const r = await jsonRequest(url, 'POST', { 'Authorization': 'Bearer ' + c.apiKey }, body);
    if (r.status >= 400) {
      const err = new Error('AI服务返回 ' + r.status + '：' + String(r.bodyText || '').slice(0, 200));
      err.status = r.status;
      err.bodyText = r.bodyText;
      throw err;
    }
    const choice = r.data && r.data.choices && r.data.choices[0];
    const msg = choice && choice.message;
    return {
      content: msg && msg.content ? String(msg.content).trim() : '',
      finish: choice ? String(choice.finish_reason || '') : ''
    };
  };

  const postSafe = async (opts) => {
    try {
      return await post(mkBody(opts));
    } catch (e) {
      if (e.status === 400 && opts.thinking && /thinking/i.test(e.bodyText || e.message || '')) {
        return await post(mkBody(Object.assign({}, opts, { thinking: null })));
      }
      throw e;
    }
  };

  const thinking = c.thinking === 'enabled' ? 'enabled' : 'disabled';
  const firstMax = thinking === 'enabled' ? 8192 : 4096;

  let r = await postSafe({ jsonMode: true, maxTokens: firstMax, thinking });
  if (!r.content && r.finish === 'length') {
    r = await postSafe({ jsonMode: true, maxTokens: 8192, thinking });
  }
  if (!r.content) {
    r = await postSafe({ jsonMode: false, maxTokens: 8192, thinking });
  }
  if (!r.content) {
    if (r.finish === 'length') throw new Error('AI输出被截断，请在「AI接口」中关闭思考模式或更换模型后重试');
    throw new Error('AI服务未返回有效结果');
  }

  const json = r.content.replace(/```json|```/g, '').trim();
  const idx = json.indexOf('{'), end = json.lastIndexOf('}');
  if (idx < 0 || end <= idx) throw new Error('AI返回内容无法解析为JSON');
  const parsed = JSON.parse(json.slice(idx, end + 1));
  if (!parsed || !Array.isArray(parsed.risks)) throw new Error('AI返回JSON缺少risks字段');
  return parsed;
}

/* ---- 本地规则识别回退 ---- */
function localAnalyze(extraNote) {
  const text = String(extraNote || '').toLowerCase();
  const matched = [];
  const miss = ['安全帽', '安全带', '防护', '基坑', '围堰'].filter(k => !text.includes(k));
  for (const k of KEYWORDS) {
    if (k.kw.some(x => text.includes(x))) {
      matched.push({ title: k.title, description: k.rule, rule: k.rule, action: k.action, level: 'medium', uncertain: true });
    }
  }
  if (matched.length === 0) {
    matched.push({
      title: '待现场核实的隐患（本地识别）',
      description: 'AI接口暂不可用，无法做图像级识别。请施工员依据照片对照要点现地认真核实。',
      rule: '图像AI未启用，建议在「AI接口设置」中配置可用的视觉模型接口以获得照片级识别。',
      action: '请对照：' + miss.join('、') + '等方面在现地进行核实并据实登记整改。',
      level: 'medium', uncertain: true
    });
  }
  return { risks: matched, summary: 'AI接口未能调用，本结果由本地规则生成，所有隐患均需施工员现场核实确认。' };
}

/* 对外：图片识别（成功远端 / 失败本地回退） */
async function analyze(photosDataUrl, extraNote) {
  try {
    const res = await callRemoteAnalyze(photosDataUrl, extraNote);
    res.fallback = false;
    return res;
  } catch (e) {
    const fb = localAnalyze(extraNote);
    fb.fallback = true;
    fb.error = String((e && e.message) || e);
    return fb;
  }
}

/* ---- 对话（非流式） ---- */
async function chat(messages) {
  const c = db.getAIConfig();
  if (!c.baseUrl || !c.apiKey) throw new Error('未配置AI服务，请先在「AI 接口」设置接口地址与密钥');
  const thinking = c.thinking === 'enabled' ? 'enabled' : 'disabled';
  const url = String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions';
  const body = {
    model: c.model, temperature: 0.4,
    max_tokens: thinking === 'enabled' ? 4096 : 2048,
    messages
  };
  if (thinking) body.thinking = { type: thinking };

  try {
    const r = await jsonRequest(url, 'POST', { 'Authorization': 'Bearer ' + c.apiKey }, body);
    if (r.status >= 400) throw new Error('AI服务返回 ' + r.status + '：' + String(r.bodyText || '').slice(0, 160));
    const content = r.data && r.data.choices && r.data.choices[0] && r.data.choices[0].message && r.data.choices[0].message.content;
    const out = content ? String(content).trim() : '';
    if (!out) throw new Error('AI服务未返回有效内容');
    return out;
  } catch (e) {
    /* 兼容不识别 thinking 参数的服务 */
    if (/thinking/i.test(String(e.message || ''))) {
      delete body.thinking;
      const r2 = await jsonRequest(url, 'POST', { 'Authorization': 'Bearer ' + c.apiKey }, body);
      if (r2.status >= 400) throw new Error('AI服务返回 ' + r2.status + '：' + String(r2.bodyText || '').slice(0, 160));
      const content2 = r2.data && r2.data.choices && r2.data.choices[0] && r2.data.choices[0].message && r2.data.choices[0].message.content;
      const out2 = content2 ? String(content2).trim() : '';
      if (!out2) throw new Error('AI服务未返回有效内容');
      return out2;
    }
    throw e;
  }
}

/* ---- 流式对话（返回一个可读流字符串 chunks + done） ----
 * 为了便于主服务直接转发 SSE，这里返回上游响应流，由调用方转发。
 * 调用方负责注入请求体并转发 Authorization 等。 */
function chatStream(messages, signal) {
  return new Promise((resolve, reject) => {
    const c = db.getAIConfig();
    if (!c.baseUrl || !c.apiKey) {
      reject(new Error('未配置AI服务，请先在「AI 接口」设置接口地址与密钥'));
      return;
    }
    const thinking = c.thinking === 'enabled' ? 'enabled' : 'disabled';
    const url = String(c.baseUrl).replace(/\/+$/, '') + '/chat/completions';
    const body = {
      model: c.model, temperature: 0.4,
      max_tokens: thinking === 'enabled' ? 4096 : 2048,
      stream: true, messages
    };
    if (thinking) body.thinking = { type: thinking };

    const mod = url.startsWith('https:') ? https : http;
    const u = new URL(url);
    const bodyRaw = JSON.stringify(body);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (mod === https ? 443 : 80),
      path: u.pathname + u.search,
      protocol: u.protocol,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyRaw),
        'Authorization': 'Bearer ' + c.apiKey
      }
    };
    const req = mod.request(opts, (res) => resolve(res));
    req.on('error', reject);
    if (signal) {
      const onAbort = () => req.destroy();
      signal.addEventListener('abort', onAbort, { once: true });
      req.on('close', () => signal.removeEventListener('abort', onAbort));
    }
    req.write(bodyRaw);
    req.end();
  });
}

/* ---- 联网检索（DeepSeek Search API） ---- */
async function searchWeb(query) {
  const c = db.getAIConfig();
  if (!c.baseUrl || !c.apiKey || !query) return null;
  const base = String(c.baseUrl).replace(/\/+$/, '');
  const url = /\/v1$/.test(base) ? base + '/tools/search' : base + '/v1/tools/search';
  try {
    const r = await jsonRequest(url, 'POST', { 'Authorization': 'Bearer ' + c.apiKey },
      { query: String(query).slice(0, 128), count: 5, need_content: false });
    if (r.status >= 400) return null;
    const results = Array.isArray(r.data && r.data.results) ? r.data.results : [];
    return results.map(x => ({
      title: x.title || '', url: x.url || '',
      snippet: x.snippet || x.summary || '',
      site: x.site_name || '', date: x.date || ''
    }));
  } catch (e) { return null; }
}

module.exports = { analyze, chat, chatStream, searchWeb };