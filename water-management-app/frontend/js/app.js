/* ============================================================
 * 水利工程质量安全合规管理助手 —— 主逻辑
 * 纯前端静态应用，数据存于浏览器 localStorage
 * ============================================================ */

(function () {
  'use strict';
  const store = Store;
  const app = document.getElementById('app');
  const nav = document.getElementById('mainNav');
  const userBox = document.getElementById('userBox');
  const modalMask = document.getElementById('modalMask');
  const modalBox = document.getElementById('modalBox');
  const toastEl = document.getElementById('toast');

  let curUser = null;
  let toastTimer = null;

  /* ---------------- 启动 ----------------
    数据改由后端提供：初始从服务端拉取用户/台账/配置并恢复登录态。 */
  store.init().then(user => {
    curUser = user; /* 已登录则恢复，否则为 null 显示登录页 */
    render();
  }).catch(err => {
    /* 后端不可达：显示登录页并提示 */
    render();
    setTimeout(() => toast('⚠️ ' + (err && err.message || '无法连接后端服务')), 0);
  });

  /* ---------------- 工具 ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmtTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }
  function userNameById(id) {
    const u = store.listUsers().find(x => x.id === id);
    return u ? u.name : '未知';
  }

  /* ---------------- 渲染框架 ---------------- */
  function render() {
    renderNav();
    renderUserBox();
    if (!curUser) { renderLogin(); return; }
    const page = currentPage();
    if (page === 'home') renderHome();
    else if (page === 'upload') renderUpload();
    else if (page === 'audit') renderAudit();
    else if (page === 'ledger') renderLedger();
    else if (page === 'users' && curUser.role === 'admin') renderUsers();
    else if (page === 'regs') renderRegs();
    else if (page === 'assistant') renderAssistant();
    else if (page === 'ai') renderAI();
    else renderHome();
    window.scrollTo(0, 0);
  }

  function currentPage() {
    const p = sessionStorage.getItem('wm_page') || 'home';
    return p;
  }
  function go(page) {
    if (chatController) chatController.abort(); /* 切页时中断进行中的 AI 回复 */
    sessionStorage.setItem('wm_page', page);
    render();
  }

  function canSee(page) {
    if (!curUser) return false;
    // 上传隐患：施工员 / 审核员 / 管理员均可使用
    if (page === 'upload') return true;
    // 待审核：审核员、管理员（管理员拥有全部功能权限）
    if (page === 'audit') return curUser.role !== 'builder';
    // 用户管理 / AI 接口：仅管理员
    if (page === 'users' || page === 'ai') return curUser.role === 'admin';
    return true; // home / ledger / regs 所有人可见
  }

  function renderNav() {
    const items = [
      { id: 'home', label: '首页' },
      { id: 'upload', label: '上传隐患' },
      { id: 'audit', label: '待审核' },
      { id: 'ledger', label: '整改台账' },
      { id: 'assistant', label: 'AI 助手' },
      { id: 'regs', label: '规范查询' },
      { id: 'users', label: '用户管理' },
      { id: 'ai', label: 'AI接口' }
    ];
    nav.innerHTML = '';
    if (!curUser) return;
    const cur = currentPage();
    for (const it of items) {
      if (!canSee(it.id)) continue;
      const b = document.createElement('button');
      b.textContent = it.label;
      b.className = cur === it.id ? 'active' : '';
      b.onclick = () => go(it.id);
      nav.appendChild(b);
    }
  }

  function renderUserBox() {
    if (!curUser) { userBox.innerHTML = ''; return; }
    const r = ROLES[curUser.role];
    userBox.innerHTML = `
      <div class="user-chip">
        <span>👤 ${esc(curUser.name)}</span>
        <span class="role-badge" style="background:#fff;color:var(--water-700)">${r.label}</span>
      </div>
      <button class="btn btn-sm" onclick="AppLogout()">退出</button>`;
  }

  /* ---------------- 登录 ---------------- */
  function renderLogin() {
    app.innerHTML = `
      <div class="login-wrap">
        <div class="login-hero">
          <h2>🌊 水利工程质量安全合规管理助手</h2>
          <p>以 AI 影像识别赋能现场安全质量隐患排查 · 湖北建投水利水电工程有限公司</p>
        </div>
        <div class="login-body">
          <h3 style="color:var(--ink);margin-bottom:16px">账号登录</h3>
          <div class="field"><label>账号</label><input class="input" id="loginUser" placeholder="请输入账号" autocomplete="username"/></div>
          <div class="field"><label>密码</label><input class="input" id="loginPass" type="password" placeholder="请输入密码" autocomplete="current-password"/></div>
          <button class="btn btn-primary btn-lg" style="width:100%" id="loginBtn">登 录</button>
          <div class="hint-box">
            <strong>内置演示账号：</strong><br/>
            管理员 admin / admin123<br/>
            审核员 shenheyuan / sh123<br/>
            施工员 shigongyuan / sg123
          </div>
        </div>
      </div>`;
    const doLogin = async () => {
      const u = document.getElementById('loginUser').value;
      const p = document.getElementById('loginPass').value;
      if (!u || !p) { toast('请输入账号与密码'); return; }
      const btn = document.getElementById('loginBtn');
      if (btn) { btn.disabled = true; btn.textContent = '登录中…'; }
      try {
        const user = await store.login(u, p);
        curUser = user;
        render();
        toast('欢迎回来，' + user.name);
      } catch (e) {
        toast((e && e.message) || '登录失败');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
      }
    };
    document.getElementById('loginBtn').onclick = doLogin;
    document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  }

  window.AppLogout = () => {
    curUser = null;
    store.logout();
    sessionStorage.setItem('wm_page', 'home');
    render();
  };

  /* ---------------- 首页 ---------------- */
  function stats(issues) {
    return {
      total: issues.length,
      pending: issues.filter(i => i.status === 'pending').length,
      confirmed: issues.filter(i => i.status === 'confirmed' || i.status === 'rectifying').length,
      rectified: issues.filter(i => i.status === 'rectified' || i.status === 'closed').length,
      high: issues.filter(i => i.risk === 'high').length
    };
  }

  function renderHome() {
    const issues = store.listIssues();
    const s = stats(issues);
    const recent = issues.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6);

    const listHtml = recent.length
      ? recent.map(i => `
        <div class="card" style="cursor:pointer" onclick="goLedger('${i.id}')">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
            <div>
              <strong style="color:var(--ink);font-size:14.5px">${esc(i.title)}</strong>
              <div class="muted" style="margin-top:4px">${esc(i.site || '')} · ${fmtTime(i.createdAt)}</div>
            </div>
            <span class="badge ${RISK_META[i.risk]?.cls || 'low'}">${RISK_META[i.risk]?.label || '低'}风险</span>
          </div>
          <div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <span class="badge ${STATUS_META[i.status].cls}">${STATUS_META[i.status].label}</span>
            <span class="muted">提交人：${esc(userNameById(i.builderId))}</span>
          </div>
        </div>`).join('')
      : '<div class="empty">暂无问题记录</div>';

    app.innerHTML = `
      <div class="hero-band">
        <div class="waves"></div>
        <h2>湖北建投水利水电工程有限公司</h2>
        <p>恪守质量安全底线 · 以智能影像识别守护每一处涉水工程建设现场</p>
      </div>

      <div class="card" style="margin-bottom:22px">
        <h3><span class="icon">🏢</span> 公司简介</h3>
        <div class="company-intro">
          <p><strong>湖北建投水利水电工程有限公司</strong>（简称"湖北建投水利"）<strong>成立于2023年4月</strong>，注册资本<strong>10亿元</strong>，为<strong>湖北路桥集团全资子公司</strong>，具有<strong>水利水电工程施工总承包一级资质</strong>。</p>
          <p>公司立足湖北路桥深厚的工程建设底蕴（母公司具有公路工程施工总承包特级资质、工程设计公路行业甲级等配套资质，成立70余年来承建70多项国家、省重点工程，累计修建公路7000余公里、大型桥梁580余座），聚焦<strong>水利水电工程、水环境、水生态、全域国土整治、风光水储新能源、抽水蓄能、市政、建筑</strong>等领域的投资、技术咨询、施工、运营服务，致力于成为湖北水利建设领域的新锐力量，助力"<strong>荆楚安澜</strong>"现代水网建设。</p>
          <p>公司承载着湖北路桥集团"<strong>水利新赛道</strong>"的战略使命，着力打造"<strong>一流水利铁军</strong>"，坚持"立足湖北、走向全国、进军海外"的市场布局，探索推广<strong>智慧水利、数字孪生、生态护岸</strong>等技术应用，提升项目附加值，充分发挥湖北路桥集团"投建营一体化"产业链延伸模式的优势。</p>
          <p>公司严格落实水利工程安全质量技术规范，将<strong>安全生产与工程质量合规</strong>作为生命线，依托本系统智能影像识别与信息化台账闭环管理，推动隐患排查治理精准化、智能化。未来，公司将立足湖北路桥"工程建设全领域总承包商"发展定位，加快形成水利基础设施领域全生命周期、全产业链总集成能力，全力打造水利基础设施领域国内一流工程建设企业。</p>
        </div>
        <div class="tag-row">
          <span class="tag">💧 水利水电工程施工</span>
          <span class="tag">🌊 水环境·水生态治理</span>
          <span class="tag">🌾 全域国土整治</span>
          <span class="tag">⚡ 风光水储新能源·抽水蓄能</span>
          <span class="tag">🏗️ 市政·建筑工程</span>
          <span class="tag">📐 投资·咨询·运营一体化</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:22px">
        <h3><span class="icon">🏗️</span> 在建项目简介</h3>
        <p class="muted">公司先后参建武穴北灌区改扩建、宜昌玛瑙河流域国土综合整治、孝感老观湖泵站新建等省市重点项目如下：</p>
        <div class="grid cols-3" style="margin-top:14px">
          <div class="reg-card"><strong style="color:var(--ink)">🏞️ 武穴北灌区改扩建工程</strong><div class="muted" style="margin-top:6px">设计施工采购总承包（EPC）项目</div></div>
          <div class="reg-card"><strong style="color:var(--ink)">🌾 宜昌市玛瑙河流域全域国土综合整治工程</strong><div class="muted" style="margin-top:6px">国土综合整治、水系治理与生态修复</div></div>
          <div class="reg-card"><strong style="color:var(--ink)">⚙️ 孝感市老观湖泵站新建工程</strong><div class="muted" style="margin-top:6px">泵站新建、机电安装与配套渠系</div></div>
          <div class="reg-card"><strong style="color:var(--ink)">💧 华容区杨巷中型灌区续建配套与节水改造工程</strong><div class="muted" style="margin-top:6px">设计施工采购总承包（EPC）项目</div></div>
          <div class="reg-card"><strong style="color:var(--ink)">🔄 汉川市龚家湾泵站更新改造工程</strong><div class="muted" style="margin-top:6px">泵站更新改造、设备更换与调试</div></div>
          <div class="reg-card"><strong style="color:var(--ink)">🌾 监利市高标准农田建设项目</strong><div class="muted" style="margin-top:6px">高标准农田建设、灌排体系配套</div></div>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="num">${s.total}</div><div class="label">问题总数</div></div>
        <div class="stat-card"><div class="num">${s.pending}</div><div class="label">待审核</div></div>
        <div class="stat-card"><div class="num">${s.confirmed}</div><div class="label">确认/整改中</div></div>
        <div class="stat-card"><div class="num">${s.rectified}</div><div class="label">已整改销号</div></div>
        <div class="stat-card"><div class="num" style="color:var(--danger)">${s.high}</div><div class="label">高风险项</div></div>
      </div>

      <div class="section-title">📋 问题及整改情况预览 <span class="muted" style="font-size:13px;font-weight:400">（点击卡片跳转整改台账）</span></div>
      <div class="grid cols-2" id="previewGrid">${listHtml}</div>`;
    renderMiniBars();
  }
  function goLedger(id) {
    sessionStorage.setItem('wm_page', 'ledger');
    sessionStorage.setItem('wm_issue_focus', id);
    render();
  }

  /* 首页简易图表（用 div 做横条） */
  function renderMiniBars() {
    const issues = store.listIssues();
    const total = issues.length || 1;
    const before = issues.filter(i => i.status === 'pending' || i.status === 'confirmed').length;
    const done = issues.filter(i => i.status === 'rectified' || i.status === 'closed').length;
    const pct = (done / total * 100).toFixed(1);
    app.insertAdjacentHTML('beforeend', `
      <div class="card" style="margin-top:22px">
        <h3><span class="icon">📊</span> 整改闭合情况</h3>
        <div style="height:18px;border-radius:999px;background:var(--water-100);overflow:hidden;margin:6px 0 10px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--ok),#3fd0a0);border-radius:999px"></div>
        </div>
        <div style="display:flex;gap:24px;font-size:13.5px;flex-wrap:wrap">
          <span>已完成并销号：<strong style="color:var(--ok)">${done}</strong> 项（${pct}%）</span>
          <span>办理中：<strong style="color:var(--warn)">${before}</strong> 项</span>
          <span class="link" onclick="go('ledger')">进入整改台账 →</span>
        </div>
      </div>`);
  }

  /* ---------------- 上传隐患（施工员） ---------------- */
  function renderUpload() {
    app.innerHTML = `
      <div class="section-title">📸 上传施工现场照片，AI 智能识别隐患</div>
      <div class="card">
        <h3><span class="icon">🧠</span> AI 影像识别</h3>
        <p class="muted">上传现场照片后，系统将调用 <strong>DeepSeek 多模态模型</strong>（deepseek-flash），依据水利工程安全、质量技术规范自动识别隐患并生成整改意见。AI 不确定的项会提示<strong style="color:var(--warn)">“需现场核实”</strong>，请施工员实地确认。</p>

        <div class="field" style="margin-top:14px">
          <label>隐患标题</label>
          <input class="input" id="upTitle" placeholder="如：堤防迎水侧临边高处作业无防护" />
        </div>
        <div class="field">
          <label>施工部位 / 位置</label>
          <input class="input" id="upSite" placeholder="如：#3 闸室上游围堰右侧" />
        </div>
        <div class="field">
          <label>现场补充说明（可选，可帮助AI更准确判断）</label>
          <textarea class="input" id="upNote" placeholder="可描述现场环境、作业内容等，较多张照片时AI可能抽样识别"></textarea>
        </div>

        <div class="field">
          <label>上传现场照片（可多选，支持 jpg/png）</label>
          <div class="dropzone" id="dropzone">
            <div style="font-size:34px">📷</div>
            <p style="font-weight:600">点击选择照片，或拖拽到此处</p>
            <p class="muted">不超过 6 张，每张会自动压缩以利于上传识别</p>
            <input type="file" id="fileInput" accept="image/*" multiple style="display:none" />
          </div>
          <div class="photo-previews" id="upPhotos"></div>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary btn-lg" id="analyzeBtn">🚀 开始 AI 识别</button>
          <button class="btn btn-ghost btn-lg" onclick="go('home')">返回</button>
        </div>
        <div id="upResult"></div>
      </div>`;

    let photos = [];
    const previews = document.getElementById('upPhotos');
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');

    function addFiles(files) {
      const arr = Array.from(files);
      for (const f of arr) {
        if (photos.length >= 6) { toast('最多上传6张'); break; }
        if (!/^image\//.test(f.type)) continue;
        const reader = new FileReader();
        reader.onload = e => {
          const src = e.target.result;
          compressImage(src, img => { photos.push(img); draw(); });
        };
        reader.readAsDataURL(f);
      }
    }
    dropzone.onclick = () => fileInput.click();
    fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ''; };
    dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = e => { e.preventDefault(); dropzone.classList.remove('dragover'); addFiles(e.dataTransfer.files); };

    function draw() {
      previews.innerHTML = photos.map((p, i) => `
        <div class="ph"><img src="${p}" alt="照片${i+1}"/><button class="del" data-i="${i}">✕</button></div>`).join('');
      previews.querySelectorAll('.del').forEach(b => b.onclick = () => { photos.splice(+b.dataset.i, 1); draw(); });
    }

    document.getElementById('analyzeBtn').onclick = async () => {
      const title = document.getElementById('upTitle').value.trim();
      const site = document.getElementById('upSite').value.trim();
      const note = document.getElementById('upNote').value.trim();
      const resultEl = document.getElementById('upResult');
      const btn = document.getElementById('analyzeBtn');
      if (!title) { toast('请填写隐患标题'); return; }
      if (!photos.length) { toast('请至少上传一张图片'); return; }
      btn.disabled = true;
      resultEl.innerHTML = `<div class="ai-result"><span class="loader"></span> AI 正在识别照片中的安全隐患，通常需要十几秒至一分钟，请耐心等待……</div>`;
      try {
        const aiResult = await AI.analyze(photos, note);
        renderAIResult(resultEl, { title, site, note, aiResult, photos });
      } catch (e) {
        resultEl.innerHTML = `<div class="ai-result" style="border-color:var(--danger)">识别失败：${esc(e.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    };
  }

  /* 压缩图片到适合上传与存储的尺寸 */
  function compressImage(dataUrl, cb) {
    const img = new Image();
    img.onload = () => {
      const MAX = 900;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const r = Math.max(w, h);
        w = Math.round(w * MAX / r); h = Math.round(h * MAX / r);
      }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      cb(cv.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => cb(dataUrl);
    img.src = dataUrl;
  }

  function renderAIResult(container, { title, site, note, aiResult, photos }) {
    if (aiResult.fallback && aiResult.error) {
      container.innerHTML = `<div class="ai-result" style="border-color:var(--warn)">
        <p>⚠️ <strong>AI 在线识别暂不可用</strong>：${esc(aiResult.error)}</p>
        <p class="muted">已启用本地规则提示，请施工员务必现场核实每一项。<button class="link" style="background:none;border:none" onclick="openAISettings()">前往配置 AI 接口 →</button></p>
      </div>`;
    }
    const risks = aiResult.risks || [];
    const riskCards = risks.map((r, i) => `
      <div class="risk-item ${r.uncertain ? '' : 'suggest'}" style="${r.uncertain ? '' : 'border-left-color:var(--ok)'}">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <strong style="color:var(--ink)">${i + 1}. ${esc(r.title)}</strong>
          <span class="badge ${RISK_META[r.level]?.cls || 'low'}">${RISK_META[r.level]?.label || '低'}风险</span>
        </div>
        <div class="muted" style="margin-top:5px">${esc(r.description || '')}</div>
        <div style="margin-top:6px;font-size:13px">📖 规范依据：${esc(r.rule || '—')}</div>
        <div style="margin-top:6px;font-size:13px">🛠️ 整改措施：${esc(r.action || '—')}</div>
        ${r.uncertain ? '<div style="margin-top:6px"><span class="badge medium">需现场核实</span> <span class="muted">该隐患 AI 判断把握不足，请在下方勾选并经现场核实后确认。</span></div>' : ''}
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;cursor:pointer">
          <input type="checkbox" class="risk-confirm" data-i="${i}" checked> 我已在现场核实，确认并入台账
        </label>
      </div>`).join('');

    container.innerHTML = `
      <div class="ai-result">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <strong style="color:var(--ink);font-size:16px">🔍 AI 识别结果</strong>
          <span class="muted">AI评估：${esc(aiResult.summary || '')}</span>
        </div>
        ${riskCards || '<div class="empty">未识别出明确隐患</div>'}
        <div class="form-actions" style="margin-top:12px">
          <button class="btn btn-success btn-lg" id="submitIssue">✅ 全部确认并提交审核员</button>
          <button class="btn btn-ghost" id="redoBtn">重新识别</button>
        </div>
      </div>`;
    document.getElementById('redoBtn').onclick = () => renderUpload();

    document.getElementById('submitIssue').onclick = () => {
      const kept = risks.filter((r, i) => [...document.querySelectorAll('.risk-confirm')].some((c) => c.checked && +c.dataset.i === i));
      if (!kept.length) { toast('请至少确认一项隐患'); return; }
      const maxRisk = ['high', 'medium', 'low'].find(lv => kept.some(r => r.level === lv)) || 'medium';
      const issue = store.saveIssue({
        id: Store.uid(),
        title: title || '未命名隐患',
        site: site || '',
        note: note || '',
        photos: photos.slice(0, 4),
        risks: kept,
        summary: aiResult.summary || '',
        risk: maxRisk,
        status: 'pending',
        builderId: curUser.id,
        auditorId: null,
        aiFallback: !!aiResult.fallback,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        history: [
          { t: '提交审核', by: curUser.id, at: Date.now(), content: '施工员提交，等待审核员确认' }
        ]
      });
      toast('已提交，等待审核员确认');
      go('ledger');
      sessionStorage.setItem('wm_issue_focus', issue.id);
      render();
    };
  }

  /* ---------------- 待审核（审核员） ---------------- */
  function renderAudit() {
    const list = store.listIssues().filter(i => i.status === 'pending')
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    app.innerHTML = `
      <div class="section-title">🕵️ 待审核清单 <span class="muted" style="font-size:13px">审核员确认后形成整改台账</span></div>
      <div id="auditList">${list.length
        ? list.map(issueCard.bind(null, 'audit')).join('')
        : '<div class="card empty">暂无待审核的问题</div>'}</div>`;
  }

  function issueCard(mode, i) {
    const s = STATUS_META[i.status];
    return `
      <div class="card" style="margin-bottom:16px" id="issue_${i.id}">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <strong style="color:var(--ink);font-size:16px">${esc(i.title)}</strong>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <span class="badge ${RISK_META[i.risk]?.cls||'low'}">${RISK_META[i.risk]?.label||'低'}风险</span>
            <span class="badge ${s.cls}">${s.label}</span>
          </div>
        </div>
        <div class="muted" style="margin:4px 0 8px">${esc(i.site||'未填部位')} · ${fmtTime(i.createdAt)} · 提交人：${esc(userNameById(i.builderId))}${i.note ? ' · 说明：' + esc(i.note) : ''}${i.aiFallback ? ' · <span style="color:var(--warn)">本地识别</span>' : ''}</div>
        ${i.photos && i.photos.length ? `<div class="photo-previews">${i.photos.map(p=>`<div class="ph"><img src="${p}"/></div>`).join('')}</div>` : '<div class="muted">未附照片</div>'}
        <div style="margin-top:10px">
          ${(i.risks||[]).map((r,ix)=>`
            <div class="risk-item ${r.uncertain?'':'suggest'}" style="${r.uncertain?'':'border-left-color:var(--ok)'}">
              <div style="display:flex;justify-content:space-between;gap:8px"><strong>${ix+1}. ${esc(r.title)}</strong><span class="badge ${RISK_META[r.level]?.cls||'low'}">${RISK_META[r.level]?.label||'低'}</span></div>
              <div style="margin-top:4px">📖 ${esc(r.rule||'—')}</div>
              <div>🛠️ ${esc(r.action||'—')}</div>
              ${r.uncertain?'<span class="badge medium" style="margin-top:4px">需现场核实</span>':''}
            </div>`).join('')}
        </div>
        <div class="form-actions" style="margin-top:12px">${actionsFor(i, mode)}</div>
      </div>`;
  }

  /* 根据角色与状态给出操作按钮 */
  function actionsFor(i, mode) {
    const b = [];
    if (i.status === 'pending' && mode === 'audit') {
      b.push(`<button class="btn btn-success btn-sm" onclick="ApprConfirmIssue('${i.id}')">✅ 确认入台账</button>`);
      b.push(`<button class="btn btn-warn btn-sm" onclick="ApprEditIssue('${i.id}')">✏️ 修改意见</button>`);
    }
    if (i.status === 'confirmed') {
      b.push(`<button class="btn btn-warn btn-sm" onclick="ApprStartRectify('${i.id}')">🔧 开始整改</button>`);
    }
    if (i.status === 'rectifying') {
      b.push(`<button class="btn btn-success btn-sm" onclick="ApprMarkRectified('${i.id}')">✅ 标记已整改</button>`);
    }
    if (i.status === 'rectified') {
      b.push(`<button class="btn btn-secondary btn-sm" onclick="ApprCloseIssue('${i.id}')">🔒 销号</button>`);
    }
    // 台账编辑：审核员与管理员可编辑（删除、修改）
    if (mode === 'ledger' && (curUser.role === 'auditor' || curUser.role === 'admin')) {
      b.push(`<button class="btn btn-secondary btn-sm" onclick="ApprEditIssue('${i.id}')">✏️ 编辑台账</button>`);
    }
    // 施工员、审核员、管理员均可删除
    if (curUser.role === 'builder' || curUser.role === 'auditor' || curUser.role === 'admin') {
      b.push(`<button class="btn btn-danger-ghost btn-sm" onclick="ApprDeleteIssue('${i.id}')">🗑️ 删除</button>`);
    }
    return b.join('');
  }

  /* 审核通过 → confirmed。通过后端状态流转接口推进台账并记录审计历史，保证角色权限一致。 */
  window.ApprConfirmIssue = (id) => {
    store.transitionIssue(id, 'confirmed');
    toast('已确认并入台账');
    render();
  };

  window.ApprStartRectify = (id) => {
    store.transitionIssue(id, 'rectifying');
    toast('已下达整改，进入整改中'); render();
  };
  window.ApprMarkRectified = (id) => {
    store.transitionIssue(id, 'rectified');
    toast('已标记整改完成'); render();
  };
  window.ApprCloseIssue = (id) => {
    store.transitionIssue(id, 'closed');
    toast('已完成销号'); render();
  };
  window.ApprDeleteIssue = (id) => {
    openConfirm('确定删除该问题记录？删除后不可恢复。', () => {
      store.deleteIssue(id); toast('已删除'); render();
    });
  };

  /* 修改/编辑台账（审核员、管理员） */
  window.ApprEditIssue = (id) => {
    const i = store.getIssue(id);
    if (!i) return;
    openModal(`
      <h3>✏️ 编辑问题与整改台账</h3>
      <div class="field"><label>隐患标题</label><input class="input" id="edTitle" value="${esc(i.title)}"/></div>
      <div class="field"><label>风险等级</label>
        <select class="input" id="edRisk">
          ${Object.keys(RISK_META).map(k=>`<option value="${k}" ${i.risk===k?'selected':''}>${RISK_META[k].label}风险</option>`).join('')}
        </select></div>
      <div class="field"><label>处理状态</label>
        <select class="input" id="edStatus">
          ${Object.keys(STATUS_META).map(k=>`<option value="${k}" ${i.status===k?'selected':''}>${STATUS_META[k].label}</option>`).join('')}
        </select></div>
      <div class="field"><label>整改意见（可增补/修改）</label>
        <textarea class="input" id="edAction" rows="3">${esc((i.risks||[]).map(r=>'· '+(r.title)+'：'+(r.action||'')).join('\n'))}</textarea></div>
      <div class="form-actions">
        <button class="btn btn-primary" id="edSave">保存</button>
        <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      </div>`);
    document.getElementById('edSave').onclick = () => {
      i.title = document.getElementById('edTitle').value.trim() || i.title;
      i.risk = document.getElementById('edRisk').value;
      i.status = document.getElementById('edStatus').value;
      const ta = document.getElementById('edAction').value;
      if (ta.trim()) {
        const lines = ta.split('\n').map(l=>l.trim()).filter(Boolean);
        i.risks = lines.map((l,ix)=>({
          title: ('整改项' + (ix+1)), action: l.replace(/^[·\-]\s*/, ''), rule: '', description: '', level: i.risk||'medium', uncertain:false
        }));
        i.summary = '台账已由审核员编辑调整';
      }
      i.history.push({ t: '台账编辑', by: curUser.id, at: Date.now(), content: '审核员/管理员编辑了台账' });
      store.saveIssue(i);
      closeModal(); toast('台账已更新'); render();
    };
  };

  /* ---------------- 整改台账（所有人可见，含流转） ---------------- */
  function renderLedger() {
    const focus = sessionStorage.getItem('wm_issue_focus') || '';
    sessionStorage.removeItem('wm_issue_focus');
    const issues = store.listIssues().sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    const rows = issues.map(i => `
      <div id="row_${i.id}">${issueCard('ledger', i)}</div>`).join('');
    app.innerHTML = `
      <div class="section-title">📋 问题与整改台账 <span class="muted" style="font-size:13px">施工员在此反馈整改进度，审核员/管理员可维护</span></div>
      <div id="ledgerList">${issues.length ? rows : '<div class="card empty">台账为空</div>'}</div>`;
    if (focus) {
      const el = document.getElementById('issue_' + focus);
      if (el) { el.style.boxShadow = '0 0 0 3px var(--warn)'; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }
  }

  // 提供整改进度反馈的表单（施工员侧附加）
  window.AppendRectifyNote = null; // 预留：施工员可追加整改说明

  /* ---------------- 用户管理（管理员） ---------------- */
  function renderUsers() {
    const users = store.listUsers();
    app.innerHTML = `
      <div class="section-title">👥 用户与权限管理 <span class="muted" style="font-size:13px">管理员可为用户赋予管理员/审核员/施工员身份</span></div>
      <div class="card" style="margin-bottom:18px">
        <h3><span class="icon">➕</span> 新增用户</h3>
        <div class="field" style="display:inline-block;vertical-align:top;margin-right:10px;width:200px"><label>账号</label><input class="input" id="nuUser"/></div>
        <div class="field" style="display:inline-block;vertical-align:top;margin-right:10px;width:200px"><label>姓名</label><input class="input" id="nuName"/></div>
        <div class="field" style="display:inline-block;vertical-align:top;margin-right:10px;width:200px"><label>初始密码</label><input class="input" id="nuPass" value="123456"/></div>
        <div class="field" style="display:inline-block;vertical-align:top;width:160px"><label>身份</label>
          <select class="input" id="nuRole"><option value="builder">施工员</option><option value="auditor">审核员</option><option value="admin">管理员</option></select></div>
        <div><button class="btn btn-primary" id="nuAdd">创建用户</button></div>
      </div>
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr><th>姓名</th><th>账号</th><th width="90">身份</th><th width="170">调整身份</th><th width="120">操作</th></tr></thead>
          <tbody>
            ${users.map(u=>`
              <tr>
                <td>${esc(u.name)}</td><td>${esc(u.username)}</td>
                <td><span class="badge ${ROLES[u.role].badge}">${ROLES[u.role].label}</span></td>
                <td>
                  <select class="input" style="padding:5px;font-size:12.5px" onchange="ApprSetRole('${u.id}', this.value)">
                    ${Object.keys(ROLES).map(k=>`<option value="${k}" ${u.role===k?'selected':''}>${ROLES[k].label}</option>`).join('')}
                  </select>
                </td>
                <td>${u.id === curUser.id ? '<span class="muted">当前账号</span>' : `<button class="btn btn-danger-ghost btn-sm" onclick="ApprDelUser('${u.id}')">删除</button>`}</td>
              </tr>`).join('')}
          </tbody></table></div>
      </div>`;
    document.getElementById('nuAdd').onclick = () => {
      const un = document.getElementById('nuUser').value.trim();
      const nm = document.getElementById('nuName').value.trim();
      const pw = document.getElementById('nuPass').value || '123456';
      const role = document.getElementById('nuRole').value;
      if (!un || !nm) { toast('请填写账号与姓名'); return; }
      if (store.findByUsername(un)) { toast('该账号已存在'); return; }
      store.createUser({ username: un, name: nm, password: pw, role, phone: '' });
      toast('用户已创建'); render();
    };
  }
  window.ApprSetRole = (id, role) => {
    const u = store.listUsers().find(x => x.id === id);
    if (!u) return;
    u.role = role; store.saveUser(u); toast('身份已更新为「' + ROLES[role].label + '」');
  };
  window.ApprDelUser = (id) => {
    openConfirm('确定删除该用户？', () => { store.deleteUser(id); toast('已删除'); render(); });
  };

  /* ---------- 台账上下文（供 AI 助手引用真实数据） ---------- */
  function buildLedgerContext() {
    const issues = store.listIssues();
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
  function assistantLocalReply(q, ctx) {
    const text = String(q == null ? '' : q).toLowerCase();
    const has = (...ws) => ws.some(w => text.includes(w));
    const L = arr => arr && arr.length ? arr.map((s, i) => (i + 1) + '. ' + s).join('\n') : '（暂无）';
    /* 按部位统计 */
    if (has('部位', '位置')) {
      const rows = Object.entries(ctx.bySite || {}).sort((a, b) => b[1] - a[1]);
      return '按施工部位统计的问题分布如下：\n' +
        (rows.length ? rows.map(([s, n], i) => (i + 1) + '. ' + s + '：' + n + ' 项').join('\n') : '（暂无记录）') +
        '\n建议对问题集中的部位加强专项巡查与整改闭环。';
    }
    /* 按人员统计 */
    if (has('人员', '提交人', '施工员是谁', '谁提交')) {
      const rows = Object.entries(ctx.byUser || {});
      return '按提交人统计的问题与待整改情况如下：\n' +
        (rows.length ? rows.map(([u, d], i) => (i + 1) + '. ' + u + '：共提交 ' + d.total + ' 项，待整改 ' + d.pending + ' 项').join('\n') : '（暂无记录）');
    }
    /* 整改进度总览 */
    if (has('进度', '总体情况', '总览', '概况')) {
      const st = ctx.status || {};
      return '当前整改进度总览：\n- 问题总数：' + ctx.total + ' 项\n- 待审核：' + (st.pending || 0) + ' 项\n- 已确认待整改：' + (st.confirmed || 0) + ' 项\n- 整改中：' + (st.rectifying || 0) + ' 项\n- 已整改：' + (st.rectified || 0) + ' 项\n- 已销号：' + (st.closed || 0) + ' 项\n请按台账逐项落实整改并由审核员复核销号。';
    }
    /* 联网搜索类 */
    if (has('搜索', '联网', '最新版', '新规')) {
      return '联网检索规范需要在线 AI 接口支持。请管理员在「AI 接口」页面配置 DeepSeek 接口地址与密钥后再试；也可直接到「规范查询」页面点击对应规范跳转权威平台在线查询。';
    }
    const doneQ = has('已整改') || has('已销号') || has('办结') || has('整改完成') || (has('整改') && has('完成'));
    const pendingQ = has('待整改') || has('整改中') || has('进展') || has('进度') || has('未完成');
    if (doneQ && !pendingQ) {
      return '当前已整改 / 已销号的问题共 ' + ctx.done.length + ' 项：\n' + L(ctx.done);
    }
    if (pendingQ) {
      return '当前待整改 / 整改中的问题共 ' + ctx.pending.length + ' 项：\n' + L(ctx.pending) + '\n请按台账逐项落实并请审核员复核销号。';
    }
    if (has('规范') || has('标准') || has('依据')) {
      return '当前收录的权威规范可点击「规范查询」查阅详情。节选如下：\n' + L(ctx.regNames);
    }
    if (has('高频') || has('多发') || has('常见') || has('隐患') || has('风险')) {
      return '按台账统计，高频安全隐患 TOP：\n' + (ctx.hot.length ? ctx.hot.map((s, i) => (i + 1) + '. ' + s).join('\n') : '（暂无）') +
        '\n建议对照《水利水电工程施工安全管理导则》与《水利安全生产标准化通用规范》SL/T528 加强现场巡查与整改闭环。';
    }
    if (has('在线') || has('照片') || has('识别') || has('ai')) {
      return '照片隐患识别请到「上传隐患」上传现场照片，系统将调用 DeepSeek 多模态模型依据水利安全质量规范自动识别并生成整改意见。';
    }
    return '我可以帮你：1) 查询水利工程相关规范（可联网检索）；2) 查看待整改/已整改内容；3) 按部位、按人员统计问题；4) 查看整改进度总览；5) 分析高频安全隐患。支持多轮追问，例如先问“当前有哪些待整改项？”，再问“其中高风险的详细说说”。';
  }

  /* ---------------- AI 助手（DeepSeek 驱动：多轮对话 + 流式输出 + 联网检索规范） ---------------- */
  let chatController = null; /* 「停止生成」用的 AbortController */
  let chatBusy = false;
  /* 命中以下关键词时自动联网检索（可在界面关闭） */
  const CHAT_SEARCH_RE = /规范|标准|规程|法规|条例|导则|办法|最新|新规|修订|废止|替代|现行|发布|施行|实施|SL\s?\d|GB\s?T?\s?\d|JGJ\s?\d|DL\/T/i;

  function renderAssistant() {
    const webOn = sessionStorage.getItem('wm_chat_web') !== 'off';
    const quickBtns = [
      ['📖 规范清单', '水利工程质量安全常用规范有哪些？'],
      ['📋 待整改内容', '当前有哪些待整改内容？'],
      ['✅ 已整改内容', '已经整改完成的内容有哪些？'],
      ['⚠️ 高频隐患', '现场高频安全隐患有哪些？'],
      ['📍 按部位统计', '按施工部位统计一下问题分布情况'],
      ['👷 按人员统计', '按提交人统计问题提交与整改情况'],
      ['📊 整改进度', '当前整改进度总体情况如何？'],
      ['🌐 搜最新规范', '请联网搜索《水利水电工程施工通用安全技术规程》SL398 的最新版本状态与适用要点']
    ];
    app.innerHTML = `
      <div class="section-title">🤖 AI 质量安全助手
        <span class="muted" style="font-size:13px">DeepSeek 驱动 · 支持多轮追问 · 自动联网检索规范 · 回答基于真实台账数据</span>
      </div>
      <div class="card" style="display:flex;flex-direction:column;min-height:580px">
        <div class="chat-quick">
          ${quickBtns.map(([label, q]) =>
            `<button class="btn btn-secondary btn-sm" onclick="QuickAsk('${q.replace(/'/g, "\\'")}')">${label}</button>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <label style="display:flex;gap:7px;align-items:center;font-size:13px;color:var(--muted);cursor:pointer">
            <input type="checkbox" id="chatWeb" ${webOn ? 'checked' : ''} onchange="ChatWebToggle(this.checked)"/>
            🌐 联网检索规范（询问规范/标准/最新动态时自动搜索权威来源）
          </label>
          <button class="btn btn-ghost btn-sm" onclick="ChatClear()">🗑️ 清空对话</button>
        </div>
        <div id="chatSearchTip" class="search-tip" style="display:none"><span class="loader"></span> 正在联网检索相关规范资料……</div>
        <div id="chatLog" class="chat-log" style="flex:1"></div>
        <div class="chat-input-row">
          <input class="input" id="chatInput" placeholder="输入你的问题，支持追问，如：其中高风险的详细说说" onkeydown="ChatEnter(event)"/>
          <button class="btn btn-primary" id="chatSend">发送</button>
          <button class="btn btn-warn" id="chatStop" style="display:none">⏹ 停止</button>
        </div>
      </div>`;
    const hist = store.getChatHistory();
    if (hist.length) hist.forEach(m => appendChatMsg(m.role, m.content));
    else appendChatMsg('assistant',
      '你好，我是质量安全管理 AI 助手（DeepSeek 驱动）。当前台账共 ' + store.listIssues().length + ' 条问题记录。\n\n' +
      '**我可以帮你：**\n' +
      '- 查询水利工程规范（自动联网检索最新版本动态）\n' +
      '- 查询待整改 / 已整改内容，按部位、按人员统计\n' +
      '- 分析高频安全隐患与整改进度\n\n' +
      '支持多轮追问，例如先问“当前有哪些待整改项？”，再追问“其中高风险的详细说说”。');
    document.getElementById('chatSend').onclick = () => sendChat();
    document.getElementById('chatStop').onclick = () => { if (chatController) chatController.abort(); };
    scrollChatBottom();
  }

  /* 追加一条消息气泡；assistant 消息以 Markdown 渲染 */
  function appendChatMsg(role, content) {
    const log = document.getElementById('chatLog');
    if (!log) return null;
    const box = document.createElement('div');
    box.className = 'chat-msg ' + (role === 'user' ? 'user' : 'assistant');
    if (role === 'user') {
      box.textContent = content;
    } else {
      const body = document.createElement('div');
      body.className = 'md-body';
      body.innerHTML = MD.toHtml(content);
      box.appendChild(body);
    }
    log.appendChild(box);
    return box;
  }

  function scrollChatBottom() {
    const log = document.getElementById('chatLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function setChatBusyUI(busy) {
    const send = document.getElementById('chatSend');
    const stop = document.getElementById('chatStop');
    const input = document.getElementById('chatInput');
    if (send) { send.disabled = busy; send.textContent = busy ? '回复中…' : '发送'; }
    if (stop) stop.style.display = busy ? '' : 'none';
    if (input) input.disabled = busy;
  }

  async function sendChat(preset) {
    if (chatBusy) { toast('AI 正在回复中，可点击“停止”中断'); return; }
    const input = document.getElementById('chatInput');
    const q = (preset != null ? preset : (input ? input.value : '')).trim();
    if (!q) return;
    if (input) input.value = '';
    appendChatMsg('user', q);
    store.pushChatMessage({ role: 'user', content: q });
    chatBusy = true;
    setChatBusyUI(true);
    scrollChatBottom();

    /* 1) 规范/标准类问题 → 先联网检索（DeepSeek Search API，失败静默降级） */
    let searchResults = null;
    const webOn = sessionStorage.getItem('wm_chat_web') !== 'off';
    if (webOn && CHAT_SEARCH_RE.test(q)) {
      const tip = document.getElementById('chatSearchTip');
      if (tip) tip.style.display = '';
      searchResults = await AI.searchWeb(q);
      if (tip) tip.style.display = 'none';
    }

    /* 2) 组装多轮消息：动态 system（台账快照 + 检索结果）+ 最近若干轮历史 */
    const ctx = buildLedgerContext();
    const sys = systemPromptForAssistant(ctx, searchResults);
    const hist = store.getChatHistory();
    const messages = [
      { role: 'system', content: sys },
      ...hist.slice(-11).map(m => ({ role: m.role, content: m.content }))
    ];

    /* 3) 流式输出：增量渲染纯文本，完成后整体渲染 Markdown */
    const bubble = appendChatMsg('assistant', '');
    if (bubble) bubble.classList.add('streaming');
    chatController = new AbortController();
    let finalText = '';
    try {
      const r = await AI.chatStream(messages, (piece, full) => {
        const body = bubble && bubble.querySelector('.md-body');
        if (body) body.textContent = full;
        scrollChatBottom();
      }, chatController.signal);
      finalText = r.text;
      if (r.aborted && finalText) finalText += '\n\n*（已手动停止生成）*';
    } catch (e) {
      /* 流式失败 → 非流式多轮请求兜底（部分中转不支持 SSE） */
      try {
        finalText = await AI.chat(messages);
      } catch (e2) {
        finalText = assistantLocalReply(q, ctx) +
          '\n\n（注：AI 在线接口暂不可用，以上为本机台账统计生成的回答。可在「AI 接口」页配置在线接口。）';
      }
    }
    chatController = null;
    if (bubble) {
      bubble.classList.remove('streaming');
      const body = bubble.querySelector('.md-body');
      if (finalText && body) body.innerHTML = MD.toHtml(finalText);
      else if (!finalText) bubble.remove();
    }
    if (finalText) store.pushChatMessage({ role: 'assistant', content: finalText });
    chatBusy = false;
    setChatBusyUI(false);
    scrollChatBottom();
  }
  window.QuickAsk = (q) => sendChat(q);
  window.ChatEnter = (e) => { if (e.key === 'Enter') sendChat(); };
  window.ChatWebToggle = (on) => {
    sessionStorage.setItem('wm_chat_web', on ? 'on' : 'off');
    toast(on ? '已开启联网检索' : '已关闭联网检索');
  };
  window.ChatClear = () => openConfirm('确定清空全部对话记录？清空后不可恢复。', () => {
    store.clearChatHistory(); toast('对话已清空'); render();
  });

  /* ---------------- 规范查询 ---------------- */
  function renderRegs() {
    const norm = s => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, '');
    const kw = norm(sessionStorage.getItem('wm_reg_kw') || '');
    const cat = sessionStorage.getItem('wm_reg_cat') || '全部';
    const cats = ['全部', ...new Set(REGULATIONS.map(r => r.category))];
    const list = REGULATIONS.filter(r =>
      (cat === '全部' || r.category === cat) &&
      (norm(r.name).includes(kw) || norm(r.src || '').includes(kw))
    );
    const chips = cats.map(c => `
      <button class="btn btn-sm ${c === cat ? 'btn-primary' : 'btn-ghost'}" style="margin:0 6px 6px 0"
        onclick="RegFilter('${c}')">${esc(c)}</button>`).join('');
    const cards = list.map(r => `
      <div class="reg-card">
        <div class="reg-name">📘 <a href="${r.link}" target="_blank" rel="noopener">${esc(r.name)}</a>
          <span class="badge low" style="margin-left:6px">${esc(r.category || '')}</span></div>
        <div class="reg-desc">来源：${esc(r.src || '—')} · 点击下方按钮跳转到权威平台在线查询该规范。</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn btn-secondary btn-sm" href="${r.link}" target="_blank" rel="noopener">🔍 在线查询</a>
          <span class="muted" style="line-height:26px">${esc(r.link)}</span>
        </div>
      </div>`).join('');
    app.innerHTML = `
      <div class="section-title">📖 水利工程规范查询 <span class="muted" style="font-size:13px">共 ${REGULATIONS.length} 部 · 点击即跳转权威来源查询</span></div>
      <div class="card" style="margin-bottom:18px">
        <div class="field" style="margin:0"><input class="input" id="regKw" placeholder="输入规范名称 / 编号关键字过滤，如：质量 / 安全 / 施工 / SL176" value="${esc(sessionStorage.getItem('wm_reg_kw') || '')}"/></div>
        <div class="tag-row">${chips}</div>
        <div class="muted" style="margin-top:8px">数据来源：全国标准信息公共服务平台（含水利部归口行业标准 SL）、国家法律法规数据库、住建部等行业/国标权威渠道。点击「在线查询」将打开对应权威平台的检索结果页。</div>
      </div>
      <div class="grid cols-3">${cards || '<div class="empty">无匹配结果</div>'}</div>`;
    document.getElementById('regKw').addEventListener('input', e => {
      sessionStorage.setItem('wm_reg_kw', e.target.value);
      renderRegs();
    });
  }
  window.RegFilter = (c) => {
    sessionStorage.setItem('wm_reg_cat', c);
    renderRegs();
  };

  /* ---------------- AI 接口设置（管理员） ---------------- */
  function renderAI() {
    const c = AI.cfg();
    const d = AI.defaultConfig;
    app.innerHTML = `
      <div class="section-title">🤖 AI 接口设置 <span class="muted" style="font-size:13px">管理员配置 DeepSeek 多模态识别接口与密钥</span></div>
      <div class="card" style="max-width:640px">
        <h3><span class="icon">🔌</span> 接口参数（DeepSeek 多模态）</h3>
        <div class="field"><label>接口地址 BaseURL（OpenAI 兼容，自动追加 /chat/completions）</label>
          <input class="input" id="aiBase" value="${esc(c.baseUrl)}" placeholder="${esc(d.baseUrl)}"/></div>
        <div class="field"><label>模型名称（需支持图片视觉输入，默认 DeepSeek 官方多模态模型）</label>
          <input class="input" id="aiModel" value="${esc(c.model)}" placeholder="${esc(d.model)}"/></div>
        <div class="field"><label>API Key（DeepSeek 开放平台申请）</label>
          <input class="input" id="aiKey" type="password" value="${esc(c.apiKey)}" placeholder="sk-…（申请地址：platform.deepseek.com/api_keys）"/></div>
        <div class="field"><label>思考模式（DeepSeek 特有，影响识别耗时）</label>
          <select class="input" id="aiThinking">
            <option value="disabled" ${c.thinking !== 'enabled' ? 'selected' : ''}>关闭（默认 · 响应快，适合现场识别）</option>
            <option value="enabled" ${c.thinking === 'enabled' ? 'selected' : ''}>开启 · 推理更细但明显更慢，消耗更多 tokens</option>
          </select></div>
        <div class="hint-box">
          <strong>说明：</strong>系统默认接入 <strong>DeepSeek 多模态模型 deepseek-flash</strong>，
          调用 <code>/chat/completions</code>，将现场照片以 Base64 内嵌于 user 消息，
          由前置提示词要求模型依据水利工程安全、质量技术规范识别隐患并生成整改意见，以 JSON 返回。
          DeepSeek 默认开启思考模式，思考内容会占用输出上限导致识别结果为空，因此本系统<strong>默认关闭思考</strong>；如需更细致的推理可临时开启。
          API Key 请前往 <a class="link" href="https://platform.deepseek.com/api_keys" target="_blank" rel="noopener">DeepSeek 开放平台</a> 申请后填入并保存。
          若接口不可用，将自动回退到本地规则识别并标记“需现场核实”；使用其他 OpenAI 兼容服务时，仅需修改接口地址与模型名称。
        </div>
        <div class="form-actions">
          <button class="btn btn-primary" id="aiSave">保存并测试连接</button>
          <button class="btn btn-ghost" id="aiReset">恢复 DeepSeek 默认</button>
          <button class="btn btn-danger-ghost" id="aiClearKey">清空密钥</button>
        </div>
      </div>`;
    document.getElementById('aiSave').onclick = async () => {
      const btn = document.getElementById('aiSave');
      const baseUrl = document.getElementById('aiBase').value.trim();
      const model = document.getElementById('aiModel').value.trim() || d.model;
      const apiKey = document.getElementById('aiKey').value.trim();
      const thinking = document.getElementById('aiThinking').value;
      if (!baseUrl || !apiKey) { toast('请填写接口地址与密钥'); return; }
      Store.setAIConfig({ baseUrl, model, apiKey, thinking });
      btn.disabled = true; btn.textContent = '测试中…';
      let err = null;
      try {
        await AI.chat('你是接口连通性测试助手。', '请直接回复四个字：连接成功');
      } catch (e) { err = e; }
      if (err) {
        render();
        openModal(`
          <h3>⚠️ 接口测试未通过</h3>
          <p style="color:var(--muted);margin:6px 0 10px">配置已保存，但调用接口时返回以下错误：</p>
          <div class="hint-box" style="margin-top:0">${esc(String((err && err.message) || err))}</div>
          <p class="muted" style="margin-top:10px">常见原因：API Key 无效或余额不足、接口地址/模型名称有误、本地网络受限（file:// 打开时受浏览器安全策略限制）。修正后可重新保存测试；接口不可用时系统会自动回退本地规则识别。</p>
          <div class="form-actions"><button class="btn btn-primary" onclick="closeModal()">知道了</button></div>`);
      } else {
        toast('配置已保存，接口测试通过 ✓');
        render();
      }
    };
    document.getElementById('aiReset').onclick = () => {
      Store.setAIConfig({ baseUrl: d.baseUrl, model: d.model, apiKey: '', thinking: d.thinking });
      toast('已恢复 DeepSeek 默认配置（需重新填写密钥）');
      render();
    };
    document.getElementById('aiClearKey').onclick = () => {
      Store.setAIConfig({ baseUrl: c.baseUrl, model: c.model, apiKey: '', thinking: c.thinking });
      toast('密钥已清空'); render();
    };
  }
  window.openAISettings = () => { sessionStorage.setItem('wm_page', 'ai'); render(); };

  /* ---------------- 弹窗与确认 ---------------- */
  function openModal(html) {
    modalBox.innerHTML = html;
    modalMask.style.display = 'flex';
  }
  window.closeModal = () => { modalMask.style.display = 'none'; modalBox.innerHTML = ''; };
  modalMask.addEventListener('click', e => { if (e.target === modalMask) closeModal(); });

  function openConfirm(msg, cb) {
    openModal(`
      <h3>⚠️ 确认操作</h3>
      <p style="color:var(--muted);margin:10px 0 20px">${esc(msg)}</p>
      <div class="form-actions">
        <button class="btn btn-danger" id="okBtn">确认</button>
        <button class="btn btn-ghost" onclick="closeModal()">取消</button>
      </div>`);
    document.getElementById('okBtn').onclick = () => { closeModal(); cb && cb(); };
  }

  /* 供内联事件处理器使用的全局入口 */
  window.go = go;
  window.goLedger = goLedger;
  window.Store = store;
})();