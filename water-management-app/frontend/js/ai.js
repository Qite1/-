/* ============================================================
 * AI 接口层（前端 → 后端代理）
 *
 * 前端不再直接携带 DeepSeek API Key 调大模型，而是统一请求后端
 * server/server.js 提供的 /api/ai/* 接口；API Key 由管理员在后端
 * 配置并保存在服务端，避免泄露到浏览器。
 *   - analyze      照片隐患识别
 *   - chat         非流式对话
 *   - chatStream   流式对话（SSE，打字机输出，可中断）
 *   - searchWeb    联网检索规范（DeepSeek Search API）
 * ============================================================ */

const AI = (() => {
  const WM_API_BASE = (typeof window !== 'undefined' && window.WM_API_BASE)
    ? window.WM_API_BASE.replace(/\/+$/, '')
    : '/api';

  const DEFAULT_CONFIG = {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    apiKey: '',
    thinking: 'disabled'
  };

  /* 读取本地 token（与 Store 一致），用于请求鉴权 */
  function token() {
    try { return (typeof localStorage !== 'undefined') ? (localStorage.getItem('wm_session_token') || '') : ''; }
    catch (e) { return ''; }
  }
  function authHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    const t = token();
    if (t) headers['Authorization'] = 'Bearer ' + t;
    return headers;
  }

  async function request(path, body, signal) {
    let resp;
    try {
      resp = await fetch(WM_API_BASE + path, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal
      });
    } catch (e) {
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) {
        const err = new Error('aborted'); err.aborted = true; throw err;
      }
      throw new Error('无法连接后端服务，请先启动 node backend/server/server.js');
    }
    if (resp.status === 204) return null;
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = new Error(data.error || ('请求失败 ' + resp.status));
      err.status = resp.status;
      throw err;
    }
    return data;
  }

  /* cfg() 供「AI 接口」页回填展示（baseUrl/model/thinking 由后端下发） */
  function cfg() {
    const c = (typeof Store !== 'undefined' && Store.getAIConfig) ? Store.getAIConfig() : {};
    return Object.assign({}, DEFAULT_CONFIG, c);
  }

  /* ---- 照片隐患识别：交给后端代理，后端不可用/未配置密钥时自动本地回退 ---- */
  async function analyze(photosDataUrl, extraNote) {
    return request('/ai/analyze', { photos: photosDataUrl, note: extraNote || '' });
  }

  /* ---- 对话（非流式）。
       兼容两种调用：AI.chat(systemText, userText) 或 AI.chat(messages数组)。
       交由后端 /api/ai/chat，后端会依据台账快照构建/补充 system 并在接口不可用时兜底。 */
  async function chat(systemText, userText) {
    const messages = Array.isArray(systemText)
      ? systemText
      : [{ role: 'system', content: systemText }, { role: 'user', content: userText }];
    const data = await request('/ai/chat', { messages, searchResults: null });
    if (!data || typeof data.text !== 'string' || !data.text) throw new Error('AI服务未返回有效内容');
    /* 后端因接口不可用而回退时，抛错以提醒（「测试连接」据此判定失败；正常对话由调用方兜底） */
    if (data.fallback && data.error) throw new Error(data.error || 'AI 接口暂不可用');
    return data.text;
  }

  /* ---- 联网检索 ---- */
  async function searchWeb(query) {
    try {
      const data = await request('/ai/search', { query: String(query || '').slice(0, 128) });
      return (data && Array.isArray(data.results)) ? data.results : null;
    } catch (e) { return null; }
  }

  /* ---- 流式对话（SSE）。
       messages 为完整消息数组；onDelta(piece, full) 增量回调；
       signal 用于「停止生成」。返回 { text, aborted }。 */
  async function chatStream(messages, onDelta, signal) {
    let resp;
    try {
      resp = await fetch(WM_API_BASE + '/ai/chat/stream', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ messages, searchResults: null }),
        signal
      });
    } catch (e) {
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) return { text: '', aborted: true };
      throw new Error('无法连接后端服务，请先启动 node backend/server/server.js');
    }
    if (!resp.ok || !resp.body) {
      throw new Error('AI服务返回 ' + resp.status);
    }
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
      /* 用户点击「停止生成」：保留已生成部分 */
      if (e && (e.name === 'AbortError' || /abort/i.test(String(e.message || '')))) aborted = true;
      else throw e;
    }
    if (!full && !aborted) throw new Error('AI服务未返回有效内容');
    return { text: full, aborted };
  }

  return { analyze, chat, chatStream, searchWeb, cfg, defaultConfig: DEFAULT_CONFIG };
})();

/* node 环境下导出（浏览器加载时 module 未定义，不受影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = AI;
}