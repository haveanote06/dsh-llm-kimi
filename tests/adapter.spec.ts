/**
 * KimiAdapter tests against the local mock chat-completions server: chunk
 * protocol, error mapping, abort, credential resolution, and request shape.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { BlockAssembler, createUserMessage, LlmError, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { KimiAdapter } from '../src/adapter.ts'
import type { KimiConnectionOptions } from '../src/adapter.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/adapter.ts'
import { closeMockServers, mockServer, textEvents, thinkingEvents, toolCallEvents, trailingUsageEvents } from './mock-server.ts'

const TEST_USER_ID = 'test-user' as unknown as AnonymousUserId

const CATALOG: KimiConnectionOptions['models'] = [
  { id: 'kimi-k3', contextWindow: 1_000_000, inputModalities: ['text', 'image'] },
  { id: 'moonshot-v1-128k', contextWindow: 128_000 },
]

function connection(baseURL: string): KimiConnectionOptions {
  return {
    baseURL,
    apiKeyEnv: credentialRef('MOONSHOT_API_KEY'),
    defaults: {},
    maxTokens: DEFAULT_MAX_TOKENS,
    defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
    models: CATALOG,
    streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'kimi-test'),
  }
}

function adapter(baseURL: string, overrides?: Partial<ConstructorParameters<typeof KimiAdapter>[0]>) {
  return new KimiAdapter({
    options: () => connection(baseURL),
    resolveApiKey: async () => 'test-key',
    resolveUserId: () => TEST_USER_ID,
    resolveImage: async () => { throw new Error('no image in this test') },
    ...overrides,
  })
}

const userMessage = createUserMessage({
  content: [{ type: 'text', text: 'hello' }],
  source: { kind: 'user' },
})

async function assemble(baseURL: string, model = 'kimi-k3', overrides?: Partial<ConstructorParameters<typeof KimiAdapter>[0]>) {
  const assembler = new BlockAssembler()
  for await (const chunk of adapter(baseURL, overrides).stream({
    provider: 'kimi-cn',
    model,
    messages: [userMessage],
  })) assembler.push(chunk)
  return { assembler, message: assembler.message({ kind: 'model', provider: 'kimi-cn', model }) }
}

afterEach(async () => {
  await closeMockServers()
})

describe('KimiAdapter.stream', () => {
  it('assembles a text completion and reports usage', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { assembler, message } = await assemble(server.url)

    expect(server.requests[0]).toMatchObject({
      model: 'kimi-k3',
      stream: true,
      messages: [{ role: 'user', content: 'hello' }],
    })
    expect(server.headers[0]?.authorization).toBe('Bearer test-key')
    expect(message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(assembler.usage).toEqual({ inputTokens: 3, outputTokens: 1 })
    expect(assembler.finish).toEqual({ kind: 'stop' })
  })

  it('streams thinking-mode reasoning deltas into a reasoning block', async () => {
    const server = await mockServer([{ kind: 'sse', events: thinkingEvents }])
    const { assembler } = await assemble(server.url)

    const reasoning = assembler.message({ kind: 'model', provider: 'kimi-cn', model: 'kimi-k3' })
      .content.find(block => block.type === 'reasoning')
    expect(reasoning).toEqual({ type: 'reasoning', text: 'let me think about it' })
    expect(assembler.usage?.reasoningTokens).toBe(8)
  })

  it('assembles tool calls into a tool-call block', async () => {
    const server = await mockServer([{ kind: 'sse', events: toolCallEvents }])
    const { assembler } = await assemble(server.url)

    const toolCall = assembler.message({ kind: 'model', provider: 'kimi-cn', model: 'kimi-k3' })
      .content.find(block => block.type === 'tool-call')
    expect(toolCall).toMatchObject({ type: 'tool-call', name: 'read_file', arguments: '{"path":"a.txt"}' })
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
  })

  it('accepts a trailing usage-only chunk', async () => {
    const server = await mockServer([{ kind: 'sse', events: trailingUsageEvents }])
    const { assembler } = await assemble(server.url)
    expect(assembler.usage).toEqual({ inputTokens: 2, outputTokens: 2, cacheReadTokens: 3 })
  })

  it('sends thinking + reasoning_effort for a reasoning effort and omits them otherwise', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const assembler = new BlockAssembler()
    for await (const chunk of adapter(server.url).stream({
      provider: 'kimi-cn',
      model: 'kimi-k3',
      messages: [userMessage],
      reasoningEffort: ReasoningEffortId('high'),
    })) assembler.push(chunk)
    const body = server.requests[0] as { thinking?: { type: string }; reasoning_effort?: string }
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body.reasoning_effort).toBe('high')

    const plainServer = await mockServer([{ kind: 'sse', events: textEvents }])
    const plainAssembler = new BlockAssembler()
    for await (const chunk of adapter(plainServer.url).stream({
      provider: 'kimi-cn',
      model: 'kimi-k3',
      messages: [userMessage],
    })) plainAssembler.push(chunk)
    const plainBody = plainServer.requests[0] as { thinking?: unknown; reasoning_effort?: unknown }
    expect(plainBody.thinking).toBeUndefined()
    expect(plainBody.reasoning_effort).toBeUndefined()
  })
})

describe('error mapping', () => {
  it('maps 401 to AUTH', async () => {
    const server = await mockServer([{
      kind: 'http-error', status: 401,
      body: JSON.stringify({ error: { message: 'invalid api key', type: 'authentication_error' } }),
    }])
    await expect(assemble(server.url)).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('maps 429 with retry-after to RATE_LIMIT with providerRetryAfterMs', async () => {
    const server = await mockServer([{
      kind: 'http-error', status: 429,
      body: JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit_error' } }),
      headers: { 'retry-after': '5' },
    }])
    await expect(assemble(server.url)).rejects.toMatchObject({
      code: 'RATE_LIMIT',
      failure: { providerRetryAfterMs: 5000 },
    })
  })

  it('maps 400 context-window errors to CONTEXT_WINDOW_EXCEEDED', async () => {
    const server = await mockServer([{
      kind: 'http-error', status: 400,
      body: JSON.stringify({ error: { message: 'context length exceeded', type: 'invalid_request_error' } }),
    }])
    await expect(assemble(server.url)).rejects.toMatchObject({ code: 'CONTEXT_WINDOW_EXCEEDED' })
  })

  it('maps 500 to SERVER', async () => {
    const server = await mockServer([{
      kind: 'http-error', status: 500,
      body: JSON.stringify({ error: { message: 'boom', type: 'server_error' } }),
    }])
    await expect(assemble(server.url)).rejects.toMatchObject({ code: 'SERVER' })
  })

  it('captures x-request-id into the LlmError', async () => {
    const server = await mockServer([{
      kind: 'http-error', status: 500,
      body: JSON.stringify({ error: { message: 'boom', type: 'server_error' } }),
      headers: { 'x-request-id': 'req-abc' },
    }])
    await expect(assemble(server.url)).rejects.toMatchObject({
      code: 'SERVER',
      failure: { requestId: 'req-abc' },
    })
  })

  it('reports MISSING_CREDENTIAL when no key resolves', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    await expect(assemble(server.url, 'kimi-k3', {
      resolveApiKey: async () => { throw new LlmError('no key', 'MISSING_CREDENTIAL') },
    })).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(server.requests).toHaveLength(0)
  })
})

describe('metadata', () => {
  it('describes provider routes by name', () => {
    const instance = adapter('http://unused')
    expect(instance.providerInfo('kimi-cn').name).toBe('Kimi (Moonshot CN)')
    expect(instance.providerInfo('kimi-global').name).toBe('Kimi (Moonshot Global)')
  })

  it('lists catalog models with modalities', async () => {
    const instance = adapter('http://unused')
    const models = await instance.listModels('kimi-cn')
    expect(models.map(model => model.id)).toEqual(['kimi-k3', 'moonshot-v1-128k'])
    expect(models[0]).toMatchObject({ inputModalities: ['text', 'image'] })
  })

  it('resolves model metadata with context and reasoning efforts', async () => {
    const instance = adapter('http://unused')
    const resolved = await instance.resolveModel('kimi-cn', 'kimi-k3')
    expect(resolved.context).toEqual({ contextWindow: 1_000_000 })
    expect(resolved.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'high', 'max'])
    expect(resolved.defaultMaxTokens).toBe(DEFAULT_MAX_TOKENS)
  })

  it('declares text-only capability for uncatalogued models', async () => {
    const instance = adapter('http://unused')
    const resolved = await instance.resolveModel('kimi-cn', 'unknown-model')
    expect(resolved.inputModalities).toEqual(['text'])
  })
})

describe('lifecycle', () => {
  it('maps caller abort to ABORTED', async () => {
    // Delay every event so no chunk is buffered before the abort lands; the
    // pending body read then rejects deterministically.
    const server = await mockServer([{ kind: 'sse', events: textEvents, delayMs: 200 }])
    const controller = new AbortController()
    const iterator = adapter(server.url).stream({
      provider: 'kimi-cn',
      model: 'kimi-k3',
      messages: [userMessage],
      signal: controller.signal,
    })[Symbol.asyncIterator]()
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('surfaces a clean mid-stream EOF without [DONE] as STREAM_CLOSED', async () => {
    // A normal response end with no [DONE] sentinel is truncation.
    const server = await mockServer([{ kind: 'sse', events: textEvents.slice(0, 2) }])
    await expect(assemble(server.url)).rejects.toMatchObject({ code: 'STREAM_CLOSED' })
  })
})
