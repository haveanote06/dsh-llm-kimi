/**
 * Plugin config resolution tests: defaults, validation bounds, dual-route
 * base URLs and per-route credential references.
 */

import { describe, expect, it } from 'vitest'
import {
  Config,
  resolveAdapterOptions,
  PUBLIC_BASE_URL_CODE,
  PUBLIC_BASE_URL_CN,
  PUBLIC_BASE_URL_GLOBAL,
  plainOptions,
} from '../src/index.ts'

describe('resolveAdapterOptions', () => {
  it('defaults to the platform endpoints and conventional key envs for all three routes', () => {
    const resolved = resolveAdapterOptions({})
    expect(resolved['kimi-code'].baseURL).toBe(PUBLIC_BASE_URL_CODE)
    expect(resolved['kimi-cn'].baseURL).toBe(PUBLIC_BASE_URL_CN)
    expect(resolved['kimi-global'].baseURL).toBe(PUBLIC_BASE_URL_GLOBAL)
    // Kimi Code keys conventionally live in KIMI_API_KEY; open-platform keys in MOONSHOT_API_KEY.
    expect(String(resolved['kimi-code'].apiKeyEnv)).toBe('KIMI_API_KEY')
    expect(String(resolved['kimi-cn'].apiKeyEnv)).toBe('MOONSHOT_API_KEY')
    expect(String(resolved['kimi-global'].apiKeyEnv)).toBe('MOONSHOT_API_KEY')
    expect(resolved['kimi-cn'].defaultContextWindow).toBe(1_000_000)
  })

  it('honors per-route base URLs and credential overrides', () => {
    const resolved = resolveAdapterOptions({
      apiKeyEnv: 'MOONSHOT_API_KEY',
      apiKeyEnvCode: 'KIMI_API_KEY_MINE',
      apiKeyEnvCn: 'MOONSHOT_API_KEY_CN',
      apiKeyEnvGlobal: 'MOONSHOT_API_KEY_GLOBAL',
      baseURLCode: 'https://gateway.code.example/v1',
      baseURLCn: 'https://gateway.example.cn/v1',
      baseURLGlobal: 'https://gateway.example.ai/v1',
    })
    expect(resolved['kimi-code'].baseURL).toBe('https://gateway.code.example/v1')
    expect(String(resolved['kimi-code'].apiKeyEnv)).toBe('KIMI_API_KEY_MINE')
    expect(resolved['kimi-cn'].baseURL).toBe('https://gateway.example.cn/v1')
    expect(String(resolved['kimi-cn'].apiKeyEnv)).toBe('MOONSHOT_API_KEY_CN')
    expect(resolved['kimi-global'].baseURL).toBe('https://gateway.example.ai/v1')
    expect(String(resolved['kimi-global'].apiKeyEnv)).toBe('MOONSHOT_API_KEY_GLOBAL')
  })

  it('prefers trusted environment base URLs over the public defaults', () => {
    const resolved = resolveAdapterOptions({}, {
      get: (name: string) => name === 'KIMI_BASE_URL'
        ? { value: 'http://env-code/v1', source: 'env' as const }
        : name === 'MOONSHOT_BASE_URL_CN'
          ? { value: 'http://env-cn/v1', source: 'env' as const }
          : name === 'MOONSHOT_BASE_URL_GLOBAL'
            ? { value: 'http://env-global/v1', source: 'env' as const }
            : undefined,
    } as never)
    expect(resolved['kimi-code'].baseURL).toBe('http://env-code/v1')
    expect(resolved['kimi-cn'].baseURL).toBe('http://env-cn/v1')
    expect(resolved['kimi-global'].baseURL).toBe('http://env-global/v1')
  })

  it('rejects a reasoning effort when thinking is disabled', () => {
    expect(() => resolveAdapterOptions({ thinking: 'disabled', reasoningEffort: 'high' }))
      .toThrow('only reasoningEffort "off" can be configured when thinking is disabled')
  })

  it('rejects invalid context window and max tokens', () => {
    expect(() => resolveAdapterOptions({ defaultContextWindow: 0 }))
      .toThrow('defaultContextWindow must be a positive integer')
    expect(() => resolveAdapterOptions({ maxTokens: -1 }))
      .toThrow('maxTokens must be a positive safe integer')
  })

  it('rejects duplicate and empty catalog model ids', () => {
    expect(() => resolveAdapterOptions({ models: [{ id: 'a' }, { id: 'a' }] }))
      .toThrow('duplicate catalog model')
    expect(() => resolveAdapterOptions({ models: [{ id: '' }] }))
      .toThrow('catalog model ids must be non-empty')
  })

  it('rejects invalid modalities', () => {
    expect(() => resolveAdapterOptions({
      models: [{ id: 'x', inputModalities: ['text', 'video'] as never }],
    })).toThrow('invalid inputModalities')
  })

  it('validates the Config schema through schemastery defaults', () => {
    // 0.2.x exposes every volatile field as a live reference; the plain values
    // only exist behind one detached read.
    const config = plainOptions(Config(undefined as never))
    expect(config.apiKeyEnv).toBe('MOONSHOT_API_KEY')
    expect(config.maxTokens).toBe(256_000)
    expect(config.defaultContextWindow).toBe(1_000_000)
    expect(config.models?.length).toBeGreaterThan(0)
  })
})
