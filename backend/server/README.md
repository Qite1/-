# 后端服务（REST API）

为前端提供数据持久化与 AI 代理能力，替换原版"纯前端 + localStorage"方案，实现多人、多设备共享数据。

**零第三方依赖**：只使用 Node 内置模块（`http / https / fs / path / crypto / stream`），无需 `npm install`，有 Node 即可运行。

---

## 一、快速启动

```bash
# 在项目根目录
node server/server.js

# 指定端口（默认 8123）
PORT=9000 node server/server.js
```

启动后访问：

- 前端页面：`http://127.0.0.1:8123/`
- 健康检查：`http://127.0.0.1:8123/api/auth/me`（未登录返回 401）

> 首次启动会自动写入内置演示账号（与前端一致）：
> 管理员 `admin/admin123`、审核员 `shenheyuan/sh123`、施工员 `shigongyuan/sg123`。

---

## 二、架构与目录

```
water-management-app/
├─ index.html             页面骨架（引用 frontend/ 下的资源）
├─ frontend/              前端静态资源（由后端托管）
│  ├─ css/style.css
│  └─ js/
│     ├─ store.js         数据层：改为调用后端 REST API（内存缓存 + 异步持久化）
│     ├─ ai.js            AI 层：改为经后端代理调用 DeepSeek
│     ├─ regulations.js   规范数据
│     ├─ md.js            Markdown 渲染
│     └─ app.js           主流程（适配异步后端调用/状态流转接口）
└─ server/                后端（本目录）
   ├─ server.js           HTTP 服务入口：路由 / 静态托管 / AI 代理 / SSE
   ├─ db.js               数据存储层（JSON 文件持久化）
   ├─ auth.js             认证与权限（token 会话 / 角色元数据）
   ├─ ai.js               DeepSeek 代理（识别 / 对话 / 流式 / 网搜）+ 本地规则回退
   ├─ assistant.js        AI 助手上下文构建与本地兜底回答
   ├─ seed.js             内置演示账号种子
   ├─ regulations.js      规范静态数据（与前端一致）
   ├─ test-api.js         API 自测脚本
   └─ data/               运行时数据（自动生成，勿手工编辑）
      ├─ users.json
      ├─ issues.json
      ├─ ai-config.json
      ├─ chat-history.json
      └─ session.json
```

---

## 三、认证机制

- 登录成功返回 `token`（随机 32 字节 hex），前端持久化到 `localStorage` 的 `wm_session_token`。
- 后续请求头携带 `Authorization: Bearer <token>`。
- 会话映射保存在 `server/data/session.json`，重启不丢登录态。
- 角色：`admin`（管理员）/ `auditor`（审核员）/ `builder`（施工员）。

---

## 四、接口清单

> 除登录外，均需 `Authorization: Bearer <token>`。

### 认证
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录，body `{username,password}`，返回 `{token,user}` |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 当前登录用户（无 token 返 401） |

### 统计
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/stats` | 首页统计卡片 `{total,pending,confirmed,rectified,high}` |

### 用户管理（仅管理员）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/users` | 用户列表（脱敏，不含密码） |
| POST | `/api/users` | 新增用户 |
| PUT | `/api/users` | 调整身份/资料，body `{id,role,...}` |
| DELETE | `/api/users/:id` | 删除用户 |

### 问题/整改台账
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/issues` | 全部问题 |
| GET | `/api/issues/:id` | 单个问题 |
| POST | `/api/issues` | 提交新问题（施工员/审核员/管理员） |
| PUT | `/api/issues/:id` | 编辑台账（审核员/管理员，或本人） |
| PUT | `/api/issues/:id/status` | 状态流转：`confirmed / rectifying / rectified / closed`（含审计 history） |
| DELETE | `/api/issues/:id` | 删除（施工员仅能删自己提交） |

### 规范
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/regulations` | 30+ 部水利工程规范与法规 |

### AI 配置（仅管理员）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/config` | 读取（密钥掩码） |
| PUT | `/api/ai/config` | 保存（传 `apiKey` 覆盖；掩码/空自动保留原值，`"CLEAR"` 清空） |

### AI 代理（登录用户）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/ai/analyze` | 照片隐患识别，body `{photos:[dataURL], note}`，最多 6 张 |
| POST | `/api/ai/search` | 联网检索规范，body `{query}` |
| POST | `/api/ai/chat` | 非流式对话，body `{messages}` |
| POST | `/api/ai/chat/stream` | 流式对话（SSE），body `{messages}`，逐 `data:` 增量返回 |

### AI 助手对话历史
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/chat/history` | 对话历史（上限 60 条） |
| POST | `/api/chat/history` | 追加一条，body `{role,content,at}` |
| DELETE | `/api/chat/history` | 清空历史 |

---

## 五、AI 代理说明

- 前端**不再**直接携带 API Key 调用 DeepSeek，密钥仅存于服务端 `server/data/ai-config.json`，由管理员在「AI 接口」页保存。
- 服务端按 **OpenAI 兼容 `/chat/completions`** 调用 DeepSeek 多模态模型（默认 `deepseek-flash`）。
- **照片识别**：以 Base64 dataURL 内嵌 user 消息，前置提示词要求按水利安全质量规范输出 JSON（隐患标题/风险等级/规范条款/整改措施/是否需现场核实）。
- **流式对话**：上游 SSE 增量经后端透传，前端打字机实时渲染，可中断（AI 助手页「⏹ 停止」）；流式不兼容时自动降级非流式并包装为一条 SSE。
- **联网检索**：命中《规范/标准/最新/修订》等关键词时调用 DeepSeek Search API（`/v1/tools/search`）。
- **离线兜底**：未配置密钥 / 网络失败 / 返回异常时，后端回退本地规则识别与台账统计回答，并在响应中标记 `fallback:true`。

---

## 六、运行自测

```bash
node server/test-api.js
```

脚本会临时占用 **8977** 端口启动服务，依次验证 24 项关键接口（登录、权限矩阵、用户、问题台账状态流转、AI 配置、规范、AI 识别与对话、聊天历史、退出），全部通过输出 `通过: 24 失败: 0`。

---

## 七、常见问题

| 现象 | 说明 |
| --- | --- |
| 前端提示"无法连接后端服务" | 未启动后端。请运行 `node server/server.js` 后通过 `http://127.0.0.1:8123/` 访问。 |
| 端口被占用 | 用 `PORT=xxxx node server/server.js` 指定其他端口；若改端口，需同时设置前端 `window.WM_API_BASE` 指向该端口的 `/api`。 |
| API Key 在哪配置 | 管理员登录 →「AI 接口」页填写保存，后端自动测试连通性。 |
| 数据在哪 | 全部在 `server/data/` 下的 JSON 文件，可备份/迁移（Session 除外，删除 session.json 即全员退出）。 |