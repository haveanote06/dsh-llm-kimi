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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-llm';
import { type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment';
import type { KimiCatalogModel, KimiConnectionOptions } from './adapter.ts';
export { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, KimiAdapter, PROVIDER_DISPLAY_NAMES, } from './adapter.ts';
export type { KimiAdapterOptions, KimiCatalogModel, KimiConnectionOptions } from './adapter.ts';
export type { RequestDefaults } from './serialize.ts';
export type * from './types.ts';
export declare const name = "llm-kimi";
export declare const inject: string[];
/** The three provider routes this plugin owns. */
export declare const CODE_ROUTE = "kimi-code";
export declare const CN_ROUTE = "kimi-cn";
export declare const GLOBAL_ROUTE = "kimi-global";
export declare const ROUTES: readonly ["kimi-code", "kimi-cn", "kimi-global"];
export type RouteKey = typeof ROUTES[number];
/**
 * Public API defaults; the internal endpoints come from trusted environment
 * layers ($KIMI_BASE_URL / $MOONSHOT_BASE_URL_CN / $MOONSHOT_BASE_URL_GLOBAL).
 */
export declare const PUBLIC_BASE_URL_CODE = "https://api.kimi.com/coding/v1";
export declare const PUBLIC_BASE_URL_CN = "https://api.moonshot.cn/v1";
export declare const PUBLIC_BASE_URL_GLOBAL = "https://api.moonshot.ai/v1";
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
    apiKeyEnv?: string;
    /** Override the credential reference for the Kimi Code subscription route (default `KIMI_API_KEY`). */
    apiKeyEnvCode?: string;
    /** Override the credential reference for the China-mainland route. */
    apiKeyEnvCn?: string;
    /** Override the credential reference for the global route. */
    apiKeyEnvGlobal?: string;
    /** Kimi Code subscription endpoint base; falls back to $KIMI_BASE_URL from a trusted environment layer, then `https://api.kimi.com/coding/v1`. */
    baseURLCode?: string;
    /** China-mainland endpoint base; falls back to $MOONSHOT_BASE_URL_CN from a trusted environment layer, then `https://api.moonshot.cn/v1`. */
    baseURLCn?: string;
    /** Global endpoint base; falls back to $MOONSHOT_BASE_URL_GLOBAL from a trusted environment layer, then `https://api.moonshot.ai/v1`. */
    baseURLGlobal?: string;
    /** Deployment thinking policy; `disabled` limits every conversation request to `off`. */
    thinking?: 'enabled' | 'disabled';
    /** Default thinking effort (default `high`); `off` disables thinking per request. */
    reasoningEffort?: 'off' | 'high' | 'max';
    /** Default per-request output cap (default 256,000); a model's own cap and explicit request values win. */
    maxTokens?: number;
    /** Positive context capacity used when the selected model has no exact value (default 1,000,000). */
    defaultContextWindow?: number;
    /** Advisory models shown by discovery consumers; defaults to the union Kimi catalog. */
    models?: KimiCatalogModel[];
    /** Maximum provider idle time while one stream read is outstanding (default five minutes). */
    streamIdleTimeoutMs?: number;
    /** Provider-owned model-request retry policy; omission uses normal defaults. */
    retryPolicy?: RetryPolicyConfig;
}
export declare const Config: z<Config>;
/** One resolution's complete request facts for every route, keyed by route. */
export type ResolvedKimiOptions = Record<RouteKey, KimiConnectionOptions>;
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
export declare function resolveAdapterOptions(config: Config, environment?: LaunchEnvironmentSnapshot): ResolvedKimiOptions;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map