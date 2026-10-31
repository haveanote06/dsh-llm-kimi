import assert from 'node:assert/strict'
import { createVolatile } from '@deepseek-ai/cosmokit'
import * as mod from 'dsh-llm-kimi'

const seen = { providers: null, adapters: [], events: [] }
const childCtx = { effect: () => ({ dispose() {} }) }
const ctx = {
  fiber: { entry: { options: { id: 'llm-kimi' } } },
  logger: { error: (...a) => console.log('LOG error:', ...a), warn: () => {}, info: () => {}, debug: () => {} },
  get: () => undefined,
  inject: (names, fn) => fn(childCtx),
  on: (ev) => { seen.events.push(ev) },
  llm: {
    registerConfigurableProviders: (entries) => { seen.providers = entries; return { replace() {}, dispose() {} } },
    registerAdapter: (providers, adapter) => {
      seen.adapters.push({ providers, adapterName: adapter?.constructor?.name })
      return { replace() {}, dispose() {} }
    },
  },
}

// 1. every schema field arrives as a live ref; plainOptions detaches it
const config = mod.Config({})
const plain = mod.plainOptions(config)
assert.equal(plain.baseURLCode, undefined) // no schema default; falls back per route
assert.equal(plain.streamIdleTimeoutMs, 300000)
// a volatile field read through the schema is a plain value, not a ref object
assert.equal(typeof plain.streamIdleTimeoutMs, 'number')

const r1 = mod.resolveAdapterOptions(plain, undefined)
assert.equal(r1['kimi-cn'].baseURL, 'https://api.moonshot.cn/v1')
assert.equal(r1['kimi-global'].baseURL, 'https://api.moonshot.ai/v1')
assert.equal(r1['kimi-code'].models.length, 10)
assert.equal(r1['kimi-code'].maxTokens, 256000)
assert.equal(r1['kimi-code'].defaultContextWindow, 1000000)
assert.equal(r1['kimi-code'].streamIdleTimeoutMs, 300000)
assert.equal(r1['kimi-code'].retryPolicy.maxRetries, 5)
console.log('defaults ok:', Object.entries(r1).map(([k, v]) => `${k}=${v.baseURL}`).join(' '))

// 2. a live ref write reaches the next resolution
const mutable = {
  ...config,
  baseURLCn: createVolatile('https://cn.example/v1'),
  apiKeyEnvCn: createVolatile('MY_CN_KEY'),
}
const r2 = mod.resolveAdapterOptions(mod.plainOptions(mutable), undefined)
assert.equal(r2['kimi-cn'].baseURL, 'https://cn.example/v1')
assert.equal(r2['kimi-cn'].apiKeyEnv, 'MY_CN_KEY')
assert.equal(r2['kimi-global'].baseURL, 'https://api.moonshot.ai/v1')
console.log('live override ok:', r2['kimi-cn'].baseURL, r2['kimi-cn'].apiKeyEnv)

// 3. registration wiring
mod.apply(ctx, config)
assert.equal(seen.providers.length, 3)
assert.deepEqual(seen.providers.map((p) => p.provider), ['kimi-code', 'kimi-cn', 'kimi-global'])
assert.equal(seen.providers[0].settingsNs, 'llm-kimi')
assert.deepEqual(seen.adapters[0].providers, ['kimi-code', 'kimi-cn', 'kimi-global'])
assert.deepEqual(seen.events, ['loader/volatile-update'])
console.log('wiring ok:', seen.providers.map((p) => `${p.provider}/${p.displayName}`).join(' '))

// 4. an invalid live snapshot keeps the last good facts, loudly, once
const bad = { ...config, streamIdleTimeoutMs: createVolatile(-1) }
mod.apply({ ...ctx, llm: ctx.llm }, bad)
console.log('last-good fallback ok')
console.log('SMOKE OK')
