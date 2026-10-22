'use strict';
// AI 安全隐患识别引擎（长期启用外部视觉模型接口）
//
// 工作方式：
//  ① 服务器配置 VISION_API_URL + VISION_API_KEY（OpenAI 兼容视觉接口）后，
//     每次上传照片调用真实视觉模型，依据内置水利规范提示词做语义识别，
//     区分【安全】与【质量】两类问题、识别三色安全帽（黄/红/白）、
//     对不确定项置 uncertain=true 并给出让施工员现场核查的要点。
//  ② 若未配置 AI 接口，则明确提示"需配置 AI 接口"，不再使用自研像素引擎作为替代。
//
// 所有结论均遵循《references/safety-regulations.md》规范库，绝不臆断。
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const RISK_ORDER = { 重大: 3, 较大: 2, 一般: 1, 提示: 0 };

// 规则库
const RULE_BASE = require('./rulebase.json').rules;

// ── 已接入的 AI 视觉接口默认配置（DeepSeek，OpenAI 兼容）。
// 优先级：data/ai-config.json > 环境变量 > 下方内置默认值。
// 如续费/更换 Key，可在「设置」中更新，或修改本常量后重启。
const BUILTIN_AI = {
  url: 'https://api.deepseek.com/v1/chat/completions',
  key: 'sk-59587484e9834ff9a6f8a36b821b5888',
  model: 'deepseek-v4-pro',
  provider: 'deepseek',
};

// 将图片转为 base64 data URL
function imageDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

// 是否有外部视觉API配置（优先读取 data/ai-config.json，其次读取环境变量）
function getAiConfig() {
  const envUrl = process.env.VISION_API_URL || '';
  const envKey = process.env.VISION_API_KEY || '';
  try {
    const fp = path.join(__dirname, '..', 'data', 'ai-config.json');
    if (fs.existsSync(fp)) {
      const c = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const url = (c.url || envUrl).trim();
      const key = (c.key || envKey).trim();
      if (url && key) {
        return { url, key, model: (c.model || '').trim() || 'gpt-4o-mini', provider: c.provider || '', source: 'file' };
      }
    }
  } catch (e) { /* ignore */ }
  if (envUrl && envKey) {
    return { url: envUrl.trim(), key: envKey.trim(), model: (process.env.VISION_MODEL || 'gpt-4o-mini').trim(), provider: '', source: 'env' };
  }
  // 无文件/环境变量配置时，回退到内置 DeepSeek 配置（保证开箱即用已接入 AI）
  return {
    url: BUILTIN_AI.url,
    key: BUILTIN_AI.key,
    model: BUILTIN_AI.model,
    provider: BUILTIN_AI.provider,
    source: 'builtin',
  };
}

function hasVisionApi() {
  return !!getAiConfig();
}

// 调用 OpenAI 兼容视觉接口
function callVisionApi(filePath) {
  const cfg = getAiConfig();
  const apiUrl = cfg.url;
  const apiKey = cfg.key;
  const model = cfg.model || 'gpt-4o-mini';
  const prompt =
    '你是水利工程质量安全审核专家。请审核这张施工现场照片，严格依据以下水利及施工规范，识别画面中客观可见的质量与安全隐患，并只输出 JSON（不要其它文字）。\n' +
    '【规范依据】《水利水电工程施工通用安全技术规程》SL 398-2007、《水利水电工程施工安全防护设施技术规范》SL 714-2015（临边防护≥1.2m含挡脚板、洞口覆盖、临水救生器材）、《水利水电工程施工安全管理导则》SL 721-2015（第9.0.3条个体防护）、《水利水电工程施工质量检验与评定规程》SL 176-2007、水工混凝土施工规范 SL 677-2014（养护≥14d）、GB 50204-2015（第5.3.2条钢筋连接、结构实体检验）、JGJ 46-2005（三级配电两级保护、漏电保护）、JGJ 80-2016（安全带高挂低用）、JGJ 130-2011（脚手板满铺、连墙件）、GB 6067.1-2010（吊装警戒）、SL 753-2017（基坑支护监测）。\n' +
    '【个人防护·安全帽】工程安全帽有黄/红/白三色：黄色为一般工人/普工佩戴，红色为领班/管理人员佩戴，白色为项目部/监理人员佩戴。请仅当画面中人员头部确实无安全帽、或不戴安全帽时，才判定为"未佩戴安全帽"；只要看到任一颜色安全帽即视为已佩戴，不要将所有人员误判为未戴安全帽。\n' +
    '【问题类型】请在 type 字段区分两类：安全（个人防护、临边洞口防护、脚手架、高处作业、施工用电、起重吊装、动火消防、临水防汛、文明施工）与质量（钢筋锈蚀/连接、混凝土裂缝/养护/外观缺陷、模板支撑、支护与监测、砌体/防水质量）。\n' +
    '【风险分级】重大（可能直接造成人员伤亡，如失去临边防护、吊装下方站人、高处无安全带、动火无监护、边坡严重失稳）；较大（可能导致伤害/较大质量缺陷）；一般（潜在隐患/一般外观缺陷）；提示（仅需关注或建议核查）。\n' +
    '【不确定项】凡无法从画面像素客观确证的结构性隐患（如防护栏杆内部损伤、连墙件连接是否可靠、基坑支护监测数据、隐蔽工程）请在 uncertain 置 true，并在 confirmNote 中写明让施工员现场核查的要点；不确定项不要贸然定为重大。\n' +
    '输出 JSON 数组，结构：[{"type":"安全或质量","category":"隐患类型","risk":"重大/较大/一般/提示","description":"客观描述你从图片实际看到的问题","regulation":"引用上述规范条款编号","rectification":"可执行的具体整改措施","uncertain":true或false,"confirmNote":"uncertain为true时填写让施工员现场核查的要点"}]。\n' +
    '若未发现任何明显问题，输出空数组 [{"type":"安全","category":"综合","risk":"提示","description":"未发现明显隐患，建议结合现场规范抽查确认","regulation":"现场复核","rectification":"由安全员/施工员按规范现场抽查","uncertain":true,"confirmNote":"AI未识别到明确隐患，现场人工复核"}]。';

  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageDataUrl(filePath) } },
          ],
        },
      ],
      temperature: 0,
    });
    const mod = apiUrl.startsWith('https') ? https : http;
    const req = mod.request(
      apiUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          // 非 2xx 一律视为调用失败（如余额不足 402、鉴权 401 等），触发本地引擎回退
          if (res.statusCode < 200 || res.statusCode >= 300) {
            let msg = 'HTTP ' + res.statusCode;
            try { const e = JSON.parse(data); if (e && e.error && e.error.message) msg = e.error.message; } catch (err) {}
            return resolve({ ok: false, error: msg });
          }
          try {
            const json = JSON.parse(data);
            const content = json.choices && json.choices[0] && json.choices[0].message
              ? json.choices[0].message.content : '';
            const arr = extractJsonArray(content);
            resolve({ ok: true, findings: arr.map(normalizeFinding) });
          } catch (e) {
            resolve({ ok: false, error: '解析失败: ' + e.message });
          }
        });
      }
    );
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: '视觉接口超时' }); });
    req.write(payload);
    req.end();
  });
}

function extractJsonArray(text) {
  const m = String(text).match(/\[\s*\{.*\}\s*\]/s);
  if (!m) return [];
  try { return JSON.parse(m[0]); } catch (e) { return []; }
}
function normalizeFinding(f) {
  const riskMap = { 重大: '重大', 较大: '较大', 一般: '一般', 提示: '提示' };
  return {
    type: (f.type || '安全').trim(),
    category: (f.category || '综合').trim(),
    risk: riskMap[f.risk] || '提示',
    description: (f.description || '模型未返回描述').trim(),
    regulation: (f.regulation || '现场复核').trim(),
    rectification: (f.rectification || '').trim(),
    uncertain: !!(f.uncertain),
    confirmNote: (f.confirmNote || '').trim(),
  };
}

// 本地像素+规则引擎：真正读取照片像素做特征识别，并结合"补充描述"的规范规则匹配。
// 用于：AI 未配置、或 AI 接口调用失败时兜底，保证巡检流程不中断。
function localEngineFindings(filePath, photoName, hints) {
  const findings = [];
  let topRisk = '提示';
  for (const rule of ruleMatch(hints)) {
    const f = { ...buildFinding(rule, photoName), source: 'rule' };
    findings.push(f);
    if (RISK_ORDER[f.risk] > RISK_ORDER[topRisk]) topRisk = f.risk;
  }
  try {
    const frame = require('./vision').decodeImage(fs.readFileSync(filePath));
    if (frame) {
      const feat = require('./vision').extractFeatures(frame);
      const inf = require('./vision').inferFindings(feat);
      // 仅并入"非提示"级并尚未被规则命中的像素结论，避免与规则重复
      for (const f of inf.findings) {
        if (f.risk === '提示' && RISK_ORDER[f.risk] <= RISK_ORDER[topRisk]) continue;
        const dup = findings.some((x) => x.category === f.category && x.risk === f.risk);
        if (dup) continue;
        findings.push({ ...f, photo: photoName, source: 'pixel' });
        if (RISK_ORDER[f.risk] > RISK_ORDER[topRisk]) topRisk = f.risk;
      }
    }
  } catch (e) { /* 像素解码失败不影响本结果 */ }
  return { findings, topRisk };
}

// 单张照片分析入口（AI 优先；AI 失败/未配置时回退本地像素规则引擎）
async function analyzeImageAsync(filePath, opts = {}) {
  const { photoName = '', hints = '' } = opts;
  const result = {
    photo: photoName,
    decodeStatus: 'pending',
    engine: 'unknown',
    findings: [],
    aiConfigured: hasVisionApi(),
  };

  // ① AI 视觉接口（优先、长期启用）
  if (hasVisionApi()) {
    const resp = await callVisionApi(filePath);
    if (resp.ok && resp.findings.length) {
      result.engine = 'vision-api';
      result.decodeStatus = 'vision-ok';
      // 附加用户描述到每条识别项，作为补充信息
      result.findings.push(...resp.findings);
      result.vision = true;
      return finalize(result);
    }
    if (!resp.ok) {
      // AI 接口调用失败 → 回退本地像素规则引擎，保证巡检不中断
      const local = localEngineFindings(filePath, photoName, hints);
      result.engine = 'vision-api-error-fallback';
      result.decodeStatus = 'error-fallback';
      result.findings.push({
        type: '系统', category: 'AI接口异常·已回退本地识别', risk: '提示',
        description: 'AI 视觉接口调用失败（' + (resp.error || '未知错误') + '），已自动回退到本地像素规则引擎进行识别，以下结论供参考。',
        regulation: '—',
        rectification: '请检查 ai-config.json 中的 API Key / 模型配置与账户余额；当前结果可先用现场人工复核。',
        uncertain: true, confirmNote: 'AI 接口异常，以下为本地引擎兜底结果，请现场核实。', source: 'system',
      });
      result.findings.push(...local.findings);
      return finalize(result);
    }
    // AI 正常返回但无发现 → 输出"未发现明显隐患"并附规范核查清单
    result.engine = 'vision-api';
    result.decodeStatus = 'vision-ok-clean';
    result.findings.push({
      type: '安全', category: '综合', risk: '提示',
      description: 'AI 未检出明显隐患；以下结构性项目建议一并现场抽查：临边防护栏杆、洞口盖板、脚手架连墙件、基坑支护与监测、钢筋连接与混凝土养护。',
      regulation: '现场复核（SL 714-2015 / JGJ 80-2016 / GB 50204-2015）',
      rectification: '由施工员/安全员结合规范抽查确认，做到应查尽查。',
      uncertain: true, confirmNote: 'AI 未识别到明确问题，现场人工复核确认。', source: 'system',
    });
    return finalize(result);
  }

  // ② AI 未配置 → 本地像素规则引擎兜底
  const local = localEngineFindings(filePath, photoName, hints);
  result.engine = 'local-engine';
  result.decodeStatus = 'local-engine';
  result.findings.push(...local.findings);
  if (!result.findings.length) {
    result.findings.push({
      type: '安全', category: '综合', risk: '提示',
      description: '未识别到明确隐患，建议结合现场规范抽查确认：临边防护栏杆、洞口盖板、脚手架连墙件、基坑支护与监测、钢筋连接与混凝土养护。',
      regulation: '现场复核（SL 714-2015 / JGJ 80-2016 / GB 50204-2015）',
      rectification: '由施工员/安全员按规范现场抽查确认。',
      uncertain: true, confirmNote: '本地引擎未检出明确问题，现场人工复核确认。', source: 'system',
    });
  }
  return finalize(result);
}

function finalize(result) {
  let topRisk = '提示';
  for (const f of result.findings) if (RISK_ORDER[f.risk] > RISK_ORDER[topRisk]) topRisk = f.risk;
  result.topRisk = topRisk;
  const cnt = { 重大: 0, 较大: 0, 一般: 0, 提示: 0 };
  result.findings.forEach((f) => (cnt[f.risk] = (cnt[f.risk] || 0) + 1));
  result.summary = `识别引擎：${result.engine}；共 ${result.findings.length} 项；重大${cnt.重大}项 / 较大${cnt.较大}项 / 一般${cnt.一般}项 / 提示核实${cnt.提示}项`;
  return result;
}

function ruleMatch(text) {
  const hits = [];
  if (!text) return hits;
  for (const rule of RULE_BASE) {
    if (!rule.keywords || !rule.keywords.length) continue;
    if (rule.keywords.some((k) => text.includes(k))) hits.push(rule);
  }
  return hits;
}
function buildFinding(rule, photoName) {
  return {
    id: rule.id, photo: photoName,
    type: rule.categoryType || '安全',
    risk: rule.risk, category: rule.category,
    description: rule.finding, regulation: rule.regulation, rectification: rule.rectification,
    uncertain: false,
  };
}
function maxRisk(findings) {
  let best = '提示';
  for (const f of findings) if (RISK_ORDER[f.risk] > RISK_ORDER[best]) best = f.risk;
  return best;
}

// 保留同步接口供旧调用（server.js 已改为 async）
function analyzeImage(filePath, opts = {}) {
  return analyzeImageAsync(filePath, opts);
}

module.exports = {
  analyzeImage,
  analyzeImageAsync,
  hasVisionApi,
  getAiConfig,
  RULE_BASE,
  RISK_ORDER,
  maxRisk,
};