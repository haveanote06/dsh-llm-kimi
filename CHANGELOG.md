# Changelog

## 0.2.1

### 修复

- **凭据回退链让 `kimi-code` 借用了开放平台 key**：`apiKeyEnv` 带 schema 默认值 `MOONSHOT_API_KEY`，旧写法 `apiKeyEnvCode ?? apiKeyEnv ?? 'KIMI_API_KEY'` 里 `??` 永远走不到最后，于是只配了 `MOONSHOT_API_KEY` 时，请求被发到 `https://api.kimi.com/coding/v1` 并返回 `AUTH`（订阅端点不认开放平台 key）。现在共享字段停在默认值时不再算"用户选择"，`kimi-code` 用它自己的 `KIMI_API_KEY`；显式设过 `apiKeyEnv` 的仍然对所有路由生效。设置页的凭据引用推导同步修正。回归测试见 `tests/index.spec.ts`。

### 变更

- 模型目录补上 **Kimi K3.1 Pro**：`k3.1-pro`、`k3.1-pro-highspeed`（Kimi Code 订阅，1M 上下文，只支持思考模式）。
- 移除已下线的 `moonshot-v1-8k` / `-32k` / `-128k`（厂商已关闭这些 id，留着只会在请求时失败）。

## 0.2.0 — 适配 DeepSeek Harness 0.2.1-rc.2

破坏性平台升级（`0.1.0-rc.6` → `0.2.1-rc.2`）的完整移植，并新增 Web GUI 设置页。

### 新增

- **Web GUI 设置页**（`lib/client.js`）：设置 → Kimi。三个路由各一行，可改 Base URL、写入/清除 API Key、查看已配置状态与模型数量。密钥经 credentials remote 写入凭证库，下一次请求生效。
- `smoke.mjs` / `smoke-client.mjs`：不需要 vitest 的快速自检（host 装配 + 浏览器 bundle 注册）。

### 平台适配

- `CallId` → `ToolCallId`：`callId` 系列 brand 在 0.2.x 已删除（`src/translate.ts`、`tests/*`）。
- **tool 结果改为独立消息**：0.2.x 的 `Message` 联合新增 `ToolResultMessage { role: 'tool'; toolCallId; content }`，content part 里不再有 `tool-result`。`sanitize`/`serialize` 相应改写：`serializeUser` 只处理文本与图片，`serializeMessages` 把 `role: 'tool'` 直接映射为 `{ role: 'tool', tool_call_id, content }`。不移植会导致工具调用回放缺 tool 消息。
- `installSettingsSection` / `settingsNamespace` / `deepEqualJson` 全部移除：配置改为 `.volatile()` + `plainOptions()` 读取 live 引用；`deepEqualJson` 改从 `@deepseek-ai/dsh-util-values` 导入；`settingsNs` 直接用 `ctx.fiber.entry.options.id`。
- 配置热更新改用 `ctx.on('loader/volatile-update', ...)`；`retryPolicy` 变化时用 `registration.replace([...])` 原地重注册（不 dispose/re-register，避免路由短暂消失）。
- 客户端插件：删除 `dsh.client` 的旧形状，改为 `{ platform: 'web', inject: [...] }` + `exports["./client"]`；旧 `installSettingsSection` 那套自定义表单被平台表单（`ctx.configForms`）取代，因此改为自绘设置页。
- peerDependencies 全部对齐 `0.2.1-rc.2`（`@deepseek-ai/cordis ~4.0.5`、`cosmokit ~1.8.6`、`dsh-util-values` 新增）。

### 修复

- 坏设置快照不再使三条路由整体不注册：`retryPolicy` 解析失败时用 schema 默认值兜底并记录一次错误。
- `serialize` 的空 tool 输出仍写 `(no output)` 占位。

### 测试

- 6 个测试文件、58 个用例通过（真实 API 组默认跳过）。
- `loader-composition.spec.ts` 重写：0.2.x 的用户设置持久化移到了 app 级服务（`configEditor` + `profileContext`），插件测试改为验证自己拥有的那部分——loader 入口配置 + 凭据平面（真实 cordis 装配、三路由分发、凭据热更新）。

## 0.1.0

- 首个版本（对应 DeepSeek Harness `0.1.0-rc.*`）：三路由适配器、思考模式、工具调用、图片输入。
