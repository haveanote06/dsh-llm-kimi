// Browser half of the dsh-llm-kimi plugin: a "Kimi" settings section.
//
// The built-in Models page only hosts editable provider editors for the
// llm-deepseek / llm-pi-ai namespaces (hardcoded layoutOf), so third-party
// LLM plugins cannot enter their API key there. This section is the plugin's
// own settings page: pick a route (kimi-code / kimi-cn / kimi-global), paste
// the key, save through the credentials service (api.credentials.set) — the
// exact store the host adapter resolves on the next request.
//
// Hand-written in the lazy-CJS bundle protocol (window.__ModuleLoader__.load
// with a factory returning cordis-plugin exports), so no build step — the
// same zero-dependency stance as modlens's client half.

window.__ModuleLoader__.load({
  id: 'dsh-llm-kimi',
  factory: function (require) {
    var module = { exports: {} }
    var exports = module.exports

    var NS = 'llm-kimi-client'

    // The three routes the host adapter registers, with the credential
    // reference each one resolves by default (host defaults, in sync with
    // src/index.ts: kimi-code → KIMI_API_KEY, cn/global → MOONSHOT_API_KEY).
    var ROUTES = [
      {
        provider: 'kimi-code',
        displayName: 'Kimi Code',
        ref: 'KIMI_API_KEY',
        endpoint: 'https://api.kimi.com/coding/v1',
        keyType: 'sk-kimi-*（Kimi Code 订阅）',
        keyTypeEn: 'sk-kimi-* (Kimi Code subscription)',
      },
      {
        provider: 'kimi-cn',
        displayName: 'Kimi (Moonshot CN)',
        ref: 'MOONSHOT_API_KEY',
        endpoint: 'https://api.moonshot.cn/v1',
        keyType: 'sk-*（开放平台·国内）',
        keyTypeEn: 'sk-* (Open Platform, CN)',
      },
      {
        provider: 'kimi-global',
        displayName: 'Kimi (Moonshot Global)',
        ref: 'MOONSHOT_API_KEY',
        endpoint: 'https://api.moonshot.ai/v1',
        keyType: 'sk-*（开放平台·海外）',
        keyTypeEn: 'sk-* (Open Platform, Global)',
      },
    ]

    var zh = {
      nav: 'Kimi',
      title: 'Kimi（Moonshot）配置',
      intro: '选择路由并填写 API Key。Key 通过凭证服务保存（与 Models 页共用），下一次请求即生效，无需重启。',
      route: '路由',
      endpoint: '端点',
      keyRef: '凭证引用',
      keyInput: 'API Key',
      keyPlaceholder: '粘贴 API Key',
      configured: '已配置',
      missing: '未配置',
      save: '保存',
      saving: '保存中…',
      saved: '已保存，下一次请求生效',
      empty: 'Key 不能为空',
      loadError: '无法读取凭证状态',
      saveError: '保存失败',
      close: '关闭',
    }

    var en = {
      nav: 'Kimi',
      title: 'Kimi (Moonshot) Settings',
      intro: 'Pick a route and paste the API key. Keys are stored through the credentials service (shared with the Models page) and take effect on the next request — no restart needed.',
      route: 'Route',
      endpoint: 'Endpoint',
      keyRef: 'Credential ref',
      keyInput: 'API Key',
      keyPlaceholder: 'Paste API key',
      configured: 'configured',
      missing: 'missing',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved — effective on the next request',
      empty: 'Key must not be empty',
      loadError: 'Could not read credential state',
      saveError: 'Save failed',
      close: 'Close',
    }

    var STYLE = {
      section: { maxWidth: '640px', color: 'var(--dsw-alias-label-primary, #1f2329)', display: 'flex', flexDirection: 'column', gap: '14px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 500, lineHeight: '24px' },
      intro: { margin: 0, fontSize: '13px', lineHeight: '20px', opacity: 0.75 },
      card: { border: '1px solid var(--dsw-alias-border-l2, #d0d3da)', borderRadius: '12px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px' },
      label: { fontSize: '12px', fontWeight: 500, lineHeight: '18px', opacity: 0.85 },
      select: { height: '32px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #d0d3da)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', padding: '0 10px', fontSize: '14px' },
      input: { height: '32px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, #d0d3da)', background: 'var(--dsw-alias-bg-layer-1, #fff)', color: 'inherit', padding: '0 10px', fontSize: '14px', width: '100%', boxSizing: 'border-box' },
      meta: { margin: 0, fontSize: '12px', lineHeight: '18px', opacity: 0.7 },
      dot: { display: 'inlineBlock', width: '8px', height: '8px', borderRadius: '50%', marginRight: '6px' },
      dotOk: { background: 'var(--dsw-alias-state-success-primary, #00a870)' },
      dotBad: { background: 'var(--dsw-alias-state-error-primary, #e34d59)' },
      button: { height: '32px', borderRadius: '16px', border: 'none', background: 'var(--dsw-alias-button-primary-fill, #2563eb)', color: '#fff', padding: '0 16px', fontSize: '14px', cursor: 'pointer' },
      buttonDisabled: { opacity: 0.4, cursor: 'default' },
      error: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-error-primary, #e34d59)' },
      ok: { margin: 0, fontSize: '12px', lineHeight: '18px', color: 'var(--dsw-alias-state-success-primary, #00a870)' },
    }

    function makeComponent(react) {
      var useState = react.useState
      var useEffect = react.useEffect

      return function KimiSection(props) {
        var api = props.api
        var t = props.t
        var [route, setRoute] = useState(ROUTES[0])
        var [keyDraft, setKeyDraft] = useState('')
        var [state, setState] = useState(null) // {ref, configured, writable} | null
        var [busy, setBusy] = useState(false)
        var [message, setMessage] = useState(null) // {kind: 'error'|'ok', text}
        var ref = route.ref

        useEffect(function () {
          var stale = false
          setState(null)
          setMessage(null)
          api.credentials.describe({ refs: [ref] }).then(function (response) {
            if (stale || !response.result.ok) return
            var credential = response.result.value.credentials[ref]
            setState(credential || { configured: false, writable: true })
          }).catch(function () {
            if (!stale) setMessage({ kind: 'error', text: t('loadError') })
          })
          return function () { stale = true }
        }, [api.credentials, ref])

        var onSave = function () {
          var value = (keyDraft || '').trim()
          if (value.length === 0) {
            setMessage({ kind: 'error', text: t('empty') })
            return
          }
          setBusy(true)
          setMessage(null)
          api.credentials.set({ ref: ref, value: value }).then(function (response) {
            if (!response.result.ok) {
              setMessage({ kind: 'error', text: t('saveError') + ': ' + (response.result.error.message || '') })
              return
            }
            setKeyDraft('')
            setState({ configured: true, writable: true })
            setMessage({ kind: 'ok', text: t('saved') })
          }).catch(function (error) {
            setMessage({ kind: 'error', text: t('saveError') + ': ' + (error && error.message ? error.message : String(error)) })
          }).finally(function () {
            setBusy(false)
          })
        }

        var configured = state !== null && state.configured === true
        return react.createElement(
          'div', { style: STYLE.section },
          react.createElement('h3', { style: STYLE.title }, t('title')),
          react.createElement('p', { style: STYLE.intro }, t('intro')),
          react.createElement(
            'div', { style: STYLE.card },
            react.createElement(
              'div', { style: STYLE.row },
              react.createElement('label', { style: STYLE.label }, t('route')),
              react.createElement(
                'select', {
                  style: STYLE.select,
                  value: route.provider,
                  onChange: function (event) {
                    var next = ROUTES.filter(function (r) { return r.provider === event.target.value })[0]
                    if (next) setRoute(next)
                  },
                },
                ROUTES.map(function (r) {
                  return react.createElement('option', { key: r.provider, value: r.provider }, r.displayName)
                }),
              ),
            ),
            react.createElement(
              'div', { style: STYLE.row },
              react.createElement(
                'span', { style: { display: 'inlineFlex', alignItems: 'center', fontSize: '12px', lineHeight: '18px' } },
                react.createElement('span', { style: Object.assign({}, STYLE.dot, configured ? STYLE.dotOk : STYLE.dotBad) }),
                configured ? t('configured') : t('missing'),
              ),
              react.createElement('p', { style: STYLE.meta }, t('endpoint') + ': ' + route.endpoint),
              react.createElement('p', {
                style: STYLE.meta,
              }, t('keyRef') + ': ' + ref + '  ·  ' + (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? route.keyType : route.keyTypeEn)),
            ),
            react.createElement(
              'div', { style: STYLE.row },
              react.createElement('label', { style: STYLE.label }, t('keyInput')),
              react.createElement('input', {
                style: STYLE.input,
                type: 'password',
                autoComplete: 'off',
                placeholder: t('keyPlaceholder'),
                value: keyDraft,
                disabled: busy || (state !== null && state.writable !== true),
                onChange: function (event) { setKeyDraft(event.target.value) },
              }),
            ),
            message !== null
              ? react.createElement('p', { style: message.kind === 'ok' ? STYLE.ok : STYLE.error }, message.text)
              : null,
            react.createElement(
              'div', { style: { display: 'flex', gap: '8px' } },
              react.createElement(
                'button', {
                  style: Object.assign({}, STYLE.button, busy ? STYLE.buttonDisabled : {}),
                  disabled: busy,
                  onClick: onSave,
                },
                busy ? t('saving') : t('save'),
              ),
            ),
          ),
        )
      }
    }

    function apply(ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'llm-kimi-client: copy dictionaries')

      var t = ctx.locale.bind(NS)

      ctx.inject(['slots'], function (scope) {
        var connection = ctx.get('connection')
        var injected = function () {
          return { api: connection.api, t: t }
        }
        scope.slots.inject('settings.section', function* () {
          yield scope.slots.register(
            {
              name: 'settings.section',
              id: 'llm-kimi',
              order: 20,
              label: function () { return t('nav') },
              inject: injected,
            },
            makeComponent(require('react')),
          )
        })
      })
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'connection']
    return module.exports
  },
})
