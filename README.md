# dsh-llm-kimi

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接入 Kimi（Moonshot AI）的 LLM 适配器插件，附带一个 **Web GUI 设置页**：在「设置 → Kimi」里粘贴 API Key 即可用，不需要改配置、不需要重启。

- **三个路由，覆盖三种 key**：Kimi Code 订阅（`sk-kimi-*`）、Moonshot 开放平台国内、Moonshot 开放平台海外
- **设置页**在浏览器里填 key / 改端点，写入凭证库后下一次请求立即生效
- **思考模式**：`thinking: {type: enabled|disabled}` + `reasoning_effort: low|high|max`（真实 API 验证；旧式布尔 `enable_thinking` 会被静默忽略）
- **工具调用**（function calling）与**图片输入**（base64 data URI，多模态模型）
- **热更新**：设置、模型目录、凭据在请求边界重新解析，改完不用重启；进行中的流保持它开始时的配置

## 兼容性

| 本插件 | DeepSeek Harness |
|---|---|
| `0.2.x` | `>= 0.2.1-rc.2` |
| `0.1.x`（上游） | `0.1.0-rc.*` |

0.2.x 是一次破坏性平台升级（`CallId` → `ToolCallId`、`installSettingsSection` → `SettingsForms`、volatile 配置改为 live 引用、tool 结果改为独立消息）。移植说明见 [CHANGELOG.md](./CHANGELOG.md)。

## 路由与端点

| 路由 | key 类型 | 默认端点 | 默认凭据引用 |
|---|---|---|---|
| `kimi-code` | Kimi Code 订阅（`sk-kimi-*`） | `https://api.kimi.com/coding/v1` | `KIMI_API_KEY` → 回退 `MOONSHOT_API_KEY` |
| `kimi-cn` | Moonshot 开放平台（`sk-*`）国内 | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `kimi-global` | Moonshot 开放平台（`sk-*`）海外 | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |

> 注意：`apiKeyEnv` 的 schema 默认值是 `MOONSHOT_API_KEY`，所以只设 `MOONSHOT_API_KEY` 时 `kimi-code` 也会用它；想让 Kimi Code 走订阅 key，请在设置页或 `apiKeyEnvCode` 里单独指定（默认为 `KIMI_API_KEY`）。

## 安装

```sh
# 从 GitHub 安装（构建产物 lib/ 随仓库提交，安装时无需本机编译）
dsh plugin --profile web add github:haveanote06/dsh-llm-kimi

# 从本地目录安装（开发调试）
dsh plugin --profile web add link:C:/path/to/dsh-llm-kimi

# npm 发布后
dsh plugin --profile web add dsh-llm-kimi
```

装完**重启 `dsh web` 一次**（客户端插件清单在启动时扫描），然后在 设置 → Kimi 填 key。

## 用设置页配置（推荐）

重启后在 Web GUI 打开「设置 → Kimi」：

- 每个路由一行：**Base URL** 输入框（失焦保存）、**API Key** 密码框（回车或按钮保存）、已配置/未配置状态徽章、模型数量
- key 通过 harness 的 credentials remote 写入 `.credentials.yaml`（0600），**不会**写进设置文档，也不会有任何接口把它读回来
- 「清除密钥」删掉该引用；删完下一次请求会以 `MISSING_CREDENTIAL` 失败并提示怎么办

改完即生效，无需重启。

## 用环境变量 / 文件配置

除了设置页，凭据解析顺序是：托管凭证库 → 进程环境 → `$DSH_HOME/.env` → `<cwd>/.env`。

```sh
export KIMI_API_KEY=sk-kimi-...      # kimi-code
export MOONSHOT_API_KEY=sk-...       # kimi-cn / kimi-global
dsh web
```

只在某个 checkout 里临时改端点，可以用环境变量（仅信任的环境层生效，优先级低于显式配置）：`KIMI_BASE_URL`、`MOONSHOT_BASE_URL_CN`、`MOONSHOT_BASE_URL_GLOBAL`。

## 配置项

全部可选，全部可在设置里热改：

| 字段 | 默认 | 说明 |
|---|---|---|
| `apiKeyEnv` | `MOONSHOT_API_KEY` | 全局凭据引用，作为所有路由的回退 |
| `apiKeyEnvCode` / `apiKeyEnvCn` / `apiKeyEnvGlobal` | 见上表 | 按路由覆盖凭据引用 |
| `baseURLCode` / `baseURLCn` / `baseURLGlobal` | 见上表 | 按路由覆盖端点（自建网关、代理） |
| `thinking` | 不设 | `enabled` / `disabled`；`disabled` 时只允许 `reasoningEffort: off` |
| `reasoningEffort` | `high` | `off` / `high` / `max` |
| `maxTokens` | `256000` | 单次输出上限；模型自身上限与请求显式值优先 |
| `defaultContextWindow` | `1000000` | 模型没有精确上下文值时的兜底容量 |
| `models` | 联合目录（见下） | 建议性模型目录，`/models` 发现用 |
| `streamIdleTimeoutMs` | `300000` | 单个流读操作的最长空闲时间 |
| `retryPolicy` | 平台默认 | 模型请求重试策略；改它会在原地重注册路由 |

## 模型目录（联合，可覆盖）

| 模型 | 上下文 | 模态 | 备注 |
|---|---|---|---|
| `kimi-for-coding` | 262k | 文本+图片 | Kimi Code 订阅（K2.7） |
| `kimi-for-coding-highspeed` | 262k | 文本+图片 | Kimi Code 高速版 |
| `k3` / `k3-256k` | 1M / 262k | 文本+图片 | Kimi Code K3 |
| `kimi-k3` | 1M | 文本+图片 | 开放平台 K3 |
| `kimi-k2.6` / `kimi-k2.7-code` | 256k | 文本+图片 | 开放平台 |
| `moonshot-v1-8k/32k/128k` | 8k~128k | 文本 | 旧版，目录标 `reasoning: false` |

模型 id 原样发给 API，不做白名单校验，所以填新模型不会因为插件不认识而失败。

## 开发

```sh
npm install              # 依赖（本仓库开发时若 peer 解析报错，可加 --legacy-peer-deps）
npm run build            # tsc：src/ → lib/（lib/client.js 是手写浏览器 bundle，不受影响）
npm run typecheck        # 只查 src/
npm test                 # vitest：58 个用例（真实 API 的那组默认跳过）
npm run smoke            # 不起 vitest 的快速自检：host 装配 + 客户端 bundle 注册
```

真实 API 冒烟（可选，消耗额度）：

```sh
KIMI_API_KEY=sk-kimi-... npx vitest run tests/smoke.spec.ts
```

### 测试覆盖

- `serialize.spec.ts` — 思考参数映射、图片、tool 消息、reasoning 回传、非思考模型
- `translate.spec.ts` — SSE chunk 翻译（reasoning/text/tool/finish/usage 顺序）
- `adapter.spec.ts` — 对本地 mock Kimi API 的流式、错误映射、取消、元数据
- `loader-composition.spec.ts` — 真实 cordis 装配：三路由注册、按路由分发请求、凭据热更新、仅入口配置启动
- `index.spec.ts` — 三路由配置解析与校验、Schemastery 默认值
- `smoke.spec.ts` — **真实 Kimi Code API**（`KIMI_API_KEY` 门控）

### 客户端设置页结构

- `lib/client.js` — 手写的 `__ModuleLoader__.load` bundle（客户端插件不能是纯 ESM），只 `require("react")`，用原生 `<input>/<button>`，不依赖未安装的 UI primitives
- 注册 `settings.section`（id `kimi`，order 30），通过 `ctx.configForms.get("llm-kimi")` 读写配置、`ctx.remote.credentials` 读写密钥、`ctx.locale` 提供中英文字典
- 由 `package.json` 的 `dsh.client`（`platform: web` + 三个包依赖边）和 `exports["./client"]` 声明

## 协议义务

对齐官方 LLM 适配器协议：usage 先于 finish、finish 后零输出、工具参数保持 RAW JSON、错误两路径、尊重 `options.signal`。

## License

MIT
