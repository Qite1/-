/* ============================================================
 * 轻量 Markdown 渲染器（零依赖，供 AI 助手消息渲染）
 * 支持：代码块 / 行内代码 / 标题 / 有序无序列表 / 表格 /
 *       粗体 / 链接 / 引用 / 分隔线 / 换行
 * 所有文本先经 HTML 转义再替换标记，防注入。
 * ============================================================ */
const MD = (() => {
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /* 行内标记：行内代码 → 粗体 → 链接（顺序执行，代码内容不再解析其余标记） */
  function inline(t) {
    let s = escHtml(t);
    const codeSlots = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => {
      codeSlots.push(c);
      return '\u0000' + (codeSlots.length - 1) + '\u0000';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>');
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + codeSlots[+i] + '</code>');
    return s;
  }

  const RE = {
    code: /^```/,
    tableRow: /^\s*\|.*\|\s*$/,
    tableSep: /^\s*\|[\s:|-]+\|\s*$/,
    ul: /^\s*[-*•]\s+/,
    ol: /^\s*\d+[.、)）]\s+/,
    heading: /^#{1,6}\s+/,
    quote: /^>\s?/,
    hr: /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
  };
  const splitRow = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());

  function toHtml(src) {
    const lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const line = lines[i];

      /* 代码块 */
      if (RE.code.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !RE.code.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; /* 跳过收尾 ``` */
        html += '<pre>' + escHtml(buf.join('\n')) + '</pre>';
        continue;
      }

      /* 表格：当前行是表格行且下一行是 |---|---| 分隔行 */
      if (RE.tableRow.test(line) && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
        const head = splitRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && RE.tableRow.test(lines[i]) && !RE.tableSep.test(lines[i])) {
          rows.push(splitRow(lines[i])); i++;
        }
        html += '<div class="md-table-wrap"><table class="md-table"><thead><tr>' +
          head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table></div>';
        continue;
      }

      /* 无序列表 */
      if (RE.ul.test(line)) {
        const items = [];
        while (i < lines.length && RE.ul.test(lines[i])) {
          items.push(lines[i].replace(RE.ul, '')); i++;
        }
        html += '<ul>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ul>';
        continue;
      }

      /* 有序列表 */
      if (RE.ol.test(line)) {
        const items = [];
        while (i < lines.length && RE.ol.test(lines[i])) {
          items.push(lines[i].replace(RE.ol, '')); i++;
        }
        html += '<ol>' + items.map(x => '<li>' + inline(x) + '</li>').join('') + '</ol>';
        continue;
      }

      /* 标题（聊天气泡内统一小号） */
      if (RE.heading.test(line)) {
        html += '<h5>' + inline(line.replace(RE.heading, '')) + '</h5>';
        i++;
        continue;
      }

      /* 引用 */
      if (RE.quote.test(line)) {
        const buf = [];
        while (i < lines.length && RE.quote.test(lines[i])) {
          buf.push(lines[i].replace(RE.quote, '')); i++;
        }
        html += '<blockquote>' + buf.map(inline).join('<br/>') + '</blockquote>';
        continue;
      }

      /* 分隔线 */
      if (RE.hr.test(line)) { html += '<hr/>'; i++; continue; }

      /* 空行 */
      if (line.trim() === '') { i++; continue; }

      /* 普通段落：连续普通行合并，段内换行转 <br/> */
      const buf = [line]; i++;
      while (i < lines.length && lines[i].trim() !== '' &&
        !RE.code.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i]) &&
        !RE.heading.test(lines[i]) && !RE.quote.test(lines[i]) && !RE.hr.test(lines[i]) &&
        !RE.tableRow.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      html += '<p>' + buf.map(inline).join('<br/>') + '</p>';
    }
    return html;
  }

  return { toHtml, escHtml };
})();

/* node 环境下导出（浏览器加载时 module 未定义，不受影响） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MD;
}
