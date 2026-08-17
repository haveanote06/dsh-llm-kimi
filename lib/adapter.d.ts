/**
 * `KimiAdapter`: fetch + SSE against a Kimi (Moonshot) OpenAI-compatible
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * One adapter instance serves BOTH provider routes (`kimi-cn` and
 * `kimi-global`); per-route connection facts are resolved through the
 * `provider` argument of the options thunk.
 *
 * @module dsh-llm-kimi/adapter
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ModelModality, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { CredentialRef } from '@deepseek-ai/dsh-credentials';
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id';
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { RequestDefaults } from './serialize.ts';
import type { WireError } from './types.ts';
/** One optional model entry advertised by the direct-fetch adapter. */
export interface KimiCatalogModel {
    /** Wire model id accepted by the configured endpoint. */
    id: string;
    /** Selector label; defaults to {@link id}. */
    name?: string;
    /** Optional selector detail for deployments with similar model variants. */
    description?: string;
    /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
    contextWindow?: number;
    /** Per-request output cap for this model; omission falls back to the profile's {@link KimiConnectionOptions.maxTokens}. */
    maxTokens?: number;
    /** Accepted request modalities; models declaring `image` accept base64 image input. */
    inputModalities?: ModelModality[];
    /**
     * Whether the model supports the thinking channel. `false` marks legacy
     * text-only models (moonshot-v1) that must never receive thinking fields.
     * Absent means supported/unknown (the thinking-capable Kimi models).
     */
    reasoning?: boolean;
}
/**
 * Validated connection facts for one operation on one provider route. The
 * plugin's `resolveAdapterOptions` is the one explicit resolve step producing
 * this shape; the adapter trusts it and re-reads it per operation, which is
 * what makes a configuration change reach the next request without
 * re-registration.
 */
export interface KimiConnectionOptions {
    /** Endpoint base; `/chat/completions` is appended. */
    baseURL: string;
    /**
     * Credential reference of this same resolution, resolved per request.
     * Travelling with the endpoint is the point: a request can never pair one
     * generation's URL with another generation's secret. Configuration carries
     * only this name — a literal key is not a configuration value.
     */
    apiKeyEnv: CredentialRef;
    /** Request defaults applied to every call (thinking mode, effort). */
    defaults: RequestDefaults;
    /** Default per-request output cap; explicit request values win. */
    maxTokens: number;
    /** Positive context capacity used when the selected model has no exact value. */
    defaultContextWindow: number;
    /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
    models: readonly KimiCatalogModel[];
    /** Maximum provider idle time while one stream read is outstanding. */
    streamIdleTimeoutMs: number;
    /** Provider-owned model-request retry policy, already resolved. */
    retryPolicy: ResolvedRetryPolicy;
}
/** Constructor options for {@link KimiAdapter}: the operation-local resolution hooks the plugin owns. */
export interface KimiAdapterOptions {
    /**
     * Current validated connection facts for one provider route; called once
     * per operation. The provider argument is the registered route key.
     */
    options: (provider: string) => KimiConnectionOptions;
    /**
     * Resolve the bearer token for the connection facts of one request. The
     * snapshot is passed in — never re-read — so the key can only ever come
     * from the same resolution as the endpoint it is sent to. `provider` is the
     * registered route key, so a missing-key error can name the route and
     * suggest the right environment variable. Throws `LlmError`
     * `MISSING_CREDENTIAL` when no key is available anywhere.
     */
    resolveApiKey: (connection: KimiConnectionOptions, provider: string) => Promise<string>;
    /** Resolve the harness-home anonymous id shared with telemetry and feedback. */
    resolveUserId: () => AnonymousUserId;
    /**
     * Resolve stored image bytes for one image block, for multimodal models.
     * Wire through the attachment service (`ctx.attachments.readImage`).
     */
    resolveImage: (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>;
}
/** Default maximum idle interval while an adapter stream read is outstanding. */
export declare const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300000;
/** Default combined request/response context capacity. */
export declare const DEFAULT_CONTEXT_WINDOW = 1000000;
/** Default per-request output-token cap. */
export declare const DEFAULT_MAX_TOKENS = 256000;
/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export declare function httpErrorCode(status: number, error?: WireError['error']): string;
/**
 * The Kimi `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name) on both
 * provider routes.
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export declare class KimiAdapter extends LlmAdapter {
    private readonly config;
    constructor(config: KimiAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    providerRetryPolicy(_provider: string): ResolvedRetryPolicy;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    private request;
}
/** Display names for the provider routes this adapter owns. */
export declare const PROVIDER_DISPLAY_NAMES: Readonly<Record<string, string>>;
//# sourceMappingURL=adapter.d.ts.map