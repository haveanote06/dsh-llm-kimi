/**
 * Serialize harness messages into Kimi chat completions. User text is joined;
 * assistant text becomes `content`, tool calls become `tool_calls`, and tool
 * results become separate tool messages. Assistant reasoning is replayed as
 * `reasoning_content` only on tool-call turns, as required by thinking-mode
 * passback. Image blocks are resolved through the attachment service and
 * embedded as base64 data URIs for multimodal models; other models reject
 * image content explicitly because this wire route is text-only for them.
 *
 * @module dsh-llm-kimi/serialize
 */
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment';
import type { WireMessage, WireRequest } from './types.ts';
/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
    thinking?: 'enabled' | 'disabled' | undefined;
    reasoningEffort?: 'off' | 'high' | 'max' | undefined;
}
/** Resolve stored image bytes for one image block. */
export type ImageResolver = (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>;
/** Serialization context: which models accept images, and how to fetch image bytes. */
export interface SerializeContext {
    /** Model ids that accept base64 image input. */
    imageModels: ReadonlySet<string>;
    /** Model ids whose `reasoning` capability is explicitly disabled (text-only legacy models). */
    nonReasoningModels: ReadonlySet<string>;
    /** Resolve stored image bytes for one image block (via the attachment service). */
    resolveImage: ImageResolver;
}
/**
 * Serialize the conversation. Tool results arrive as their own `role: 'tool'`
 * messages carrying a tool-call id; Moonshot wants exactly that shape, so each
 * one maps to a `{role: 'tool', tool_call_id, content}` entry in place.
 * @param messages - the harness request messages, in order.
 * @param ctx - serialization context (image policy + resolver).
 * @param model - the target wire model id.
 * @returns the wire messages; order preserved.
 */
export declare function serializeMessages(messages: readonly RequestMessage[], ctx: SerializeContext, model: string): Promise<WireMessage[]>;
/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply. Async because image blocks resolve through the
 * attachment service.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @param ctx - serialization context (image policy + resolver).
 * @returns the chat-completions request body.
 */
export declare function serializeRequest(options: GenerateOptions, defaults: RequestDefaults, ctx: SerializeContext): Promise<WireRequest>;
//# sourceMappingURL=serialize.d.ts.map