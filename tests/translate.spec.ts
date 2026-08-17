/**
 * Translate unit tests: Kimi SSE payloads → harness StreamChunks.
 */

import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { mapFinishReason, mapUsage, translate } from '../src/translate.ts'
import { DONE } from '../src/sse.ts'

async function* asyncPayloads(payloads: string[]): AsyncIterable<string> {
  yield* payloads
}

async function collect(payloads: string[]): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of translate(asyncPayloads(payloads))) chunks.push(chunk)
  return chunks
}

describe('mapFinishReason', () => {
  it('maps stop/tool_calls/length', () => {
    expect(mapFinishReason('stop')).toEqual({ kind: 'stop' })
    expect(mapFinishReason('tool_calls')).toEqual({ kind: 'tool-calls' })
    expect(mapFinishReason('length')).toEqual({ kind: 'max-tokens' })
  })

  it('turns unknown reasons into error finishes', () => {
    expect(mapFinishReason('content_filter')).toEqual({
      kind: 'error',
      failure: { message: 'model stopped: content_filter', code: 'CONTENT_FILTER' },
    })
  })
})

describe('mapUsage', () => {
  it('subtracts cached tokens from input, keeping disjoint counts', () => {
    expect(mapUsage({
      prompt_tokens: 10,
      completion_tokens: 4,
      prompt_tokens_details: { cached_tokens: 6 },
    })).toEqual({ inputTokens: 4, outputTokens: 4, cacheReadTokens: 6 })
  })

  it('reports reasoning tokens when present', () => {
    expect(mapUsage({
      prompt_tokens: 5,
      completion_tokens: 3,
      completion_tokens_details: { reasoning_tokens: 2 },
    })).toEqual({ inputTokens: 5, outputTokens: 3, reasoningTokens: 2 })
  })

  it('handles usage without any details fields', () => {
    expect(mapUsage({ prompt_tokens: 1, completion_tokens: 1 }))
      .toEqual({ inputTokens: 1, outputTokens: 1 })
  })
})

describe('translate', () => {
  it('emits reasoning then text deltas with block-end, usage before finish, nothing after', async () => {
    const chunks = await collect([
      '{"choices":[{"delta":{"role":"assistant","content":null,"reasoning_content":""}}]}',
      '{"choices":[{"delta":{"reasoning_content":"think"}}]}',
      '{"choices":[{"delta":{"content":"hi"}}]}',
      '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}',
      DONE,
    ])
    expect(chunks.map(chunk => chunk.type)).toEqual([
      'block-start', 'reasoning-delta', 'block-start', 'text-delta',
      'block-end', 'block-end', 'usage', 'finish',
    ])
    expect(chunks[0]).toMatchObject({ type: 'block-start', index: 0, blockType: 'reasoning' })
    expect(chunks[2]).toMatchObject({ type: 'block-start', index: 1, blockType: 'text' })
    expect(chunks[6]).toEqual({ type: 'usage', usage: { inputTokens: 3, outputTokens: 1 } })
    expect(chunks[7]).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('assembles tool calls with raw JSON arguments across deltas', async () => {
    const chunks = await collect([
      '{"choices":[{"delta":{"role":"assistant","content":null}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"read_file","arguments":""}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}',
      '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}',
      '{"choices":[{"delta":{"content":""},"finish_reason":"tool_calls"}]}',
      DONE,
    ])
    const toolBlockEnd = chunks.find(chunk => chunk.type === 'block-end')!
    expect(toolBlockEnd).toMatchObject({
      type: 'block-end',
      block: {
        type: 'tool-call',
        id: 'call_1',
        name: 'read_file',
        arguments: '{"path":"a.txt"}',
      },
    })
    const finish = chunks[chunks.length - 1]
    expect(finish).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('keeps the latest usage from a trailing usage-only chunk', async () => {
    const chunks = await collect([
      '{"choices":[{"delta":{"content":"hi"}}]}',
      '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
      '{"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":3}}}',
      DONE,
    ])
    const usage = chunks.find(chunk => chunk.type === 'usage')
    expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 2, cacheReadTokens: 3 } })
  })

  it('maps a degenerate empty completion to an EMPTY_RESPONSE error finish', async () => {
    const chunks = await collect([
      '{"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
      DONE,
    ])
    const finish = chunks[chunks.length - 1]
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE' } } })
  })

  it('throws MALFORMED_RESPONSE on a non-JSON payload', async () => {
    await expect(collect([
      'not-json',
      DONE,
    ])).rejects.toThrow(LlmError)
  })

  it('throws STREAM_CLOSED when the payload stream ends without [DONE]', async () => {
    await expect(collect([
      '{"choices":[{"delta":{"content":"hi"}}]}',
    ])).rejects.toThrow(LlmError)
  })
})
