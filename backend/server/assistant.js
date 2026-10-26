/* ============================================================
 * AI 助手后端逻辑
 * 构建台账上下文、组装 system 提示词、本地兜底回复。
 * 与前端 app.js 中 buildLedgerContext / systemPromptForAssistant /
 * assistantLocalReply 逻辑一致，供 /api/ai/chat 与 /api/ai/chat/stream 使用。
 * ============================================================ */

const db = require('./db');
const { REGULATIONS } = require('./regulations');

/* 名称映射：用户 id -> 姓名 */
function userNameById(id) {
  const u = db.findUserById(id);
  return u ? u.name : '未知';
}

function buildLedgerContext() {
  const issues = db.listIssues();
  const pending = issues.filter(i => i.status === 'confirmed' || i.status === 'rectifying');
  const done = issues.filter(i => i.status === 'rectified' || i.status === 'closed');
  const levelStats = {};
  const kindCount = {};
  const bySite = {};
  const byUser = {};
  const statusCount = {};
  issues.forEach(i => {
    levelStats[i.risk || 'low'] = (levelStats[i.risk || 'low'] || 0) + 1;
    statusCount[i.status] = (statusCount[i.status] || 0) + 1;
    const site = (i.site || '').trim() || '未填写部位';
    bySite[site] = (bySite[site] || 0) + 1;
    const u = userNameById(i.builderId);
    if (!byUser[u]) byUser[u] = { total: 0, pending: 0 };
    byUser[u].total++;
    if (i.status === 'confirmed' || i.status === 'rectifying') byUser[u].pending++;
    (i.risks || []).forEach(r => {
      const key = (r.title || '').slice(0, 18);
      if (key) kindCount[key] = (kindCount[key] || 0) + 1;
    });
  });
  const topKinds = Object.entries(kindCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => (k + '（' + n + '次）'));
  return {
    total: issues.length,
    pending: pending.map(i => i.title + (i.site ? ' @ ' + i.site : '')),
    done: done.map(i => i.title),
    level: levelStats,
    status: statusCount,
    bySite, byUser,
    hot: topKinds,
    regNames: REGULATIONS.map(r => r.name)
  };
}

function systemPromptForAssistant(ctx, searchResults) {
  const lines = [
    '你是湖北建投水利水电工程有限公司的质量安全合规管理 AI 助手（由 DeepSeek 大模型驱动）。',
    '你熟悉水利工程安全与质量技术规范，本系统收录的规范包括：' + ctx.regNames.slice(0, 12).join('；') + ' 等。',
    '你掌握本系统当前问题整改台账的真实数据：',
    '- 问题总数 ' + ctx.total + '；风险等级分布 ' + JSON.stringify(ctx.level) + '；状态分布 ' + JSON.stringify(ctx.status),
    '- 待整改/整改中：' + (ctx.pending.length ? ctx.pending.join('；') : '暂无'),
    '- 已整改/已销号：' + (ctx.done.length ? ctx.done.join('；') : '暂无'),
    '- 高频安全隐患 TOP：' + (ctx.hot.length ? ctx.hot.join('；') : '暂无'),
    '- 按施工部位分布：' + JSON.stringify(ctx.bySite),
    '- 按提交人统计：' + JSON.stringify(ctx.byUser)
  ];
  if (searchResults && searchResults.length) {
    lines.push('以下是刚刚联网检索到的相关资料（回答时可引用并注明来源与日期；若与现行权威规范可能不一致，请提醒用户以官方发布为准）：');
    searchResults.forEach((r, i) => {
      lines.push((i + 1) + '. 《' + r.title + '》' +
        (r.site ? ' 来源：' + r.site : '') + (r.date ? ' ' + String(r.date).slice(0, 10) : '') +
        ' 摘要：' + r.snippet + ' 链接：' + r.url);
    });
  }
  lines.push('回答要求：用简洁、专业、面向施工管理的中文作答；使用 Markdown 结构化排版（小标题、要点列表、表格、重点加粗），适合现场管理人员快速阅读；' +
    '涉及规范时给出规范名称与编号；台账类数据以你掌握的真实数据为准；对无法确证的内容如实说明，并建议现场核实或到「规范查询」查阅权威平台。');
  return lines.join('\n');
}

/* 在线接通则返回 null（代表无需本地回答）；离线/失败时返回本地兜底文案 */
function assistantLocalReply(q, ctx) {
  const text = String(q == null ? '' : q).toLowerCase();
  const has = (...ws) => ws.some(w => text.includes(w));
  const Li = arr => arr && arr.length ? arr.map((s, i) => (i + 1) + '. ' + s).join('\n') : '（暂无）';

  if (has('部位', '位置')) {
    const rows = Object.entries(ctx.bySite || {}).sort((a, b) => b[1] - a[1]);
    return '按施工部位统计的问题分布如下：\n' +
      (rows.length ? rows.map(([s, n], i) => (i + 1) + '. ' + s + '：' + n + ' 项').join('\n') : '（暂无记录）') +
      '\n建议对问题集中的部位加强专项巡查与整改闭环。';
  }
  if (has('人员', '提交人', '施工员是谁', '谁提交')) {
    const rows = Object.entries(ctx.byUser || {});
    return '按提交人统计的问题与待整改情况如下：\n' +
      (rows.length ? rows.map(([u, d], i) => (i + 1) + '. ' + u + '：共提交 ' + d.total + ' 项，待整改 ' + d.pending + ' 项').join('\n') : '（暂无记录）');
  }
  if (has('进度', '总体情况', '总览', '概况')) {
    const st = ctx.status || {};
    return '当前整改进度总览：\n- 问题总数：' + ctx.total + ' 项\n- 待审核：' + (st.pending || 0) + ' 项\n- 已确认待整改：' + (st.confirmed || 0) + ' 项\n- 整改中：' + (st.rectifying || 0) + ' 项\n- 已整改：' + (st.rectified || 0) + ' 项\n- 已销号：' + (st.closed || 0) + ' 项\n请按台账逐项落实整改并由审核员复核销号。';
  }
  if (has('搜索', '联网', '最新版', '新规')) {
    return '联网检索规范需要在线 AI 接口支持。请管理员在「AI 接口」页面配置 DeepSeek 接口地址与密钥后再试；也可直接到「规范查询」页面点击对应规范跳转权威平台在线查询。';
  }
  const doneQ = has('已整改') || has('已销号') || has('办结') || has('整改完成') || (has('整改') && has('完成'));
  const pendingQ = has('待整改') || has('整改中') || has('进展') || has('进度') || has('未完成');
  if (doneQ && !pendingQ) {
    return '当前已整改 / 已销号的问题共 ' + ctx.done.length + ' 项：\n' + Li(ctx.done);
  }
  if (pendingQ) {
    return '当前待整改 / 整改中的问题共 ' + ctx.pending.length + ' 项：\n' + Li(ctx.pending) + '\n请按台账逐项落实并请审核员复核销号。';
  }
  if (has('规范') || has('标准') || has('依据')) {
    return '当前收录的权威规范可点击「规范查询」查阅详情。节选如下：\n' + Li(ctx.regNames);
  }
  if (has('高频') || has('多发') || has('常见') || has('隐患') || has('风险')) {
    return '按台账统计，高频安全隐患 TOP：\n' + (ctx.hot.length ? ctx.hot.map((s, i) => (i + 1) + '. ' + s).join('\n') : '（暂无）') +
      '\n建议对照《水利水电工程施工安全管理导则》与《水利安全生产标准化通用规范》SL/T528 加强现场巡查与整改闭环。';
  }
  if (has('在线') || has('照片') || has('识别') || has('ai')) {
    return '照片隐患识别请到「上传隐患」上传现场照片，系统将调用 DeepSeek 多模态模型依据水利安全质量规范自动识别并生成整改意见。';
  }
  return '我可以帮你：1) 查询水利工程相关规范（可联网检索）；2) 查看待整改/已整改内容；3) 按部位、按人员统计问题；4) 查看整改进度总览；5) 分析高频安全隐患。支持多轮追问。';
}

module.exports = { buildLedgerContext, systemPromptForAssistant, assistantLocalReply, userNameById };