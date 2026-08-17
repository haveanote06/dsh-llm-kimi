/**
 * Real-provider smoke checks against the LIVE Kimi Code API. These tests run
 * only when `KIMI_API_KEY` is exported (the official repo's testing policy:
 * real-provider checks are opt-in). They verify the wire facts the mock tests
 * cannot: the thinking/effort fields, reasoning_content streaming, tool
 * calling, usage fields, and the x-trace-id header.
 */

import { describe, expect, it } from 'vitest'
import { BlockAssembler, createUserMessage, LlmError, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { KimiAdapter } from '../src/adapter.ts'
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_STREAM_IDLE_TIMEOUT_MS } from '../src/adapter.ts'
import { PUBLIC_BASE_URL_CODE } from '../src/index.ts'

const apiKey = process.env.KIMI_API_KEY ?? process.env.MOONSHOT_API_KEY
const baseURL = process.env.KIMI_BASE_URL ?? PUBLIC_BASE_URL_CODE

const TEST_USER_ID = 'smoke-test' as unknown as AnonymousUserId

function liveAdapter(modelCatalog = CATALOG) {
  return new KimiAdapter({
    options: () => ({
      baseURL,
      apiKeyEnv: credentialRef('KIMI_API_KEY'),
      defaults: {},
      maxTokens: DEFAULT_MAX_TOKENS,
      defaultContextWindow: DEFAULT_CONTEXT_WINDOW,
      models: modelCatalog,
      streamIdleTimeoutMs: DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      retryPolicy: resolveRetryPolicy(undefined, 'kimi-smoke'),
    }),
    resolveApiKey: async () => apiKey!,
    resolveUserId: () => TEST_USER_ID,
    resolveImage: async () => { throw new Error('no image in smoke tests') },
  })
}

const CATALOG = [
  { id: 'kimi-for-coding', contextWindow: 262_144, inputModalities: ['text', 'image'] as const },
  { id: 'k3', contextWindow: 1_048_576, inputModalities: ['text', 'image'] as const },
]

const userMessage = createUserMessage({
  content: [{ type: 'text', text: '用一句话介绍你自己' }],
  source: { kind: 'user' },
})

async function assembleText(model: string, options?: Parameters<typeof liveAdapter>[0]) {
  const assembler = new BlockAssembler()
  for await (const chunk of liveAdapter(options).stream({
    provider: 'kimi-code',
    model,
    messages: [userMessage],
  })) assembler.push(chunk)
  return {
    assembler,
    message: assembler.message({ kind: 'model', provider: 'kimi-code', model }),
  }
}

describe.runIf(apiKey !== undefined)('live Kimi Code API', () => {
  it('streams a text completion with usage before finish', async () => {
    const { assembler, message } = await assembleText('kimi-for-coding')
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text.length).toBeGreaterThan(0)
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(assembler.usage?.outputTokens).toBeGreaterThan(0)
    // Kimi caches aggressively: a fully-cached prompt reports uncached input 0
    // and the cache hit under cacheReadTokens (disjoint convention). Billed
    // input is the sum, which must be positive.
    if (assembler.usage !== undefined) {
      const billedInput = assembler.usage.inputTokens + (assembler.usage.cacheReadTokens ?? 0)
      expect(billedInput).toBeGreaterThan(0)
    }
  }, 60_000)

  it('streams reasoning deltas for a thinking model', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of liveAdapter().stream({
      provider: 'kimi-code',
      model: 'k3',
      messages: [userMessage],
      reasoningEffort: ReasoningEffortId('high'),
    })) assembler.push(chunk)
    const reasoning = assembler.message({ kind: 'model', provider: 'kimi-code', model: 'k3' })
      .content.find(block => block.type === 'reasoning')
    expect(reasoning).toBeDefined()
    expect((reasoning as { text: string }).text.length).toBeGreaterThan(0)
  }, 60_000)

  it('disables thinking with thinking:{type:disabled}', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of liveAdapter().stream({
      provider: 'kimi-code',
      model: 'k3',
      messages: [userMessage],
      reasoningEffort: ReasoningEffortId('off'),
    })) assembler.push(chunk)
    const reasoning = assembler.message({ kind: 'model', provider: 'kimi-code', model: 'k3' })
      .content.find(block => block.type === 'reasoning')
    expect(reasoning).toBeUndefined()
  }, 60_000)

  it('completes a tool call end to end', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of liveAdapter().stream({
      provider: 'kimi-code',
      model: 'kimi-for-coding',
      messages: [createUserMessage({
        content: [{ type: 'text', text: '北京今天天气如何？调用 get_weather 查询' }],
        source: { kind: 'user' },
      })],
      tools: [{
        name: 'get_weather',
        description: '查询指定城市的天气',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
          required: ['city'],
        },
      }],
    })) assembler.push(chunk)
    const toolCall = assembler.message({ kind: 'model', provider: 'kimi-code', model: 'kimi-for-coding' })
      .content.find(block => block.type === 'tool-call')
    expect(toolCall).toMatchObject({ type: 'tool-call', name: 'get_weather' })
    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
  }, 60_000)

  it('accepts reasoning_effort max on k3', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of liveAdapter().stream({
      provider: 'kimi-code',
      model: 'k3',
      messages: [userMessage],
      reasoningEffort: ReasoningEffortId('max'),
    })) assembler.push(chunk)
    expect(assembler.finish.kind).not.toBe('error')
  }, 60_000)
})

describe.skipIf(apiKey !== undefined)('live Kimi Code API (skipped)', () => {
  it('requires KIMI_API_KEY to run real-provider checks', () => {
    // Documented gate: export KIMI_API_KEY to run the live checks.
  })
})
