# dsh-llm-kimi 插件设计文档

> 为 DeepSeek Harness 接入 Kimi（Moonshot AI）系列模型。设计对齐官方参考实现 `@deepseek-ai/dsh-llm-deepseek`（fetch + SSE 直连方案），因为 Moonshot 提供 OpenAI 兼容的 chat-completions 接口，两者协议处理高度同构，可最大化复用经过验证的设计。

## 1. 目标与非目标

### 目标
- 让 DSH 可以选择 Kimi 系列模型作为 LLM 提供商（模型选择器、配置面板、Agent 循环全链路可用）。
- 支持思考模型（`reasoning_content` 流式输出）与工具调用（function calling）。
- 支持 kimi-k3 的多模态图片输入（base64 data URI）。
- 密钥通过凭证机制解析（环境变量 / Web Models 页面配置），代码中不出现明文。

### 非目标（v1 不做）
- 动态模型发现（GET /v1/models 集成到 discovery seam）——留作 v1.1。
- 国内/海外自动切换——v1 提供**双路由**（`kimi-cn` / `kimi-global` 两个 provider route，各自独立 baseURL 与密钥），用户在模型选择器中直接选，无需自动探测。

## 2. 调研结论（事实依据）

| 项 | 结论 | 来源 |
|---|---|---|
| **Kimi Code 端点**（`sk-kimi-*` 订阅 key） | `https://api.kimi.com/coding/v1`；模型 `kimi-for-coding`(K2.7, 256k)、`kimi-for-coding-highspeed`、`k3`(1M)、`k3-256k` | 实测 + kimi-cli 官方文档 |
| **Moonshot 开放平台端点**（`sk-*` key） | `https://api.moonshot.cn/v1`（国内）/ `https://api.moonshot.ai/v1`（海外），密钥区域绑定 | promptfoo Moonshot 文档 |
| 协议 | OpenAI 兼容 `POST /chat/completions`，SSE 流式 | 实测 |
| 密钥环境变量惯例 | Kimi Code → `KIMI_API_KEY`；开放平台 → `MOONSHOT_API_KEY` | kimi-cli 文档 |
| 思考模式 | 流式 delta 携带 `reasoning_content`；开关为 **`thinking: {type: 'enabled'\|'disabled'}`**（旧式 `enable_thinking` 布尔被静默忽略）；强度为顶层 `reasoning_effort: 'low'\|'high'\|'max'`（k3 实测全部有效） | 实测 + kimi-cli 源码 |
| 多模态 | k3/kimi-for-coding 接受 base64 编码图片（标准 OpenAI `image_url` content 格式）；**不接受远程 URL** | 模型元数据 `supports_image_in` |
| 工具调用 | 标准 OpenAI function calling 格式 | 实测 |
| 请求 ID 头 | Kimi Code `x-trace-id`；开放平台 `msh-request-id` | 实测响应头 |

## 3. 命名与标识

| 项 | 值 |
|---|---|
| npm 包名 | `@<your-scope>/dsh-llm-kimi` |
| 插件名（cordis） | `llm-kimi` |
| provider route 1 | `kimi-code`（Kimi Code 订阅；默认 `https://api.kimi.com/coding/v1`，默认 key `KIMI_API_KEY`） |
| provider route 2 | `kimi-cn`（Moonshot 国内，默认 `https://api.moonshot.cn/v1`） |
| provider route 3 | `kimi-global`（Moonshot 海外，默认 `https://api.moonshot.ai/v1`） |
| 设置命名空间 | `llm-kimi`（`installSettingsSection`） |
| 默认密钥环境变量 | 路由默认：Kimi Code → `KIMI_API_KEY`；开放平台 → `MOONSHOT_API_KEY`（均可用 `apiKeyEnv*` 覆盖） |

## 4. 总体架构

严格对齐 `llm-deepseek` 的分层职责（官方指南明确要求：wire 类型、请求序列化、传输解析、chunk 翻译、adapter 类必须分离）：

```
kimi-plugin/
├── package.json              # 含 dsh.bundle 清单（见 §7）
├── tsconfig.json
├── cordis.patch.yml          # bundle patch：注册插件 + 默认配置
├── src/
│   ├── index.ts              # 插件入口：Config schema、resolveAdapterOptions()、apply()
│   ├── adapter.ts            # KimiAdapter extends LlmAdapter：stream()/listModels()/resolveModel()
│   ├── serialize.ts          # harness 消息 → Kimi wire request（含思考参数与图片序列化）
│   ├── translate.ts          # Kimi SSE payload → StreamChunk（含 usage/finish 缓冲）
│   ├── sse.ts                # SSE 解析（eventsource-parser），[DONE] 哨兵
│   ├── types.ts              # Wire 类型（WireRequest/WireMessage/WireChunk/WireUsage/WireError）
│   └── invariant.ts          # 配置/目录校验错误（可复用 deepseek 的写法）
└── tests/
    ├── mock-server.ts        # 本地 mock Kimi API（node http + SSE）
    ├── adapter.spec.ts       # stream() 行为单测（对 mock）
    ├── adapter.e2e.ts        # 端到端（对 mock server）
    ├── serialize.spec.ts     # 消息序列化（thinking/图片/工具消息）
    ├── translate.spec.ts     # chunk 翻译（reasoning/text/tool/finish 顺序）
    └── loader-composition.spec.ts  # 插件装配测试
```

### 4.1 数据流

```
Agent 循环 (GenerateOptions)
        │
        ▼
KimiAdapter.stream(options)          ← 每请求一次 resolve：连接事实 + 密钥在此冻结
        │
        ├─ serializeRequest(options, defaults) → JSON body
        ├─ fetch(baseURL + "/chat/completions", {stream: true, ...})   ← 尊重 options.signal
        │     └─ 非 2xx → LlmError（AUTH/RATE_LIMIT/QUOTA/SERVER/CONTEXT_WINDOW_EXCEEDED…）
        ▼
parseSse(response.body)   ← eventsource-parser，onComment 心跳
        ▼
translate(payloads)       ← 状态机：reasoning/text/tool-call 三个 block 通道
        ▼
StreamChunk 流（block-start / *-delta / block-end / usage / finish）
```

## 5. 核心接口设计

### 5.1 Config（schemastery schema，全部可选）

```ts
interface Config {
  /** 凭证引用（环境变量名），两路由兜底；默认 MOONSHOT_API_KEY */
  apiKeyEnv?: string
  /** 覆盖国内路由的凭证引用 */
  apiKeyEnvCn?: string
  /** 覆盖海外路由的凭证引用 */
  apiKeyEnvGlobal?: string
  /** 国内路由端点 base（默认 https://api.moonshot.cn/v1）；`/chat/completions` 由 adapter 拼接 */
  baseURLCn?: string
  /** 海外路由端点 base（默认 https://api.moonshot.ai/v1） */
  baseURLGlobal?: string
  /** 部署思考策略；disabled 时所有会话请求强制 off */
  thinking?: 'enabled' | 'disabled'
  /** 默认思考强度（默认 high）；off 禁用思考 */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** 默认输出上限（默认 256k）；模型自身上限与请求显式值优先 */
  maxTokens?: number
  /** 无精确值时使用的上下文容量（默认 1_000_000，对齐 kimi-k3） */
  defaultContextWindow?: number
  /** 发现层展示的模型目录；默认 kimi-k3 + kimi-k2.6 + kimi-k2.7-code + moonshot-v1-128k */
  models?: KimiCatalogModel[]
  /** 单次流读取的空闲超时（默认 300_000ms） */
  streamIdleTimeoutMs?: number
  /** provider 重试策略 */
  retryPolicy?: RetryPolicyConfig
}

interface KimiCatalogModel {
  id: string                // wire model id
  name?: string             // 选择器标签
  description?: string
  contextWindow?: number    // 已知的上下文容量
  maxTokens?: number        // 该模型的输出上限
  inputModalities?: ('text'|'image')[]  // 模态声明；含 image 的模型允许图片输入
}
```

校验规则（`resolveAdapterOptions` 中复判，即使程序化构造绕过 schema）：
- `thinking: 'disabled'` 时 `reasoningEffort` 只能是 `'off'` 或省略；
- 整数/正数/范围校验：`defaultContextWindow`、`maxTokens`、`streamIdleTimeoutMs`（≤ `MAX_TIMER_DELAY_MS`）；
- 模型目录：id 非空、无重复、name 非空字符串。

### 5.2 KimiAdapter extends LlmAdapter

```ts
class KimiAdapter extends LlmAdapter {
  constructor(config: {
    options: (provider: string) => KimiConnectionOptions  // 按路由解析有效连接事实
    resolveApiKey: (c) => Promise<string>     // 从同一快照解析密钥
    resolveUserId: () => AnonymousUserId
    resolveImage: (ref, signal?) => Promise<StoredImageAttachment>  // 图片字节解析（ctx.attachments）
  })

  override providerInfo(provider): LlmProviderInfo   // kimi-cn → 'Kimi (Moonshot CN)'；kimi-global → 'Kimi (Moonshot Global)'
  override providerRetryPolicy(): ResolvedRetryPolicy
  override listModels(provider): Promise<readonly LlmModelInfo[]>
  override resolveModel(provider, model, signal?): Promise<LlmResolvedModelInfo>
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}
```

**stream() 骨架**（直接复用 deepseek 的验证过模式）：
1. 每调用解析一次 `options()` 与 `resolveApiKey()`——连接事实和密钥在单请求内冻结，下一次调用重新解析；
2. `AbortSignal.any([options.signal, consumer.signal])` 合并调用方取消与内部控制器；
3. `idleWatchdog` 包裹迭代：超时 → `LlmError('TIMEOUT')`；调用方取消 → `'ABORTED'`；其余网络错误 → `'TRANSPORT'`；
4. 非 2xx：解析 provider error body → 稳定的 LlmError code（见 5.5）。

**resolveModel()** 的模态与思考声明：
- `kimi-k3`：`inputModalities: ['text', 'image']`，`context: { contextWindow: 1_000_000 }`，reasoning efforts 全量；
- `moonshot-v1-*`：`['text']`，reasoning efforts 仅 `off`（旧模型无思考通道）；
- 未在目录中的模型：与 deepseek 相同——声明 `['text']` 负能力而非 unknown（防止宿主接受序列化层必须拒绝的图片）。

### 5.3 serialize.ts（harness → wire）

与 deepseek 序列化器逐项对齐，差异点如下：

| 场景 | DeepSeek 行为 | Kimi 适配行为 |
|---|---|---|
| system 消息 | `{role:'system', content}` | 相同 |
| user 文本 | `{role:'user', content}` | 相同 |
| assistant 纯文本 | `{role:'assistant', content}` | 相同 |
| assistant 工具调用 | `content: ""` + `tool_calls[]`，**思考回传**：`reasoning_content` 仅在含 tool_calls 的回合发送 | 相同（Kimi 同样要求 `reasoning_content` 在工具回合回传，社区有因丢弃该字段导致工具间卡顿的案例） |
| tool 结果 | `{role:'tool', tool_call_id, content}`，空输出补 `'(no output)'` | 相同 |
| 思考参数 | `thinking: {type}` + `reasoning_effort` | **待验证**：Kimi 的确切 wire 字段名（`enable_thinking` / `thinking.type` / `reasoning_effort`），见 §8 |
| 图片（user 消息） | 拒绝（text-only，`UNSUPPORTED_CONTENT`） | 模型在 image-capable 集合内：image 块 → 经 `ctx.attachments.readImage` 取字节 → `{type:'image_url', image_url:{url:'data:<mediaType>;base64,...'}}`；**拒绝远程 http(s) URL**（Moonshot 不接受），报 `UNSUPPORTED_CONTENT` 且 message 说明原因；不在集合内或附件服务不可用 → `UNSUPPORTED_CONTENT` |
| 流式 | `stream: true` + `stream_options: {include_usage: true}` | 相同 |
| 工具 schema | `{type:'function', function:{name, description, parameters}}` | 相同 |
| 思考参数 | `thinking: {type}` + `reasoning_effort` | **v1 采用 Kimi 文档化的 `enable_thinking: boolean`**：off→false，high/max→true（真实 key 冒烟时确认 kimi-k3 是否支持更细的 effort 参数，见 §8） |
| 未支持字段 | 抛 `LlmError('UNSUPPORTED')` | 相同 |

### 5.4 translate.ts（wire → StreamChunk）

沿用 deepseek 的"缓冲到 [DONE]"策略——这满足协议义务（usage 先于 finish，finish 后零输出，覆盖 trailing usage-only chunk）：

- `delta.reasoning_content`（非空）→ 打开/追加 `reasoning` block；首 chunk 空串不建块；
- `delta.content`（非空）→ `text` block；
- `delta.tool_calls[]` → 按 wire `index` 建 `tool-call` block（复用 deepseek 的 Map 方案，`arguments` 保持原始 JSON 字符串分片）；
- `choice.finish_reason` → `stop`/`tool_calls`/`length` 映射，未知值 → `{kind:'error', code: reason.toUpperCase()}`；
- `usage` → **待验证**字段名：`prompt_tokens_details.cached_tokens`（缓存）与 `completion_tokens_details.reasoning_tokens`（思考 token）按 Kimi 实际返回调整；沿用"缓存命中从 inputTokens 减出"的 disjoint 约定；
- `[DONE]` 时按 `order` 顺序 flush 所有 `block-end` → `usage` → `finish`；无内容且 finish=stop 的退化完成 → `EMPTY_RESPONSE` 错误 finish；
- payload 不是合法 JSON → `MALFORMED_RESPONSE`；流未以 [DONE] 结束 → `STREAM_CLOSED`。

### 5.5 错误码映射（httpErrorCode）

| 触发条件 | LlmError code |
|---|---|
| HTTP 401/403 | `AUTH` |
| 错误详情含配额超限特征 | `QUOTA_EXCEEDED` |
| HTTP 429 | `RATE_LIMIT` |
| HTTP 400 + 上下文超限特征 | `CONTEXT_WINDOW_EXCEEDED` |
| HTTP 400 其他 | `INVALID_REQUEST` |
| HTTP ≥ 500 | `SERVER` |
| 其他状态 | `HTTP_<status>` |

附：`retry-after` 响应头 → `providerRetryAfterMs`；`x-request-id` 头 → `ProviderRequestId`（Kimi 返回 `x-request-id`，需实施时确认）。

### 5.6 协议义务 checklist（对齐官方指南，逐条落实）

- [x] `usage` 在 `finish` 前发出；`finish` 后零输出（[DONE] 缓冲法）
- [x] tool `arguments` 全程 RAW JSON 字符串，`argumentsDelta` 分片
- [x] block `index` 首次出现顺序分配，同 block 全部 delta 复用 index
- [x] 错误两路径：`stream()` 抛 `LlmError`（transport/protocol）/ `finish {kind:'error'|'aborted'}`（provider 带内）
- [x] 尊重 `options.signal`
- [x] 无法支持的 `GenerateOptions` 字段 → `LlmError('UNSUPPORTED')`
- [x] `replayState`：Kimi 无签名要求，v1 不实现；如需则 emit 最小 lossless-JSON 投影

## 6. 注册与配置

### 6.1 apply() 注册流程（对齐 deepseek，三路由）

1. `ctx.llm.registerConfigurableProviders([...])` 注册三个可配置提供商：`kimi-code`（Kimi Code）、`kimi-cn`（Kimi (Moonshot CN)）、`kimi-global`（Kimi (Moonshot Global)）——Web Models 页面出现三项；
2. `ctx.llm.registerAdapter([CODE_ROUTE, CN_ROUTE, GLOBAL_ROUTE], adapter)`——**一个 adapter 实例服务三个路由**，effect-based，HMR 安全；重复注册抛错；
3. `installSettingsSection(ctx, NS, Config, config, { setSource, onChange })`——用户设置区 `llm-kimi`，变更后**下一次请求即生效**（连接事实每请求按路由重解析）；retryPolicy 是唯一注册时捕获的事实，变更时 `registration.replace([...])`；
4. 密钥解析：优先 `ctx.get('credentials')` 凭证服务（Web Models 页面写入），否则环境变量；都没有 → `LlmError('MISSING_CREDENTIAL')`（**不**在插件加载时失败，而是请求时失败并给出可操作提示）。

### 6.2 cordis.patch.yml（bundle patch）

> 实测修正：bundle patch 必须是**顶层 YAML 数组**（loader patch 条目，`insert` 语义），不是 `plugins:` 映射。

```yaml
# dsh-llm-kimi bundle patch
- insert:
    - id: llm-kimi
      name: dsh-llm-kimi
      config:
        apiKeyEnv: MOONSHOT_API_KEY   # 兜底；Kimi Code 默认 KIMI_API_KEY，均可按路由覆盖
        # kimi-code 默认 https://api.kimi.com/coding/v1
        # kimi-cn 默认 https://api.moonshot.cn/v1，kimi-global 默认 https://api.moonshot.ai/v1
```

### 6.3 用户安装方式

```sh
dsh plugin --profile web add @<your-scope>/dsh-llm-kimi
```

`dsh plugin add` 会自动把声明了 `dsh.bundle` 的依赖加入 profile 的 `dsh.profile.bundles`（按已安装状态调和），重启 `dsh web` 后生效。已在本机验证：`dsh --profile web --dump-config` 的组合配置包含 `llm-kimi` 行。

## 7. package.json 与发布

```jsonc
{
  "name": "@<your-scope>/dsh-llm-kimi",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./src/*": "./src/*",
    "./package.json": "./package.json"
  },
  "files": ["lib/index.js", "lib/invariant.js", "lib/types/**/*.d.ts", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },   // 社区 bundle 清单（modlens/spotlight 同款格式）
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.1",
    "@deepseek-ai/dsh-llm": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-credentials": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-launch-environment": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-settings": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-timeout": "^0.1.0-rc.6",
    "@deepseek-ai/dsh-anonymous-user-id": "^0.1.0-rc.6"
  },
  "dependencies": {
    "@deepseek-ai/schemastery": "^3.x",
    "eventsource-parser": "^3.1.0"
  }
}
```

发布后：投稿 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 与 [dsh-market](https://github.com/dsh-market/dsh-market) 获取曝光。

## 8. 真实 API 验证结果（2026-08，Kimi Code 订阅 key 实测）

> 冒烟测试（`tests/smoke.spec.ts`，`KIMI_API_KEY` 门控）全部通过。以下原先的"待验证项"均已对真实 API 确认。

| # | 事项 | 实测结论 |
|---|---|---|
| 1 | 思考参数 wire 格式 | ✅ **`thinking: {type: 'enabled'\|'disabled'}` + 顶层 `reasoning_effort: 'low'\|'high'\|'max'`**。旧式 `enable_thinking: boolean` 被 API **静默忽略**（曾误以为有效）；`thinking:{type:'disabled'}` 真实关闭思考（响应无 reasoning_content），`reasoning_effort` 三种取值全部接受（k3 声明 valid_efforts low/high/max） |
| 2 | 图片输入 | 未实测（无图片 key 场景）；k3/kimi-for-coding 均声明 `supports_image_in: true`，序列化为 base64 data URI 的路径由 mock 测试覆盖 |
| 3 | usage 字段 | ✅ `prompt_tokens` 含缓存命中（`prompt_tokens_details.cached_tokens` 单独报告，顶层还有 `cached_tokens`）；`completion_tokens_details.reasoning_tokens` 报告思考 token。**缓存激进**：相同 prompt 二次调用时未缓存输入为 0（全部命中）——disjoint 计费约定下行为正确 |
| 4 | `reasoning_content` 回传 | ✅ 非流式响应直接携带；流式 delta 按 DeepSeek 同款格式（首 chunk 空串、后续分片） |
| 5 | 旧模型 moonshot-v1 | 未实测（开放平台 key 未提供）；目录中标记 `reasoning: false`，序列化层对其不发思考字段、非 off 强度抛 `UNSUPPORTED_REASONING_EFFORT` |
| 6 | 请求 ID 头 | ✅ Kimi Code 返回 **`x-trace-id`**（非 `x-request-id`）；Moonshot 开放平台返回 `msh-request-id`。`requestId()` 按 `x-trace-id` → `x-request-id` → `msh-request-id` 顺序探测 |
| 7 | 未知模型行为 | ✅ Kimi Code 对不存在的 model id **不报错**（HTTP 200 照常回答），错误映射路径仅对真实错误（401/429/5xx）生效 |

**Key 类型与端点（重要）**：`sk-kimi-*` 前缀是 **Kimi Code 订阅 key**，走 `https://api.kimi.com/coding/v1`（模型：`kimi-for-coding` / `kimi-for-coding-highspeed` / `k3` / `k3-256k`）；`sk-*` 前缀是 **Moonshot 开放平台 key**，走 `api.moonshot.cn/v1`（国内）或 `api.moonshot.ai/v1`（海外）。三种 key 三种端点，插件提供三个路由分别对接。

## 9. 实施路线

1. ✅ **Phase 1 骨架**：package.json / tsconfig / types.ts / sse.ts / mock-server.ts
2. ✅ **Phase 2 核心**：serialize.ts / translate.ts（含单测）
3. ✅ **Phase 3 装配**：adapter.ts / index.ts / cordis.patch.yml / loader-composition 测试
4. ✅ **Phase 4 mock 验证**：mock server 全链路，**53/53 单测通过**
5. ✅ **Phase 4b 真实冒烟**：Kimi Code 订阅 key 实测，**5/5 冒烟通过**（含思考/工具/usage/请求头），并据实测修正思考 wire 格式与新增 kimi-code 路由
6. ⏳ **Phase 5 发布**：npm publish + 投稿目录

## 10. 后续扩展（v1.1+）

- 动态模型发现：`GET /v1/models` → `LlmModelDiscoveryRequest` seam 集成；
- 国内/海外自动切换：单路由 + 密钥区域探测；
- 模型级模态声明增强：catalog 条目携带更多能力字段；
- 自定义 baseURL 网关（如 OneAPI/NewAPI 聚合中转）——已天然支持（两路由 baseURL 均可配）。

## 11. Models 页面限制与客户端增强计划

**实测发现（2026-08）**：内置 Models 页（`dsh-client-ui-settings-models`）的提供商编辑器布局由 `layoutOf(ns)` **硬编码**为 `llm-deepseek` / `llm-pi-ai`；其他命名空间（含 `llm-kimi`）渲染为只读提示卡（仅 `advancedHint` 文案，提交按钮 `submitDisabled: layout === "unknown"`）。因此第三方 LLM 插件的 key **无法在内置 Models 页填写**——平台限制，非插件缺陷。

**当前可行的 key 配置路径**（均已验证）：
1. 启动环境变量（`KIMI_API_KEY` / `MOONSHOT_API_KEY`）；
2. Web 凭证 API `POST /api/credentials.set`（与 Models 页共用同一凭证库，写入后页面显示绿色"已配置"圆点；已实测成功）；
3. 直接写 `~/.dsh/.credentials.yaml`。

**客户端设置页（✅ 已实现，`client/client.js`）**：随包附带客户端插件（`dsh.client` manifest + `exports["./client"]`，手写 lazy-CJS bundle 零构建），通过 `ctx.slots.inject("settings.section", ...)` 注册独立的 "Kimi" 设置节（id `llm-kimi`，order 20）：路由选择（kimi-code/cn/global，含端点与凭证引用说明）+ key 输入（`api.credentials.set` 写入凭证库，与 Models 页共用）+ 配置状态展示（`api.credentials.describe`，绿/红点）+ 中英文双语。已在 Node 中模拟浏览器加载器完整验证注册流程。**生效条件**：host 端 `dsh-client-modules` 在启动时扫描 `dsh.client` 清单（包元数据缓存"永不过期"），因此**需重启 `dsh web`** 后设置页才会出现。
