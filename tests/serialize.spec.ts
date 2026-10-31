/**
 * Serializer unit tests: harness messages 鈫?Kimi wire request.
 */

import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createToolResultMessage, createUserMessage, LlmError, ReasoningEffortId, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { serializeRequest } from '../src/serialize.ts'
import type { SerializeContext } from '../src/serialize.ts'

const imageModels = new Set(['kimi-k3', 'kimi-k2.6'])
const nonReasoningModels = new Set(['moonshot-v1-128k'])

const noImageContext: SerializeContext = {
  imageModels,
  nonReasoningModels,
  resolveImage: async () => { throw new Error('unexpected image resolution') },
}

function user(text: string): Message {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

describe('serializeRequest', () => {
  it('builds a minimal streaming request with system + user messages', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn',
      model: 'kimi-k3',
      messages: [user('hello')],
      system: 'be terse',
    }, {}, noImageContext)

    expect(request.model).toBe('kimi-k3')
    expect(request.stream).toBe(true)
    expect(request.stream_options).toEqual({ include_usage: true })
    expect(request.messages).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hello' },
    ])
    expect(request.thinking).toBeUndefined()
    expect(request.reasoning_effort).toBeUndefined()
  })

  it('maps reasoningEffort off/high/max to thinking + reasoning_effort wire fields', async () => {
    const off = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
      reasoningEffort: ReasoningEffortId('off'),
    }, {}, noImageContext)
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off.reasoning_effort).toBeUndefined()

    const high = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
      reasoningEffort: ReasoningEffortId('high'),
    }, {}, noImageContext)
    expect(high.thinking).toEqual({ type: 'enabled' })
    expect(high.reasoning_effort).toBe('high')

    const max = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
      reasoningEffort: ReasoningEffortId('max'),
    }, {}, noImageContext)
    expect(max.thinking).toEqual({ type: 'enabled' })
    expect(max.reasoning_effort).toBe('max')

    const fromDefaults = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
    }, { reasoningEffort: 'max' }, noImageContext)
    expect(fromDefaults.thinking).toEqual({ type: 'enabled' })
    expect(fromDefaults.reasoning_effort).toBe('max')
  })

  it('omits thinking fields entirely for non-reasoning models', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'moonshot-v1-128k', messages: [],
      reasoningEffort: ReasoningEffortId('off'),
    }, {}, noImageContext)
    expect(request.thinking).toBeUndefined()
    expect(request.reasoning_effort).toBeUndefined()
  })

  it('rejects a non-off effort on non-reasoning models', async () => {
    await expect(serializeRequest({
      provider: 'kimi-cn', model: 'moonshot-v1-128k', messages: [],
      reasoningEffort: ReasoningEffortId('high'),
    }, {}, noImageContext)).rejects.toThrow(LlmError)
  })

  it('forces thinking off for session-title purposes', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
      purpose: 'session-title',
    }, { reasoningEffort: 'max' }, noImageContext)
    expect(request.thinking).toBeUndefined()
    expect(request.reasoning_effort).toBeUndefined()
  })

  it('rejects a reasoning effort when the deployment disables thinking', async () => {
    await expect(serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [],
    }, { thinking: 'disabled', reasoningEffort: 'high' }, noImageContext))
      .rejects.toThrow(LlmError)
  })

  it('maps tools to OpenAI function schemas', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn',
      model: 'kimi-k3',
      messages: [user('hi')],
      tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
    }, {}, noImageContext)
    expect(request.tools).toEqual([{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }])
  })

  it('replays assistant reasoning_content only on tool-call turns', async () => {
    const assistant = createAssistantMessage({
      content: [
        { type: 'reasoning', text: 'secret chain' },
        { type: 'text', text: '' },
        { type: 'tool-call', id: ToolCallId('call_1'), name: 'read_file', arguments: '{"path":"a.txt"}' },
      ],
      source: { kind: 'model', provider: 'kimi-cn', model: 'kimi-k3' },
    })
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3',
      messages: [user('do it'), assistant],
    }, {}, noImageContext)
    const wireAssistant = request.messages[1]
    expect(wireAssistant).toMatchObject({
      role: 'assistant',
      content: '',
      reasoning_content: 'secret chain',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }],
    })
  })

  it('expands tool results into role:tool messages, keeping mixed user text first', async () => {
    const toolResult = createToolResultMessage({
      callId: ToolCallId('call_1'),
      content: [{ type: 'text', text: 'file contents' }],
      isError: false,
    })
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3',
      messages: [user('here you go'), toolResult],
    }, {}, noImageContext)
    expect(request.messages).toEqual([
      { role: 'user', content: 'here you go' },
      { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
    ])
  })

  it('puts a placeholder in empty tool results', async () => {
    const emptyResult = createToolResultMessage({
      callId: ToolCallId('call_9'),
      content: [],
      isError: false,
    })
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [emptyResult],
    }, {}, noImageContext)
    expect(request.messages).toEqual([
      { role: 'tool', tool_call_id: 'call_9', content: '(no output)' },
    ])
  })
})

describe('image serialization', () => {
  const ref: ImageAttachmentRef = {
    attachmentId: 'att-1' as ImageAttachmentRef['attachmentId'],
    mediaType: 'image/png',
    bytes: 4,
    width: 2,
    height: 2,
  }

  const imageContext: SerializeContext = {
    imageModels,
    nonReasoningModels,
    resolveImage: async (imageRef) => ({
      ref: imageRef,
      data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }),
  }

  function userWithImage(): Message {
    return createUserMessage({
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image', attachment: ref },
      ],
      source: { kind: 'user' },
    })
  }

  it('embeds images as base64 data URIs for multimodal models', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3', messages: [userWithImage()],
    }, {}, imageContext)
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'what is this?' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } },
      ],
    })
  })

  it('rejects image content for text-only models', async () => {
    await expect(serializeRequest({
      provider: 'kimi-cn', model: 'moonshot-v1-128k', messages: [userWithImage()],
    }, {}, imageContext)).rejects.toThrow(LlmError)
  })

  it('supports image-only user messages', async () => {
    const request = await serializeRequest({
      provider: 'kimi-cn', model: 'kimi-k3',
      messages: [createUserMessage({
        content: [{ type: 'image', attachment: ref }],
        source: { kind: 'user' },
      })],
    }, {}, imageContext)
    expect(request.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw==' } }],
    })
  })
})
