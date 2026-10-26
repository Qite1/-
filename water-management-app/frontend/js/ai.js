/* ============ AI 接口层：识别照片安全隐患并提出整改意见 ============ */
/* 默认接入 DeepSeek 多模态模型 deepseek-flash（OpenAI 兼容 /chat/completions）。
   API Key 不随代码分发，由管理员在「AI 接口」页面填写保存，
   申请地址：https://platform.deepseek.com/api_keys */

const AI = (() => {
  const DEFAULT_CONFIG = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash', // DeepSeek 多模态模型，支持图片输入
    apiKey: '',
    thinking: 'disabled' // DeepSeek 思考模式默认关闭：思考内容计入 max_tokens，开启易耗尽输出上限导致正式内容为空
  };

  /* 一次性迁移：旧版本默认指向 OpenAI 并预填演示密钥；
     升级到 DeepSeek 默认后，检测到旧默认配置则自动重置（用户自定义的其他服务配置不受影响）。 */
  (function migrateAIConfig() {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('wm_ai_cfg_v2')) return;
      const saved = Store.getAIConfig() || {};
      if (/api\.openai\.com/i.test(saved.baseUrl || '')) {
        Store.setAIConfig({ baseUrl: DEFAULT_CONFIG.baseUrl, model: DEFAULT_CONFIG.model, apiKey: '' });
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem('wm_ai_cfg_v2', '1');
    } catch (e) { /* localStorage 异常时忽略，cfg() 会以默认配置兜底 */ }
  })();

  function cfg() {
    const c = Store.getAIConfig() || {};
    return Object.assign({}, DEFAULT_CONFIG, c);
  }

  /* 前置提示词（system）：定义 AI 身份与识别任务，并约定 JSON 输出格式供页面解析 */
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

  /* 调用远程接口（OpenAI 兼容，DeepSeek 多模态）：
     照片以 Base64 data URL 放在 user 消息的 image_url 块中（DeepSeek 要求图片仅能出现在 user 消息），
     单次请求携带全部照片（本系统上传上限 6 张，远低于 DeepSeek 单请求 600 张的上限）。
     注意：DeepSeek 默认开启思考模式，思考内容会占用输出上限导致 content 为空，
     因此默认显式传 thinking=disabled；可在「AI 接口」页面切换。 */
  async function callRemote(photosDataUrl, extraNote) {
    const c = cfg();
    if (!c.baseUrl || !c.apiKey) throw new Error('未配置AI服务地址或密钥，请在「AI接口设置」中填写后重试');

    const imageParts = photosDataUrl.map(url => ({
      type: 'image_url', image_url: { url }
    }));

    const userText = (extraNote ? ('现场补充说明：' + extraNote + '\n') : '') +
      '请识别以上施工现场照片中的质量与安全隐患，并按水利工程安全质量规范给出整改意见。';

    const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';

    /* 发送请求，返回 {content, finish}；错误带 status 与 bodyText 便于上层分支处理 */
    const post = async (body) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        const err = new Error('AI服务返回 ' + resp.status + '：' + t.slice(0, 200));
        err.status = resp.status;
        err.bodyText = t;
        throw err;
      }
      const data = await resp.json();
      const choice = data.choices && data.choices[0];
      const msg = choice && choice.message;
      return {
        content: msg && msg.content ? String(msg.content).trim() : '',
        finish: choice ? String(choice.finish_reason || '') : ''
      };
    };

    const mkBody = ({ jsonMode, maxTokens, thinking }) => {
      const body = {
        model: c.model,
        temperature: 0.3,
        max_tokens: maxTokens, // 防止 JSON 结果中途截断
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: [{ type: 'text', text: userText }, ...imageParts] }
        ]
      };
      if (jsonMode) body.response_format = { type: 'json_object' };
      if (thinking) body.thinking = { type: thinking };
      return body;
    };

    /* 部分 OpenAI 兼容服务不识别 thinking 参数（返回 400 并提示参数名），
       此时不带该参数重发一次；DeepSeek 官方接口正常识别。 */
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
    const firstMax = thinking === 'enabled' ? 8192 : 4096; // 开启思考时预留更大输出预算

    /* 1) 标准 path：JSON Output + 关闭思考 */
    let r = await postSafe({ jsonMode: true, maxTokens: firstMax, thinking });
    /* 2) 输出被截断（思考耗尽 max_tokens）：提高预算再试 */
    if (!r.content && r.finish === 'length') {
      r = await postSafe({ jsonMode: true, maxTokens: 8192, thinking });
    }
    /* 3) DeepSeek JSON 模式偶发空返回：去掉 response_format，靠前置提示词约束 JSON */
    if (!r.content) {
      r = await postSafe({ jsonMode: false, maxTokens: 8192, thinking });
    }
    if (!r.content) {
      if (r.finish === 'length') throw new Error('AI输出被截断（思考过程耗尽输出上限），请在「AI接口」中关闭思考模式或更换模型后重试');
      throw new Error('AI服务未返回有效结果');
    }

    const json = r.content.replace(/```json|```/g, '').trim();
    const idx = json.indexOf('{'), end = json.lastIndexOf('}');
    if (idx < 0 || end <= idx) throw new Error('AI返回内容无法解析为JSON：' + r.content.slice(0, 120));
    const parsed = JSON.parse(json.slice(idx, end + 1));
    if (!parsed || !Array.isArray(parsed.risks)) throw new Error('AI返回JSON缺少risks字段');
    return parsed;
  }

  /* 本地规则关键词回退：接口失败或未配置时给出基础提示，同时标记需现场核实。
     保证应用离线/接口不通也能演示完整闭环。 */
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
  function localAnalyze(extraNote) {
    const text = (extraNote || '').toLowerCase();
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
        description: 'AI接口暂不可用，无法做图像级识别。请施工员依据照片对照以下要点现地认真核实。',
        rule: '图像AI未启用，建议在「AI接口设置」中配置可用的视觉模型接口以获得照片级识别。',
        action: '请对照：' + miss.join('、') + '等方面在现地进行核实并据实登记整改。',
        level: 'medium', uncertain: true
      });
    }
    return { risks: matched, summary: 'AI接口未能调用，本结果由本地规则生成，所有隐患均需施工员现场核实确认。' };
  }

  /* 对外主入口。成功返回远端结果；失败则回退本地规则并在结果标记 fallback=true */
  async function analyze(photosDataUrl, extraNote) {
    try {
      const res = await callRemote(photosDataUrl, extraNote);
      res.fallback = false;
      return res;
    } catch (e) {
      const fallback = localAnalyze(extraNote);
      fallback.fallback = true;
      fallback.error = String((e && e.message) || e);
      return fallback;
    }
  }

  /* 文本对话（给 AI 助手使用）：OpenAI 兼容 /chat/completions（DeepSeek deepseek-flash），
     失败时抛错，由调用方回退到本地台账回答。
     同 callRemote：默认关闭思考模式，防止思考耗尽 max_tokens 导致 content 为空。 */
  async function chat(systemText, userText) {
    const c = cfg();
    if (!c.baseUrl || !c.apiKey) throw new Error('未配置AI服务，请先在「AI 接口」设置接口地址与密钥');
    const thinking = c.thinking === 'enabled' ? 'enabled' : 'disabled';
    /* systemText 传入数组时视为完整多轮消息（供 AI 助手流式失败时非流式降级） */
    const baseMessages = Array.isArray(systemText)
      ? systemText
      : [{ role: 'system', content: systemText }, { role: 'user', content: userText }];
    const mkBody = (withThinking) => {
      const body = {
        model: c.model, temperature: 0.4,
        max_tokens: thinking === 'enabled' ? 4096 : 2048,
        messages: baseMessages
      };
      if (withThinking) body.thinking = { type: thinking };
      return body;
    };
    const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const post = async (body) => {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        const err = new Error('AI服务返回 ' + resp.status + '：' + t.slice(0, 160));
        err.status = resp.status;
        err.bodyText = t;
        throw err;
      }
      const data = await resp.json();
      const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return content ? String(content).trim() : '';
    };
    let content;
    try {
      content = await post(mkBody(true));
    } catch (e) {
      /* 服务不识别 thinking 参数时去掉重发 */
      if (e.status === 400 && /thinking/i.test(e.bodyText || e.message || '')) content = await post(mkBody(false));
      else throw e;
    }
    if (!content) throw new Error('AI服务未返回有效内容');
    return content;
  }

  /* 流式多轮对话（AI 助手主链路）：
     messages 为完整消息数组（system + 历史轮次 + 本轮 user），
     SSE 增量回调 onDelta(piece, full)；signal 用于「停止生成」。
     返回 { text, aborted }。同样默认关闭思考模式，并兼容不识别 thinking 参数的服务。 */
  async function chatStream(messages, onDelta, signal) {
    const c = cfg();
    if (!c.baseUrl || !c.apiKey) throw new Error('未配置AI服务，请先在「AI 接口」设置接口地址与密钥');
    const thinking = c.thinking === 'enabled' ? 'enabled' : 'disabled';
    const mkBody = (withThinking) => {
      const body = {
        model: c.model, temperature: 0.4,
        max_tokens: thinking === 'enabled' ? 4096 : 2048,
        stream: true,
        messages
      };
      if (withThinking) body.thinking = { type: thinking };
      return body;
    };
    const url = c.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const post = body => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
      body: JSON.stringify(body),
      signal
    });

    const isAbort = e => !!(e && (e.name === 'AbortError' || /abort/i.test(String(e.message || ''))));

    let resp;
    try {
      resp = await post(mkBody(true));
    } catch (e) {
      if (isAbort(e)) return { text: '', aborted: true }; /* 用户在响应前点击停止 */
      throw e;
    }
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      /* 服务不识别 thinking 参数时去掉重发 */
      if (resp.status === 400 && /thinking/i.test(t)) {
        try {
          resp = await post(mkBody(false));
        } catch (e) {
          if (isAbort(e)) return { text: '', aborted: true };
          throw e;
        }
        if (!resp.ok) {
          const t2 = await resp.text().catch(() => '');
          throw new Error('AI服务返回 ' + resp.status + '：' + String(t2 || '').slice(0, 160));
        }
      } else {
        throw new Error('AI服务返回 ' + resp.status + '：' + String(t || '').slice(0, 160));
      }
    }

    /* 解析 SSE：data: {...} 行，delta.content 为增量，[DONE] 结束 */
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '', full = '', aborted = false;
    const handleLine = (line) => {
      const s = line.trim();
      if (!s.startsWith('data:')) return;
      const data = s.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const j = JSON.parse(data);
        const piece = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
        if (piece) { full += piece; if (onDelta) onDelta(piece, full); }
      } catch (e) { /* 跳过无法解析的行 */ }
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          handleLine(buf.slice(0, idx));
          buf = buf.slice(idx + 1);
        }
      }
      if (buf) handleLine(buf);
    } catch (e) {
      /* 用户点击「停止生成」：保留已生成的部分 */
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) aborted = true;
      else throw e;
    }
    if (!full && !aborted) throw new Error('AI服务未返回有效内容');
    return { text: full, aborted };
  }

  /* 联网搜索（DeepSeek Search API，POST /v1/tools/search）：
     返回 [{title,url,snippet,site,date}]；未配置/失败/不支持时返回 null，由调用方降级。 */
  async function searchWeb(query) {
    const c = cfg();
    if (!c.baseUrl || !c.apiKey || !query) return null;
    /* chat 端点为 {base}/chat/completions，search 端点为 {base}/v1/tools/search；
       中转服务常以 /v1 结尾，此时直接拼接 /tools/search */
    const base = c.baseUrl.replace(/\/+$/, '');
    const url = /\/v1$/.test(base) ? base + '/tools/search' : base + '/v1/tools/search';
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + c.apiKey },
        body: JSON.stringify({ query: String(query).slice(0, 128), count: 5, need_content: false })
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const results = Array.isArray(data.results) ? data.results : [];
      return results.map(r => ({
        title: r.title || '', url: r.url || '',
        snippet: r.snippet || r.summary || '',
        site: r.site_name || '', date: r.date || ''
      }));
    } catch (e) { return null; }
  }

  return { analyze, chat, chatStream, searchWeb, cfg, defaultConfig: DEFAULT_CONFIG };
})();

/* node 环境下导出（浏览器加载时 module 未定义，不受影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AI;
}