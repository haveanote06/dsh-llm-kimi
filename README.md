# dsh-llm-kimi

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 接入 Kimi 模型的 LLM 适配器插件。三个路由覆盖三种 key：

| 路由 | key 类型 | 默认端点 | 默认 key 环境变量 |
|---|---|---|---|
| `kimi-code` | Kimi Code 订阅（`sk-kimi-*`） | `https://api.kimi.com/coding/v1` | `KIMI_API_KEY` |
| `kimi-cn` | Moonshot 开放平台（`sk-*`）国内 | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` |
| `kimi-global` | Moonshot 开放平台（`sk-*`）海外 | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` |

- 思考模式：`thinking: {type: enabled|disabled}` + `reasoning_effort: low|high|max`（**真实 API 验证**；旧式 `enable_thinking` 布尔会被静默忽略）
- 工具调用（function calling）实测可用
- 多模态图片输入（k3 / kimi-for-coding 等，base64 data URI）
- 配置/密钥热更新：改设置后下一次请求即生效

## 安装

```sh
# 从 GitHub 安装（构建产物已随仓库提交，无需本机编译）
dsh plugin --profile web add github:haveanote06/dsh-llm-kimi

# 从 npm 安装（发布后）
dsh plugin --profile web add dsh-llm-kimi
```

安装后重启 `dsh web`，在 Web GUI 设置页的 "Kimi" 页配置 API Key 即可使用。

## 配置密钥

三种方式（任选其一）。路由默认读取的引用：`kimi-code` → `KIMI_API_KEY`，`kimi-cn`/`kimi-global` → `MOONSHOT_API_KEY`（可用 `apiKeyEnvCode`/`apiKeyEnvCn`/`apiKeyEnvGlobal` 或公共 `apiKeyEnv` 覆盖）。

1. **启动环境变量**：`export KIMI_API_KEY=sk-kimi-...` 后启动 `dsh web`。
2. **Web 凭证库**（推荐，写入即生效，无需重启）：Web 应用的凭证存储与 Models 页面共用同一份。当前版本的内置 Models 页只对 `llm-deepseek` / `llm-pi-ai` 命名空间提供可编辑表单（第三方提供商命名空间显示只读提示卡——平台限制，见下），但可直接通过应用的凭证 API 写入：

   ```sh
   curl -X POST http://127.0.0.1:3080/api/credentials.set \
     -H "Content-Type: application/json" \
     -d '{"type":"client-request","rpcId":"set1","method":"credentials.set","payload":{"ref":"KIMI_API_KEY","value":"<你的key>"}}'
   ```

   写入后 Models 页面对应行显示绿色"已配置"圆点。
3. **凭证文件**：`~/.dsh/.credentials.yaml`（0600）追加 `KIMI_API_KEY: <key>`。

> **内置 Models 页限制**：`dsh-client-ui-settings-models` 的提供商编辑器布局硬编码为 `llm-deepseek` / `llm-pi-ai` 两个命名空间；其他命名空间（含本插件的 `llm-kimi`）渲染为只读提示卡（提交按钮禁用），因此第三方 LLM 插件的 key 无法直接在 Models 页内填写——这是平台当前限制，不是本插件缺陷。

> **本插件自带 "Kimi" 设置页**（客户端插件，重启 `dsh web` 后在 设置 → Kimi 出现）：选择路由 → 粘贴 API Key → 保存（写入凭证库，下一次请求生效），并显示各路由配置状态。参照社区 [deepseek-harness-model-config](https://github.com/MarvekG/deepseek-harness-model-config) 的客户端插件模式。

## 模型目录（联合，可覆盖）

| 模型 | 上下文 | 模态 | 备注 |
|---|---|---|---|
| kimi-for-coding | 256k | 文本+图片 | Kimi Code（K2.7 Coding） |
| kimi-for-coding-highspeed | 256k | 文本+图片 | Kimi Code 高速 |
| k3 | 1M | 文本+图片 | Kimi Code K3 |
| k3-256k | 256k | 文本+图片 | Kimi Code K3 精简上下文 |
| kimi-k3 | 1M | 文本+图片 | 开放平台 K3 |
| kimi-k2.6 / kimi-k2.7-code | 256k | 文本+图片 | 开放平台 |
| moonshot-v1-8k/32k/128k | 8k~128k | 文本 | 开放平台旧版（无思考，目录标记 `reasoning: false`） |

## 开发

```sh
npm install          # 安装依赖
npm test             # 单测 + mock 全链路（无需 key）
KIMI_API_KEY=... npm test -- tests/smoke.spec.ts   # 真实 API 冒烟（可选）
npm run build        # tsc 构建 lib/
```

## 测试覆盖

- `serialize.spec.ts` — 思考参数映射（thinking/reasoning_effort）、图片、工具消息、reasoning 回传、非思考模型
- `translate.spec.ts` — SSE chunk 翻译（reasoning/text/tool/finish/usage 顺序）
- `adapter.spec.ts` — 对本地 mock Kimi API 的流式、错误映射、取消、元数据
- `loader-composition.spec.ts` — 真实 cordis 装配（三路由注册、请求路由、设置/密钥热更新）
- `index.spec.ts` — 三路由配置解析与校验
- `smoke.spec.ts` — **真实 Kimi Code API**（`KIMI_API_KEY` 门控）：文本/思考流、thinking 关闭、工具调用、max effort、usage 计费（含缓存命中）

## 协议义务

对齐官方 LLM 适配器协议：usage 先于 finish、finish 后零输出、工具参数保持 RAW JSON、错误两路径、尊重 `options.signal`。
