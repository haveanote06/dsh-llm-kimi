/**
 * Real-composition guard for the dynamic-configuration chain: LlmRuntime,
 * settings-file, credentials-local, and dsh-llm-kimi boot from a test-only
 * cordis.yml through the actual Loader + Include path; external edits of
 * settings.yaml and the credentials document hot-publish through their
 * providers, and the very next request carries the fresh base URL and
 * credential. Also verifies the dual-route registration (kimi-cn/kimi-global).
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import { getOrCreateAnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import * as KimiPlugin from '../src/index.ts'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const NS = settingsNamespace('llm-kimi')
const KEY_REF = credentialRef('MOONSHOT_API_KEY')

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  await closeMockServers()
  vi.unstubAllEnvs()
})

async function loadComposition(options: {
  withDynamic: boolean
  baseURLCn: string
  baseURLGlobal?: string
  baseURLCode?: string
  reuseRoot?: string
}): Promise<{ ctx: Context; settingsPath: string; credentialsPath: string }> {
  const fresh = options.reuseRoot === undefined
  root = options.reuseRoot ?? await mkdtemp(join(tmpdir(), 'dsh-llm-kimi-composition-'))
  vi.stubEnv('DSH_HOME', root)
  const settingsPath = join(root, 'settings.yaml')
  const credentialsPath = join(root, '.credentials.yaml')
  if (options.withDynamic && fresh) {
    await writeFile(settingsPath, '# personal settings\n')
    // The code route reads KIMI_API_KEY; the open-platform routes read MOONSHOT_API_KEY.
    await writeFile(credentialsPath, [
      'KIMI_API_KEY: boot-key',
      'MOONSHOT_API_KEY: boot-key',
      '',
    ].join('\n'), { mode: 0o600 })
  }

  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: 'test-llm-service'",
    ...options.withDynamic
      ? [
        '- id: settings',
        "  name: '@deepseek-ai/dsh-settings-file'",
        '  config:',
        `    path: ${JSON.stringify(settingsPath)}`,
        '    debounceMs: 10',
        '- id: credentials',
        "  name: '@deepseek-ai/dsh-credentials-local'",
        '  config:',
        `    path: ${JSON.stringify(credentialsPath)}`,
        '    debounceMs: 10',
      ]
      : [],
    '- id: llm-kimi',
    "  name: 'dsh-llm-kimi'",
    '  config:',
    `    baseURLCn: ${JSON.stringify(options.baseURLCn)}`,
    ...options.baseURLGlobal !== undefined
      ? [`    baseURLGlobal: ${JSON.stringify(options.baseURLGlobal)}`]
      : [],
    ...options.baseURLCode !== undefined
      ? [`    baseURLCode: ${JSON.stringify(options.baseURLCode)}`]
      : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['test-llm-service', LlmRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
    ['dsh-llm-kimi', KimiPlugin],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await ctx.loader.await()
  return { ctx, settingsPath, credentialsPath }
}

describe('llm-kimi real dynamic composition', () => {
  it('registers all three provider routes and routes requests per route', async () => {
    vi.stubEnv('MOONSHOT_API_KEY', '')
    vi.stubEnv('KIMI_API_KEY', '')
    const serverCode = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverCn = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverGlobal = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({
      withDynamic: true,
      baseURLCode: serverCode.url,
      baseURLCn: serverCn.url,
      baseURLGlobal: serverGlobal.url,
    })

    expect(ctx.get('settings')!.describe().map(entry => entry.ns)).toEqual([NS])
    const providers = ctx.get('llm')!.listProviders().map(provider => provider.id)
    expect(providers).toContain('kimi-code')
    expect(providers).toContain('kimi-cn')
    expect(providers).toContain('kimi-global')

    // Code route hits the Kimi Code endpoint.
    await assemble(ctx, { provider: 'kimi-code', model: 'kimi-for-coding', messages: [] })
    expect(serverCode.requests).toHaveLength(1)
    expect(serverCn.requests).toHaveLength(0)
    expect(serverGlobal.requests).toHaveLength(0)
    expect(serverCode.headers[0]?.authorization).toBe('Bearer boot-key')
    expect(serverCode.headers[0]?.['x-moonshot-harness-user-id']).toBe(getOrCreateAnonymousUserId())

    // CN route hits the CN endpoint.
    await assemble(ctx, { provider: 'kimi-cn', model: 'kimi-k3', messages: [] })
    expect(serverCn.requests).toHaveLength(1)
    expect(serverCn.headers[0]?.authorization).toBe('Bearer boot-key')

    // Global route hits the global endpoint with the same shared key.
    await assemble(ctx, { provider: 'kimi-global', model: 'kimi-k3', messages: [] })
    expect(serverGlobal.requests).toHaveLength(1)
    expect(serverGlobal.headers[0]?.authorization).toBe('Bearer boot-key')
  })

  it('hot-publishes external settings and credential edits to the next request', async () => {
    vi.stubEnv('MOONSHOT_API_KEY', '')
    const serverA = await mockServer([{ kind: 'sse', events: textEvents }])
    const serverB = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx, settingsPath, credentialsPath } = await loadComposition({
      withDynamic: true,
      baseURLCn: serverA.url,
    })

    await assemble(ctx, { provider: 'kimi-cn', model: 'kimi-k3', messages: [] })
    expect(serverA.headers[0]?.authorization).toBe('Bearer boot-key')

    // External edits, exactly as a user or the web UI would leave them on disk.
    await writeFile(settingsPath, `llm-kimi:\n  baseURLCn: ${serverB.url}\n`)
    await vi.waitFor(() => {
      expect((ctx.get('settings')!.get(NS) as { baseURLCn?: string }).baseURLCn).toBe(serverB.url)
    }, { timeout: 5000 })
    await writeFile(credentialsPath, 'MOONSHOT_API_KEY: rotated-key\n', { mode: 0o600 })
    await vi.waitFor(async () => {
      expect(await ctx.get('credentials')!.resolve(KEY_REF)).toEqual({ value: 'rotated-key', source: 'file' })
    }, { timeout: 5000 })

    await assemble(ctx, { provider: 'kimi-cn', model: 'kimi-k3', messages: [] })
    expect(serverA.requests).toHaveLength(1)
    expect(serverB.requests).toHaveLength(1)
    expect(serverB.headers[0]?.authorization).toBe('Bearer rotated-key')
  })

  it('boots on entry config alone, resolving the credential from the environment', async () => {
    vi.stubEnv('MOONSHOT_API_KEY', 'entry-key')
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const { ctx } = await loadComposition({ withDynamic: false, baseURLCn: server.url })

    expect(ctx.get('settings')).toBeUndefined()
    expect(ctx.get('credentials')).toBeUndefined()
    await assemble(ctx, { provider: 'kimi-cn', model: 'kimi-k3', messages: [] })
    expect(server.headers[0]?.authorization).toBe('Bearer entry-key')
  })
})
