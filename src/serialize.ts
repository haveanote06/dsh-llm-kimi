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

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { WireContentPart, WireMessage, WireRequest, WireTool } from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'high' | 'max' | undefined
}

/** Resolve stored image bytes for one image block. */
export type ImageResolver = (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<StoredImageAttachment>

/** Serialization context: which models accept images, and how to fetch image bytes. */
export interface SerializeContext {
  /** Model ids that accept base64 image input. */
  imageModels: ReadonlySet<string>
  /** Model ids whose `reasoning` capability is explicitly disabled (text-only legacy models). */
  nonReasoningModels: ReadonlySet<string>
  /** Resolve stored image bytes for one image block (via the attachment service). */
  resolveImage: ImageResolver
}

interface ResolvedThinking {
  thinkingType?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Validate the adapter-owned effort before resolving its Kimi wire field. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'high' | 'max' {
  if (effort === 'off' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'high' | 'max'
  }
  throw new LlmError(
    `Kimi does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Resolve one legal thinking/effort pair to the Kimi wire fields, verified
 * against the live API (2026-08): `thinking: {type: 'enabled'|'disabled'}`
 * toggles the channel (the boolean `enable_thinking` is ignored), and
 * `reasoning_effort: 'low'|'high'|'max'` is the top-level effort knob.
 *
 * Models declared non-reasoning (legacy moonshot-v1) never receive thinking
 * fields; an explicit non-off effort on them is unsupported and throws.
 */
function resolveThinking(
  options: GenerateOptions,
  defaults: RequestDefaults,
  supportsReasoning: boolean,
): ResolvedThinking {
  if (options.purpose === 'session-title') return {}
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `Kimi deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (!supportsReasoning) {
    if (effort !== undefined && effort !== 'off') {
      throw new LlmError(
        `Kimi model "${options.model}" does not support reasoning effort "${effort}"`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
    }
    return {}
  }
  if (effort === 'off') return { thinkingType: 'disabled' }
  if (effort === 'high') return { thinkingType: 'enabled', reasoningEffort: 'high' }
  if (effort === 'max') return { thinkingType: 'enabled', reasoningEffort: 'max' }
  return defaults.thinking === undefined
    ? {}
    : { thinkingType: defaults.thinking }
}

/** Join the text blocks of a message (used for user text and tool-result content). */
function flattenText(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Encode stored image bytes as a base64 data URI Moonshot accepts. */
function dataUri(stored: StoredImageAttachment): string {
  return `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}`
}

/** Reject image content when the target model is not multimodal. */
function assertModelAcceptsImages(model: string, imageModels: ReadonlySet<string>): void {
  if (!imageModels.has(model)) {
    throw new LlmError(
      `Kimi model "${model}" does not accept image content.`,
      'UNSUPPORTED_CONTENT',
    )
  }
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns replay
    // message.content verbatim (""), and some gateways reject null outright.
    content: text,
    // Passback rule: reasoning_content must return on tool-call turns; it is
    // ignored on plain turns, so we drop it there to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize a user message, embedding images as data URIs when multimodal.
 * Text-only messages serialize to a plain string; image-bearing messages
 * serialize to a content-part array. Tool results are their own messages in
 * this vocabulary, so a user message contributes nothing when it carries
 * neither text nor images.
 */
async function serializeUser(
  message: RequestMessage,
  ctx: SerializeContext,
  model: string,
): Promise<WireMessage | undefined> {
  const text = flattenText(message.content)
  const images = message.content.filter(block => block.type === 'image')
  if (text.length === 0 && images.length === 0) return undefined
  if (images.length === 0) return { role: 'user', content: text }
  const parts: WireContentPart[] = []
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const image of images) {
    assertModelAcceptsImages(model, ctx.imageModels)
    const stored = await ctx.resolveImage(image.attachment)
    parts.push({ type: 'image_url', image_url: { url: dataUri(stored) } })
  }
  return { role: 'user', content: parts }
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
export async function serializeMessages(
  messages: readonly RequestMessage[],
  ctx: SerializeContext,
  model: string,
): Promise<WireMessage[]> {
  const wire: WireMessage[] = []
  for (const message of messages) {
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'developer') {
      // Developer instructions (tool-change notes) are harness bookkeeping;
      // the route receives the projected tool declarations instead.
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    if (message.role === 'tool') {
      wire.push({
        role: 'tool',
        tool_call_id: message.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(message.content) || '(no output)',
      })
      continue
    }
    const user = await serializeUser(message, ctx, model)
    if (user !== undefined) wire.push(user)
  }
  return wire
}

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
export async function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults,
  ctx: SerializeContext,
): Promise<WireRequest> {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...await serializeMessages(options.messages, ctx, options.model))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  // A short title budget must produce visible text; conversation and
  // compaction calls continue to inherit the adapter's thinking defaults.
  const supportsReasoning = !ctx.nonReasoningModels.has(options.model)
  const resolvedThinking = resolveThinking(options, defaults, supportsReasoning)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinkingType !== undefined
      ? { thinking: { type: resolvedThinking.thinkingType } }
      : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}
