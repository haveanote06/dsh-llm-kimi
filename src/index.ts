/**
 * Register a {@link KimiAdapter} for the `kimi-cn` and `kimi-global` provider
 * routes on `ctx.llm`, with connection facts resolved per request instead of
 * frozen at load: the plugin layers its `cordis.yml` entry config under the
 * optional `llm-kimi` user-settings section (`ctx.settings`) and resolves the
 * API key through the optional credential seam (`ctx.credentials`), so a
 * changed base URL, catalog, or key reaches the very next request without
 * restarting anything, while an in-flight stream keeps the facts it started
 * with. The one registration-captured fact — the retry policy — re-registers
 * the routes in place when it changes.
 *
 * @module dsh-llm-kimi
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { assertUsableApiKey, LlmError, resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ModelModality, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { getOrCreateAnonymousUserId, type AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  KimiAdapter,
  PROVIDER_DISPLAY_NAMES,
} from './adapter.ts'
import type { KimiCatalogModel, KimiConnectionOptions } from './adapter.ts'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { invariant } from './invariant.ts'

export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_TOKENS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  KimiAdapter,
  PROVIDER_DISPLAY_NAMES,
} from './adapter.ts'
export type { KimiAdapterOptions, KimiCatalogModel, KimiConnectionOptions } from './adapter.ts'
export type { RequestDefaults } from './serialize.ts'
export type * from './types.ts'

export const name = 'llm-kimi'
export const inject = ['llm']

const NS = settingsNamespace('llm-kimi')
const DEFAULT_API_KEY_ENV = 'MOONSHOT_API_KEY'
const DEFAULT_API_KEY_ENV_CODE = 'KIMI_API_KEY'

/** The three provider routes this plugin owns. */
export const CODE_ROUTE = 'kimi-code'
export const CN_ROUTE = 'kimi-cn'
export const GLOBAL_ROUTE = 'kimi-global'
export const ROUTES = [CODE_ROUTE, CN_ROUTE, GLOBAL_ROUTE] as const
export type RouteKey = typeof ROUTES[number]

/**
 * Public API defaults; the internal endpoints come from trusted environment
 * layers ($KIMI_BASE_URL / $MOONSHOT_BASE_URL_CN / $MOONSHOT_BASE_URL_GLOBAL).
 */
export const PUBLIC_BASE_URL_CODE = 'https://api.kimi.com/coding/v1'
export const PUBLIC_BASE_URL_CN = 'https://api.moonshot.cn/v1'
export const PUBLIC_BASE_URL_GLOBAL = 'https://api.moonshot.ai/v1'

/** Environment variables naming each provider's endpoint, honored only from trusted layers. */
const BASE_URL_ENV_CODE = 'KIMI_BASE_URL'
const BASE_URL_ENV_CN = 'MOONSHOT_BASE_URL_CN'
const BASE_URL_ENV_GLOBAL = 'MOONSHOT_BASE_URL_GLOBAL'

/**
 * Advisory catalog for all three routes (union). Kimi Code subscription keys
 * unlock kimi-for-coding/k3; Moonshot open-platform keys unlock kimi-k3 /
 * kimi-k2.x / moonshot-v1. Model ids are passed through to the wire without
 * validation, so the union is safe on every route.
 */
const DEFAULT_MODELS: KimiCatalogModel[] = [
  { id: 'kimi-for-coding', name: 'Kimi For Coding (K2.7)', contextWindow: 262_144, inputModalities: ['text', 'image'] },
  { id: 'kimi-for-coding-highspeed', name: 'Kimi For Coding Highspeed', contextWindow: 262_144, inputModalities: ['text', 'image'] },
  { id: 'k3', name: 'Kimi K3', contextWindow: 1_048_576, inputModalities: ['text', 'image'] },
  { id: 'k3-256k', name: 'Kimi K3 256K', contextWindow: 262_144, inputModalities: ['text', 'image'] },
  { id: 'kimi-k3', name: 'Kimi K3 (Open Platform)', contextWindow: 1_000_000, inputModalities: ['text', 'image'] },
  { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 256_000, inputModalities: ['text', 'image'] },
  { id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', contextWindow: 256_000, inputModalities: ['text', 'image'] },
  { id: 'moonshot-v1-128k', name: 'Moonshot V1 128K', contextWindow: 128_000, reasoning: false },
  { id: 'moonshot-v1-32k', name: 'Moonshot V1 32K', contextWindow: 32_000, reasoning: false },
  { id: 'moonshot-v1-8k', name: 'Moonshot V1 8K', contextWindow: 8_000, reasoning: false },
]

/**
 * Plugin config, validated by the same-named schemastery schema and doubling
 * as the `llm-kimi` settings-section shape. Every field is optional in yml: a
 * missing API key resolves through the credential references at each request
 * (a request without any key fails with `MISSING_CREDENTIAL`, not at plugin
 * load), omitted thinking mode uses the provider default, and omitted
 * reasoning effort resolves to `high`.
 */
export interface Config {
  /** Credential reference (environment-variable name) resolved per request; the fallback for all routes. */
  apiKeyEnv?: string
  /** Override the credential reference for the Kimi Code subscription route (default `KIMI_API_KEY`). */
  apiKeyEnvCode?: string
  /** Override the credential reference for the China-mainland route. */
  apiKeyEnvCn?: string
  /** Override the credential reference for the global route. */
  apiKeyEnvGlobal?: string
  /** Kimi Code subscription endpoint base; falls back to $KIMI_BASE_URL from a trusted environment layer, then `https://api.kimi.com/coding/v1`. */
  baseURLCode?: string
  /** China-mainland endpoint base; falls back to $MOONSHOT_BASE_URL_CN from a trusted environment layer, then `https://api.moonshot.cn/v1`. */
  baseURLCn?: string
  /** Global endpoint base; falls back to $MOONSHOT_BASE_URL_GLOBAL from a trusted environment layer, then `https://api.moonshot.ai/v1`. */
  baseURLGlobal?: string
  /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
  thinking?: 'enabled' | 'disabled'
  /** Default thinking effort (default `high`); `off` disables thinking per request. */
  reasoningEffort?: 'off' | 'high' | 'max'
  /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
  maxTokens?: number
  /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
  defaultContextWindow?: number
  /** Advisory models shown by discovery consumers; defaults to the union Kimi catalog. */
  models?: KimiCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
  streamIdleTimeoutMs?: number
  /** Provider-owned model-request retry policy; omission uses normal defaults. */
  retryPolicy?: RetryPolicyConfig
}

const MODALITIES: readonly ModelModality[] = ['text', 'image']

const catalogModel: z<KimiCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(['text', 'image'])),
  reasoning: z.boolean(),
})

export const Config: z<Config> = z.object({
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  apiKeyEnvCode: z.string().role('credential-ref'),
  apiKeyEnvCn: z.string().role('credential-ref'),
  apiKeyEnvGlobal: z.string().role('credential-ref'),
  baseURLCode: z.string(),
  baseURLCn: z.string(),
  baseURLGlobal: z.string(),
  thinking: z.union(['enabled', 'disabled']),
  reasoningEffort: z.union(['off', 'high', 'max']),
  maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  streamIdleTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** One resolution's complete request facts for every route, keyed by route. */
export type ResolvedKimiOptions = Record<RouteKey, KimiConnectionOptions>

/**
 * Validate, and detach the advisory model catalog. Absent optional fields
 * may arrive as `null` after Schemastery normalization, so every check treats
 * null and undefined alike.
 */
function resolveModels(models: readonly KimiCatalogModel[] | undefined): KimiCatalogModel[] {
  const seen = new Set<string>()
  return (models ?? DEFAULT_MODELS).map((model) => {
    if (model.id.length === 0) throw new Error('llm-kimi: catalog model ids must be non-empty')
    if (model.name != null && model.name.length === 0) {
      throw new Error(`llm-kimi: catalog model "${model.id}" has an empty name`)
    }
    if (model.contextWindow != null
      && (!Number.isInteger(model.contextWindow) || model.contextWindow <= 0)) {
      throw new Error(
        `llm-kimi: catalog model "${model.id}" contextWindow must be a positive integer`,
      )
    }
    if (model.maxTokens != null
      && (!Number.isInteger(model.maxTokens) || model.maxTokens <= 0)) {
      throw new Error(
        `llm-kimi: catalog model "${model.id}" maxTokens must be a positive integer`,
      )
    }
    const modalities = model.inputModalities as ModelModality[] | null | undefined
    if (modalities != null) {
      // An empty array is a valid "no declared modalities" (text-only) state —
      // Schemastery normalizes absent optional arrays to `[]`.
      invariant(
        modalities.every(modality => MODALITIES.includes(modality)),
        `llm-kimi: catalog model "${model.id}" has invalid inputModalities`,
      )
    }
    if (seen.has(model.id)) throw new Error(`llm-kimi: duplicate catalog model "${model.id}"`)
    seen.add(model.id)
    return {
      id: model.id,
      ...model.name == null ? {} : { name: model.name },
      ...model.description == null ? {} : { description: model.description },
      ...model.contextWindow == null ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens == null ? {} : { maxTokens: model.maxTokens },
      ...modalities == null ? {} : { inputModalities: [...modalities] },
      ...model.reasoning == null ? {} : { reasoning: model.reasoning },
    }
  })
}

/**
 * The one explicit resolve step from raw config to validated connection
 * facts for both routes. Programmatic construction may bypass Schemastery
 * normalization, so every default and bound is re-judged here — for the
 * composition entry at load (fail loud) and for each settings snapshot at its
 * first use.
 * @param config - raw plugin config or resolved settings snapshot.
 * @param environment - this run's environment layers, or `undefined` outside
 * the product CLI. Every layer may supply an endpoint: the product trusts the
 * project it is launched in, so a checkout can point its own agent at the
 * gateway that checkout is meant to use.
 * @returns validated connection facts plus the credential references.
 */
export function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedKimiOptions {
  if (config.thinking === 'disabled'
    && config.reasoningEffort !== undefined
    && config.reasoningEffort !== 'off') {
    throw new Error('llm-kimi: only reasoningEffort "off" can be configured when thinking is disabled')
  }
  if (config.defaultContextWindow !== undefined
    && (!Number.isInteger(config.defaultContextWindow) || config.defaultContextWindow <= 0)) {
    throw new Error('llm-kimi: defaultContextWindow must be a positive integer')
  }
  if (config.maxTokens !== undefined
    && (!Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0)) {
    throw new Error('llm-kimi: maxTokens must be a positive safe integer')
  }
  const streamIdleTimeoutMs = config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS
  if (!Number.isFinite(streamIdleTimeoutMs)
    || streamIdleTimeoutMs <= 0
    || streamIdleTimeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `llm-kimi: streamIdleTimeoutMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    )
  }
  const shared = {
    defaults: {
      thinking: config.thinking,
      reasoningEffort: config.reasoningEffort,
    },
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    defaultContextWindow: config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW,
    models: resolveModels(config.models),
    streamIdleTimeoutMs,
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-kimi: retryPolicy'),
  }
  return {
    [CODE_ROUTE]: {
      ...shared,
      // Kimi Code subscription keys conventionally live in $KIMI_API_KEY.
      apiKeyEnv: credentialRef(config.apiKeyEnvCode ?? config.apiKeyEnv ?? DEFAULT_API_KEY_ENV_CODE),
      baseURL: config.baseURLCode
        ?? environment?.get(BASE_URL_ENV_CODE)?.value
        ?? PUBLIC_BASE_URL_CODE,
    },
    [CN_ROUTE]: {
      ...shared,
      apiKeyEnv: credentialRef(config.apiKeyEnvCn ?? config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
      baseURL: config.baseURLCn
        ?? environment?.get(BASE_URL_ENV_CN)?.value
        ?? PUBLIC_BASE_URL_CN,
    },
    [GLOBAL_ROUTE]: {
      ...shared,
      apiKeyEnv: credentialRef(config.apiKeyEnvGlobal ?? config.apiKeyEnv ?? DEFAULT_API_KEY_ENV),
      baseURL: config.baseURLGlobal
        ?? environment?.get(BASE_URL_ENV_GLOBAL)?.value
        ?? PUBLIC_BASE_URL_GLOBAL,
    },
  }
}

export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let lastRaw: Config | undefined
  let lastGood: ResolvedKimiOptions | undefined
  const options = (provider: string): KimiConnectionOptions => {
    const raw = current()
    if (raw === lastRaw && lastGood !== undefined) return lastGood[provider as RouteKey]
    try {
      const next = resolveAdapterOptions(raw, launchEnvironmentOf(ctx))
      lastRaw = raw
      lastGood = next
      return next[provider as RouteKey]
    } catch (error) {
      // Static composition resolves before anything registers, so this branch
      // only sees a live settings snapshot failing a beyond-schema bound:
      // keep serving the last good facts and say so once per bad snapshot.
      if (lastGood === undefined) throw error
      lastRaw = raw
      ctx.logger.error('llm-kimi: keeping the last good configuration after an invalid settings section')
      ctx.logger.error(error)
      return lastGood[provider as RouteKey]
    }
  }
  options(CODE_ROUTE)
  options(CN_ROUTE)
  options(GLOBAL_ROUTE)

  const resolveApiKey = async (connection: KimiConnectionOptions, provider: string): Promise<string> => {
    // Every credential fact comes from the caller's snapshot, so a rejected
    // settings generation cannot leak its key onto the previous endpoint.
    const ref = connection.apiKeyEnv
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(ref)
      if (hit !== undefined) return assertUsableApiKey(hit.value, 'llm-kimi', ref)
    }
    // The environment is the fallback credential plane even when a managed
    // store exists: the error message promises `export … in the launching
    // environment` as a working path, so it must be one.
    const ambient = launchEnvironmentOf(ctx).get(ref)
    if (ambient !== undefined && ambient.value.length > 0) {
      return assertUsableApiKey(ambient.value, 'llm-kimi', ref)
    }
    const displayName = PROVIDER_DISPLAY_NAMES[provider] ?? provider
    const hint = provider === CODE_ROUTE
      ? 'Kimi Code subscription keys (sk-kimi-*) belong to this route; export KIMI_API_KEY'
      : `export ${ref} (or configure apiKeyEnvCn / apiKeyEnvGlobal for the per-route key)`
    throw new LlmError(
      `llm-kimi: no API key for "${displayName}" (credential reference ${ref}); store it through the`
      + ` credentials service (the web Models page writes it), or ${hint} in the launching environment`,
      'MISSING_CREDENTIAL',
    )
  }

  let userId: AnonymousUserId | undefined
  const resolveUserId = (): AnonymousUserId => userId ??= getOrCreateAnonymousUserId()

  const resolveImage = async (ref: ImageAttachmentRef, signal?: AbortSignal) => {
    const attachments = ctx.get('attachments')
    if (attachments === undefined) {
      throw new LlmError(
        'Kimi image input requires the attachments service, which is not available in this deployment',
        'UNSUPPORTED_CONTENT',
      )
    }
    return attachments.readImage(ref, signal)
  }

  const adapter = new KimiAdapter({ options, resolveApiKey, resolveUserId, resolveImage })
  ctx.llm.registerConfigurableProviders([
    { provider: CODE_ROUTE, displayName: 'Kimi Code', settingsNs: NS, settingsPath: [] },
    { provider: CN_ROUTE, displayName: 'Kimi (Moonshot CN)', settingsNs: NS, settingsPath: [] },
    { provider: GLOBAL_ROUTE, displayName: 'Kimi (Moonshot Global)', settingsNs: NS, settingsPath: [] },
  ])
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below.
  const registration = ctx.llm.registerAdapter([CODE_ROUTE, CN_ROUTE, GLOBAL_ROUTE], adapter)
  let registeredPolicy = options(CODE_ROUTE).retryPolicy
  const ensureRegistrationFacts = (): void => {
    const policy = options(CODE_ROUTE).retryPolicy
    if (deepEqualJson(policy, registeredPolicy)) return
    // The registry captures the retry policy at registration, so it is the one
    // fact per-request resolution cannot refresh. `replace` re-reads it in one
    // synchronous registry section: disposing and re-registering instead would
    // publish an empty route set between the two, and an observer that reacted
    // to it would see this provider disappear and come back.
    registration.replace([CODE_ROUTE, CN_ROUTE, GLOBAL_ROUTE])
    registeredPolicy = policy
  }

  installSettingsSection(ctx, NS, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: ensureRegistrationFacts,
  })
}
