/**
 * dsh-llm-kimi browser half: one Settings page (`settings.section`, id `kimi`)
 * that edits the three routes' base URLs in the `llm-kimi` settings namespace
 * and stores each route's API key as a credential (never in the settings
 * document).
 *
 * Written in the DeepSeek Harness client-bundle format: the web shell executes
 * the file, which registers a factory with `window.__ModuleLoader__.load`; the
 * factory body runs lazily on first materialization. Only `react` (a platform
 * seed word) is required, so no `dsh.client.external` entry is needed.
 */
window.__ModuleLoader__.load({
  id: "dsh-llm-kimi",
  factory: (require) => {
    "use strict";

    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;

    /** Locale dictionary namespace owned by this bundle. */
    const NS = "settings.llmKimi";
    /** Host settings namespace registered by the plugin's Host half. */
    const SETTINGS_NAMESPACE = "llm-kimi";
    /** Settings navigation key. */
    const SECTION_ID = "kimi";

    /**
     * Per-route wiring. `refFields` is the same precedence the Host half uses
     * (`apiKeyEnvCode ?? apiKeyEnv` for `kimi-code`, `apiKeyEnvX ?? apiKeyEnv`
     * otherwise), so the page addresses exactly the credential the adapter
     * reads.
     */
    const ROUTES = [
      {
        id: "kimi-code",
        labelKey: "routeCode",
        field: "baseURLCode",
        refFields: ["apiKeyEnvCode", "apiKeyEnv"],
        fallbackRef: "KIMI_API_KEY",
        defaultBaseURL: "https://api.kimi.com/coding/v1"
      },
      {
        id: "kimi-cn",
        labelKey: "routeCn",
        field: "baseURLCn",
        refFields: ["apiKeyEnvCn", "apiKeyEnv"],
        fallbackRef: "MOONSHOT_API_KEY",
        defaultBaseURL: "https://api.moonshot.cn/v1"
      },
      {
        id: "kimi-global",
        labelKey: "routeGlobal",
        field: "baseURLGlobal",
        refFields: ["apiKeyEnvGlobal", "apiKeyEnv"],
        fallbackRef: "MOONSHOT_API_KEY",
        defaultBaseURL: "https://api.moonshot.ai/v1"
      }
    ];

    const zh = {
      nav: "Kimi",
      title: "Kimi（Moonshot）模型服务",
      hint: "为每个路由填写 Base URL 与 API Key。API Key 写入 dsh 凭据库，不写入设置文档；留空 Base URL 使用默认地址。",
      routeCode: "Kimi Code（编程订阅）",
      routeCn: "Kimi（Moonshot 中国站）",
      routeGlobal: "Kimi（Moonshot 国际站）",
      baseURL: "Base URL",
      baseURLPlaceholder: "留空使用默认：{url}",
      apiKey: "API Key",
      apiKeyConfigured: "密钥已配置",
      apiKeyMissing: "密钥未配置",
      apiKeyPlaceholder: "粘贴密钥后按回车或点保存",
      save: "保存",
      saving: "保存中…",
      saveFailed: "保存失败，请重试。",
      clearKey: "清除密钥",
      clearFailed: "清除失败，请重试。",
      emptyKey: "请先填写 API Key。",
      credentialRef: "凭据引用",
      modelsCount: "{count} 个模型",
      modelsUnknown: "模型数未知",
      loading: "正在读取设置…",
      readOnly: "当前部署的设置为只读。",
      unavailable: "插件未加载，暂时无法配置。",
      close: "关闭",
      keyHint: "密钥只写入本机凭据库；环境变量与 .dsh/.env 中的同名变量仍会作为回退层生效。"
    };

    const en = {
      nav: "Kimi",
      title: "Kimi (Moonshot) providers",
      hint: "Set a base URL and API key per route. The API key is stored in the dsh credential store, never in the settings document; an empty base URL uses the default endpoint.",
      routeCode: "Kimi Code (coding plan)",
      routeCn: "Kimi (Moonshot China)",
      routeGlobal: "Kimi (Moonshot global)",
      baseURL: "Base URL",
      baseURLPlaceholder: "Leave blank for the default: {url}",
      apiKey: "API key",
      apiKeyConfigured: "Key configured",
      apiKeyMissing: "Key not configured",
      apiKeyPlaceholder: "Paste a key, then press Enter or Save",
      save: "Save",
      saving: "Saving…",
      saveFailed: "The deployment did not accept this value; please retry.",
      clearKey: "Clear key",
      clearFailed: "The deployment did not clear this key; please retry.",
      emptyKey: "Enter an API key first.",
      credentialRef: "Credential reference",
      modelsCount: "{count} models",
      modelsUnknown: "model count unknown",
      loading: "Reading settings…",
      readOnly: "This deployment stores settings read-only.",
      unavailable: "This plugin is not loaded, so it cannot be configured right now.",
      close: "Close",
      keyHint: "The key is written to this machine's credential store only; a matching environment variable or .dsh/.env entry still applies as a fallback layer."
    };

    const CSS = [
      ".llmKimi_section{display:flex;flex-direction:column;gap:16px;padding:4px 0}",
      ".llmKimi_header{display:flex;flex-direction:column;gap:4px}",
      ".llmKimi_title{margin:0;font-size:16px;font-weight:600}",
      ".llmKimi_hint{margin:0;font-size:12px;line-height:1.5;opacity:.7}",
      ".llmKimi_row{border:1px solid var(--dsw-border,rgba(127,127,127,.28));border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:10px}",
      ".llmKimi_rowHead{display:flex;align-items:center;gap:8px;justify-content:space-between}",
      ".llmKimi_rowName{font-weight:600;font-size:14px}",
      ".llmKimi_badge{font-size:12px;padding:1px 8px;border-radius:999px;border:1px solid currentColor;opacity:.9}",
      ".llmKimi_badgeOk{color:#2e9e5b}",
      ".llmKimi_badgeBad{color:#c94f4f}",
      ".llmKimi_field{display:flex;flex-direction:column;gap:4px;font-size:13px}",
      ".llmKimi_fieldLabel{display:flex;align-items:center;gap:8px;justify-content:space-between}",
      ".llmKimi_labelText{opacity:.85}",
      ".llmKimi_row input{padding:6px 9px;border:1px solid var(--dsw-border,rgba(127,127,127,.35));border-radius:6px;background:transparent;color:inherit;font:inherit;width:100%;box-sizing:border-box}",
      ".llmKimi_row input:focus{outline:2px solid var(--dsw-accent,#4a7dff);outline-offset:1px}",
      ".llmKimi_actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".llmKimi_actions button{padding:4px 12px;border-radius:6px;border:1px solid var(--dsw-border,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}",
      ".llmKimi_actions button:disabled{opacity:.5;cursor:default}",
      ".llmKimi_meta{font-size:12px;opacity:.6;display:flex;gap:10px;flex-wrap:wrap}",
      ".llmKimi_error{font-size:12px;color:#c94f4f}"
    ].join("");

    const C = {
      section: "llmKimi_section",
      header: "llmKimi_header",
      title: "llmKimi_title",
      hint: "llmKimi_hint",
      row: "llmKimi_row",
      rowHead: "llmKimi_rowHead",
      rowName: "llmKimi_rowName",
      badge: "llmKimi_badge",
      badgeOk: "llmKimi_badge llmKimi_badgeOk",
      badgeBad: "llmKimi_badge llmKimi_badgeBad",
      field: "llmKimi_field",
      fieldLabel: "llmKimi_fieldLabel",
      labelText: "llmKimi_labelText",
      actions: "llmKimi_actions",
      meta: "llmKimi_meta",
      error: "llmKimi_error"
    };

    /** Inject this bundle's stylesheet once per document. */
    function injectStyles() {
      if (typeof document === "undefined") return;
      const tagId = "dsh-llm-kimi/KimiSection.css";
      const selector = "style[data-plugin-css=" + JSON.stringify(tagId) + "]";
      if (document.querySelector(selector) !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-llm-kimi";
      tag.dataset.pluginCss = tagId;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    /** Fill `{name}` placeholders in one dictionary string. */
    function format(text, vars) {
      if (typeof text !== "string" || vars === undefined) return text;
      return text.replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
      );
    }

    /** The settings section object, or an empty object before the first read. */
    function sectionOf(value) {
      return value !== null && typeof value === "object" ? value : {};
    }

    /**
     * Reads the `llm-kimi` settings section, derives the credential reference
     * of every route exactly as the Host adapter does, and keeps the credential
     * status of those references in sync with the server.
     */
    class KimiController {
      constructor(ctx) {
        this.ctx = ctx;
        this.form = ctx.configForms.get(SETTINGS_NAMESPACE);
        this.credentials = {};
        this.listeners = new Set();
        this.disposers = [];
        this.subscribe = this.subscribe.bind(this);
        this.getSnapshot = this.getSnapshot.bind(this);
        this.snapshot = this.computeSnapshot();
      }

      computeSnapshot() {
        const form = this.form.getSnapshot();
        return {
          status: form.status,
          value: form.value,
          revision: form.revision,
          writable: form.writable,
          credentials: this.credentials
        };
      }

      emit() {
        this.snapshot = this.computeSnapshot();
        for (const listener of this.listeners) listener();
      }

      subscribe(listener) {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      }

      getSnapshot() {
        return this.snapshot;
      }

      /** Credential reference a route currently reads. */
      refOf(route) {
        const section = sectionOf(this.form.getSnapshot().value);
        for (const field of route.refFields) {
          const declared = section[field];
          if (typeof declared === "string" && declared.length > 0) return declared;
        }
        return route.fallbackRef;
      }

      /** Credential view of one route. */
      credentialOf(route) {
        const ref = this.refOf(route);
        const view = this.credentials[ref];
        return {
          ref,
          configured: view !== undefined && view.configured === true,
          writable: view === undefined ? true : view.writable !== false
        };
      }

      /** Credential references of every route, de-duplicated. */
      allRefs() {
        const refs = [];
        for (const route of ROUTES) {
          const ref = this.refOf(route);
          if (!refs.includes(ref)) refs.push(ref);
        }
        return refs;
      }

      async describe(refs) {
        if (refs.length === 0) return;
        let response;
        try {
          response = await this.ctx.remote.credentials.describe(refs);
        } catch {
          return;
        }
        if (response === null || typeof response !== "object" || response.ok !== true) return;
        const next = Object.assign({}, this.credentials);
        for (const ref of refs) {
          const view = response.value === undefined ? undefined : response.value[ref];
          next[ref] = view === undefined ? { configured: false, writable: true } : view;
        }
        this.credentials = next;
        this.emit();
      }

      refreshAll() {
        return this.describe(this.allRefs());
      }

      async writeKey(route, value) {
        const ref = this.refOf(route);
        const response = await this.ctx.remote.credentials.set(ref, value);
        if (response === null || typeof response !== "object" || response.ok !== true) {
          return { ok: false };
        }
        await this.describe([ref]);
        return { ok: true };
      }

      async clearKey(route) {
        const ref = this.refOf(route);
        const response = await this.ctx.remote.credentials.unset(ref);
        if (response === null || typeof response !== "object" || response.ok !== true) {
          return { ok: false };
        }
        await this.describe([ref]);
        return { ok: true };
      }

      setBaseURL(route, value) {
        return this.form.set(route.field, value);
      }

      start() {
        this.disposers.push(this.form.subscribe(() => this.emit()));
        this.disposers.push(
          this.ctx.remote.$on("credentials/reference-updated", (ref) => {
            if (this.allRefs().includes(ref)) void this.describe([ref]);
          })
        );
        this.disposers.push(
          this.ctx.remote.$on("credentials/record-updated", () => {
            void this.refreshAll();
          })
        );
        void this.refreshAll();
        return () => {
          for (const dispose of this.disposers.splice(0)) {
            try {
              dispose();
            } catch {
              /* the transport already tore the listener down */
            }
          }
        };
      }
    }

    /** Model count from the section's `models` catalog. */
    function modelCountOf(section) {
      const models = section.models;
      return Array.isArray(models) ? models.length : undefined;
    }

    /** One route card: base URL, API key, credential status, model count. */
    function KimiRouteRow(props) {
      const { route, t, controller, section, writable } = props;
      const storedBase = typeof section[route.field] === "string" ? section[route.field] : "";
      const credential = controller.credentialOf(route);
      const count = modelCountOf(section);

      const [base, setBase] = React.useState(storedBase);
      const [key, setKey] = React.useState("");
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState("");

      React.useEffect(() => {
        setBase(storedBase);
      }, [storedBase]);

      const saveBaseURL = async () => {
        if (busy) return;
        const next = base.trim();
        if (next === storedBase) return;
        setBusy(true);
        setError("");
        const ok = await controller.setBaseURL(route, next);
        setBusy(false);
        if (!ok) setError(t("saveFailed"));
      };

      const saveKey = async () => {
        if (busy) return;
        if (key.length === 0) {
          setError(t("emptyKey"));
          return;
        }
        setBusy(true);
        setError("");
        const result = await controller.writeKey(route, key);
        setBusy(false);
        if (!result.ok) {
          setError(t("saveFailed"));
          return;
        }
        setKey("");
      };

      const clearKey = async () => {
        if (busy) return;
        setBusy(true);
        setError("");
        const result = await controller.clearKey(route);
        setBusy(false);
        if (!result.ok) setError(t("clearFailed"));
      };

      return h(
        "div",
        { className: C.row, "data-route": route.id },
        h(
          "div",
          { className: C.rowHead },
          h("span", { className: C.rowName }, t(route.labelKey)),
          h(
            "span",
            { className: credential.configured ? C.badgeOk : C.badgeBad },
            credential.configured ? t("apiKeyConfigured") : t("apiKeyMissing")
          )
        ),
        h(
          "label",
          { className: C.field },
          h("span", { className: C.labelText }, t("baseURL")),
          h("input", {
            type: "text",
            value: base,
            spellCheck: false,
            autoComplete: "off",
            disabled: busy || !writable,
            placeholder: format(t("baseURLPlaceholder"), { url: route.defaultBaseURL }),
            "data-field": route.field,
            onChange: (event) => setBase(event.target.value),
            onBlur: () => void saveBaseURL(),
            onKeyDown: (event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }
          })
        ),
        h(
          "label",
          { className: C.field },
          h(
            "span",
            { className: C.labelText },
            t("apiKey"),
            h("span", { className: C.meta }, t("credentialRef") + ": " + credential.ref)
          ),
          h("input", {
            type: "password",
            value: key,
            autoComplete: "new-password",
            spellCheck: false,
            disabled: busy || !credential.writable,
            placeholder: credential.configured ? "••••••••" : t("apiKeyPlaceholder"),
            "data-credential-ref": credential.ref,
            onChange: (event) => setKey(event.target.value),
            onKeyDown: (event) => {
              if (event.key === "Enter") void saveKey();
            }
          })
        ),
        h(
          "div",
          { className: C.actions },
          h(
            "button",
            {
              type: "button",
              disabled: busy || key.length === 0 || !credential.writable,
              onClick: () => void saveKey()
            },
            busy ? t("saving") : t("save")
          ),
          credential.configured
            ? h(
                "button",
                {
                  type: "button",
                  disabled: busy || !credential.writable,
                  onClick: () => void clearKey()
                },
                t("clearKey")
              )
            : null,
          h(
            "span",
            { className: C.meta },
            count === undefined ? t("modelsUnknown") : format(t("modelsCount"), { count })
          )
        ),
        error.length > 0 ? h("div", { className: C.error, role: "alert" }, error) : null
      );
    }

    /** The Settings page body. */
    function KimiSection(props) {
      const { controller, t, close } = props;
      const snapshot = React.useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot
      );
      const section = sectionOf(snapshot.value);
      const writable = snapshot.writable !== false;

      let body;
      if (snapshot.status === "loading") {
        body = h("p", { className: C.hint }, t("loading"));
      } else if (snapshot.status === "unavailable") {
        body = h("p", { className: C.hint }, t("unavailable"));
      } else {
        body = ROUTES.map((route) =>
          h(KimiRouteRow, {
            key: route.id,
            route,
            t,
            controller,
            section,
            writable
          })
        );
      }

      return h(
        "section",
        {
          className: C.section,
          "data-settings-section": SECTION_ID,
          "data-status": snapshot.status
        },
        h(
          "div",
          { className: C.header },
          h("h2", { className: C.title }, t("title")),
          h("p", { className: C.hint }, t("hint")),
          writable ? null : h("p", { className: C.hint }, t("readOnly")),
          h("p", { className: C.hint }, t("keyHint"))
        ),
        body,
        h(
          "div",
          { className: C.actions },
          h("button", { type: "button", onClick: () => (typeof close === "function" ? close() : undefined) }, t("close"))
        )
      );
    }

    /** Required client services (cordis fiber inject). */
    const inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];

    /**
     * Mount the Kimi settings page while the Host serves the `llm-kimi`
     * namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "llm-kimi: dictionaries");
      injectStyles();

      const controller = new KimiController(ctx);
      ctx.effect(() => controller.start(), "llm-kimi: settings and credential subscriptions");

      ctx.effect(
        () =>
          ctx.configForms.whileServed([SETTINGS_NAMESPACE], () =>
            ctx.slots.inject("settings.section", () =>
              ctx.slots.register(
                {
                  name: "settings.section",
                  id: SECTION_ID,
                  order: 30,
                  label: () => t("nav"),
                  locale: NS,
                  inject: () => ({ controller })
                },
                KimiSection
              )
            )
          ),
        "llm-kimi: settings section"
      );
    }

    exports.NS = NS;
    exports.SETTINGS_NAMESPACE = SETTINGS_NAMESPACE;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
