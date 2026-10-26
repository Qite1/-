/* ============================================================
 * 水利工程规范查询数据
 *
 * link 指向「全国标准信息公共服务平台」/「国家法律法规数据库」等
 * 权威来源的检索结果页，点击可真实跳转并查询对应规范。
 * 检索参数由 app.js 中的 renderRegs() 统一用 encodeURIComponent 拼接。
 * ============================================================ */
const REG_SEARCH_BASE = 'https://std.samr.gov.cn/search/std?q=';
const REG_LAW_BASE = 'https://flk.npc.gov.cn/';

const REGULATIONS = [
  /* ---------- 质量检验与验收 ---------- */
  { category: '质量·验收', name: '《水利水电工程施工质量检验与评定规程》SL 176-2007', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工质量检验与评定规程' },
  { category: '质量·验收', name: '《水利水电建设工程验收规程》SL 223-2008', src: '水利部', link: REG_SEARCH_BASE + '水利水电建设工程验收规程' },
  { category: '质量·验收', name: '《水利水电工程施工质量验收标准》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工质量验收' },
  { category: '质量·验收', name: '《水利工程建设标准强制性条文》', src: '水利部', link: REG_SEARCH_BASE + '水利工程建设标准强制性条文' },
  { category: '质量·验收', name: '《水利工程质量管理规定》水利部令', src: '水利部', link: REG_SEARCH_BASE + '水利工程质量管理规定' },

  /* ---------- 施工技术规范 ---------- */
  { category: '施工技术', name: '《水工混凝土施工规范》SL 677-2014', src: '水利部', link: REG_SEARCH_BASE + '水工混凝土施工规范' },
  { category: '施工技术', name: '《堤防工程施工规范》SL 260-2014', src: '水利部', link: REG_SEARCH_BASE + '堤防工程施工规范' },
  { category: '施工技术', name: '《碾压式土石坝施工规范》SL 53', src: '水利部', link: REG_SEARCH_BASE + '碾压式土石坝施工规范' },
  { category: '施工技术', name: '《水工建筑物水泥灌浆施工技术规范》SL 62', src: '水利部', link: REG_SEARCH_BASE + '水工建筑物水泥灌浆施工技术规范' },
  { category: '施工技术', name: '《水利水电工程施工组织设计规范》SL 303-2017', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工组织设计规范' },
  { category: '施工技术', name: '《水利水电工程模板施工规范》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程模板施工规范' },
  { category: '施工技术', name: '《水利水电工程锚喷支护施工技术规范》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程锚喷支护' },
  { category: '施工技术', name: '《水利水电工程钢闸门制造安装及验收规范》DL/T 5018', src: '国家能源局', link: REG_SEARCH_BASE + '水利水电工程钢闸门制造安装' },

  /* ---------- 安全与文明施工 ---------- */
  { category: '安全', name: '《水利水电工程施工安全管理导则》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工安全管理导则' },
  { category: '安全', name: '《水利安全生产标准化通用规范》SL/T 528-2018', src: '水利部', link: REG_SEARCH_BASE + '水利安全生产标准化' },
  { category: '安全', name: '《水利工程建设项目施工安全评价导则》', src: '水利部', link: REG_SEARCH_BASE + '水利工程建设项目施工安全评价' },
  { category: '安全', name: '《水利水电工程基坑施工安全技术规范》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程基坑施工安全' },
  { category: '安全', name: '《水利水电工程施工测量规范》SL 52', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工测量规范' },
  { category: '安全', name: '《水利水电工程围堰设计规范》SL 645-2013', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程围堰设计规范' },
  { category: '安全', name: '《水利水电工程施工现场安全防护规定》', src: '水利部', link: REG_SEARCH_BASE + '水利水电工程施工现场安全防护' },
  { category: '安全', name: '《水利工程建设安全生产管理规定》', src: '水利部', link: REG_SEARCH_BASE + '水利工程建设安全生产管理规定' },

  /* ---------- 通用工程与安全技术 ---------- */
  { category: '通用·技术', name: '《施工现场临时用电安全技术规范》JGJ 46-2005', src: '住建部', link: REG_SEARCH_BASE + '施工现场临时用电安全技术规范' },
  { category: '通用·技术', name: '《建筑施工安全检查标准》JGJ 59-2011', src: '住建部', link: REG_SEARCH_BASE + '建筑施工安全检查标准' },
  { category: '通用·技术', name: '《高处作业分级》GB/T 3608-2008', src: '国家标准委', link: REG_SEARCH_BASE + '高处作业分级' },
  { category: '通用·技术', name: '《建筑施工高处作业安全技术规范》JGJ 80', src: '住建部', link: REG_SEARCH_BASE + '建筑施工高处作业安全技术规范' },
  { category: '通用·技术', name: '《建设工程施工现场消防安全技术规范》GB 50720-2011', src: '住建部', link: REG_SEARCH_BASE + '建设工程施工现场消防安全技术规范' },
  { category: '通用·技术', name: '《建筑施工现场环境与卫生标准》JGJ 146', src: '住建部', link: REG_SEARCH_BASE + '建筑施工现场环境与卫生' },

  /* ---------- 法规 ---------- */
  { category: '法律法规', name: '《中华人民共和国安全生产法》', src: '全国人大常委会', link: REG_LAW_BASE },
  { category: '法律法规', name: '《中华人民共和国建筑法》', src: '全国人大常委会', link: REG_LAW_BASE },
  { category: '法律法规', name: '《中华人民共和国水土保持法》', src: '全国人大常委会', link: REG_LAW_BASE },
  { category: '法律法规', name: '《中华人民共和国水法》', src: '全国人大常委会', link: REG_LAW_BASE },
  { category: '法律法规', name: '《建设工程质量管理条例》', src: '国务院', link: REG_LAW_BASE },
  { category: '法律法规', name: '《生产安全事故报告和调查处理条例》', src: '国务院', link: REG_LAW_BASE }
];