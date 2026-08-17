/**
 * Kimi (Moonshot / Kimi Code) chat-completions wire format (OpenAI-compatible).
 *
 * Source of truth: live probes of the Kimi Code API (api.kimi.com/coding/v1)
 * and the Moonshot open platform (api.moonshot.cn / api.moonshot.ai), 2026-08.
 * Streaming deltas carry `reasoning_content` for thinking models and
 * OpenAI-style `tool_calls`.
 *
 * @module dsh-llm-kimi/types
 */
/** Request body for `POST {baseURL}/chat/completions`. */
export interface WireRequest {
    model: string;
    messages: WireMessage[];
    stream: true;
    stream_options: {
        include_usage: true;
    };
    /**
     * Thinking-mode toggle (verified against the live Kimi Code API, 2026-08).
     * `{type: 'enabled'}` turns the thinking channel on, `{type: 'disabled'}`
     * turns it off. NOTE: the older boolean spelling `enable_thinking` is
     * silently IGNORED by the API — never send it.
     */
    thinking?: {
        type: 'enabled' | 'disabled';
    };
    /**
     * Thinking effort, top-level. Verified valid values on k3:
     * `low` | `high` | `max` (k3 advertises valid_efforts low/high/max).
     * Only meaningful together with `thinking: {type: 'enabled'}`.
     */
    reasoning_effort?: 'low' | 'high' | 'max';
    tools?: WireTool[];
    temperature?: number;
    max_tokens?: number;
    /** Stop sequences (OpenAI `stop`): generation halts as soon as the model produces any one of these strings. */
    stop?: string[];
}
/**
 * One entry of the request `messages` array, discriminated on `role`.
 * User content may be a plain string (text-only) or a content-part array
 * (text + base64 images) for multimodal models.
 */
export type WireMessage = {
    role: 'system';
    content: string;
} | {
    role: 'user';
    content: string | WireContentPart[];
} | {
    role: 'assistant';
    content: string | null;
    /** CoT passback. Required on assistant turns that carried tool calls; omitted otherwise to save tokens. */
    reasoning_content?: string;
    tool_calls?: WireToolCall[];
} | {
    role: 'tool';
    tool_call_id: string;
    content: string;
};
/** One multimodal content part of a user message. */
export type WireContentPart = {
    type: 'text';
    text: string;
} | {
    type: 'image_url';
    image_url: {
        url: string;
    };
};
/** A completed tool call replayed on an assistant history message; `arguments` is the raw JSON string. */
export interface WireToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}
/** One entry of the request `tools` array; `parameters` is a JSON Schema object. */
export interface WireTool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}
/** One parsed SSE `data:` payload (a chat.completion.chunk). */
export interface WireChunk {
    choices?: WireChoice[];
    /** Arrives attached to the finish chunk and/or as a trailing usage-only chunk. */
    usage?: WireUsage | null;
}
/** One streamed choice (requests always ask for a single one); `finish_reason` is non-null only on its terminal chunk. */
export interface WireChoice {
    delta?: WireDelta;
    finish_reason?: string | null;
}
/** The incremental content of one streamed choice; any subset of fields may be present per chunk. */
export interface WireDelta {
    role?: string;
    /** Visible text. Null/empty on reasoning/tool-call chunks. */
    content?: string | null;
    /** Thinking-mode CoT. The FIRST chunk may carry an empty string (must not open a reasoning block); absent in non-thinking mode. */
    reasoning_content?: string | null;
    tool_calls?: WireToolCallDelta[];
}
/** A streamed fragment of one tool call; fragments sharing an `index` concatenate into one call. */
export interface WireToolCallDelta {
    /** Disambiguates parallel tool calls; stable across a call's deltas. */
    index: number;
    /** Present on the first delta of each call only. */
    id?: string;
    type?: 'function';
    function?: {
        /** Present on the first delta of each call only. */
        name?: string;
        /** Argument JSON fragment (concatenate across deltas). */
        arguments?: string;
    };
}
/**
 * Wire token accounting. `prompt_tokens` INCLUDES cache hits (OpenAI-compat
 * convention); `prompt_tokens_details.cached_tokens` reports the hit count
 * separately. `mapUsage` subtracts them to keep the harness convention of
 * disjoint counts. Thinking models report reasoning tokens under
 * `completion_tokens_details.reasoning_tokens`.
 */
export interface WireUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens?: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    };
    completion_tokens_details?: {
        reasoning_tokens?: number;
    };
}
/** Non-2xx error body. */
export interface WireError {
    error?: {
        message?: string;
        type?: string;
        code?: string;
    };
}
//# sourceMappingURL=types.d.ts.map