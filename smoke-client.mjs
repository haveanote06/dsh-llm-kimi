// Offline smoke test for the browser half (lib/client.js).
// Run with: node smoke-client.mjs
//
// The bundle is a classic script that registers a factory on
// `window.__ModuleLoader__`; nothing here renders React, so a fake React is
// enough. Every cordis surface the bundle touches is stubbed with a recorder.

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const registrations = [];
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registrations.push(registration);
    }
  }
};

const react = {
  createElement(type, props, ...children) {
    return { type, props: props ?? {}, children };
  },
  useState(value) {
    return [value, () => {}];
  },
  useEffect() {},
  useSyncExternalStore() {
    return undefined;
  }
};

const require = (spec) => {
  if (spec === "react") return react;
  throw new Error(`smoke-client: unexpected require("${spec}") — only seed words may be required`);
};

const entry = "lib/client.js";
await import(new URL(entry, import.meta.url).href);

assert.equal(registrations.length, 1, "the bundle must register exactly one factory");
assert.equal(registrations[0].id, "dsh-llm-kimi", "registration id must equal the package name");

const exportsOf = registrations[0].factory(require);
assert.deepEqual(Object.keys(exportsOf).sort(), ["NS", "SETTINGS_NAMESPACE", "apply", "inject"]);
assert.equal(exportsOf.NS, "settings.llmKimi");
assert.equal(exportsOf.SETTINGS_NAMESPACE, "llm-kimi");
assert.deepEqual(exportsOf.inject, ["slots", "locale", "remote", "remote.credentials", "configForms"]);

// --- fake host ---------------------------------------------------------------

let sectionValue = { apiKeyEnv: "MOONSHOT_API_KEY", apiKeyEnvCode: "KIMI_API_KEY", models: [{}, {}, {}] };
let formStatus = "ready";
let formWritable = true;

const formListeners = new Set();
const form = {
  getSnapshot() {
    return {
      status: formStatus,
      value: sectionValue,
      base: undefined,
      user: undefined,
      revision: 1,
      writable: formWritable
    };
  },
  subscribe(listener) {
    formListeners.add(listener);
    return () => formListeners.delete(listener);
  },
  async set(field, value) {
    sectionValue = { ...sectionValue, [field]: value };
    for (const listener of formListeners) listener();
    return true;
  },
  async unset() {
    return true;
  },
  async mutate() {
    return true;
  }
};

const getCalls = [];
const described = [];
const setCalls = [];
const unsetCalls = [];
const remoteListeners = new Set();
const registered = [];
const effects = [];

const ctx = {
  effect(fn, label) {
    effects.push(label);
    const dispose = fn();
    return typeof dispose === "function" ? dispose : () => {};
  },
  configForms: {
    get(namespace) {
      getCalls.push(namespace);
      return form;
    },
    whileServed(namespaces, register) {
      assert.deepEqual(namespaces, ["llm-kimi"], "the section must wait for the llm-kimi namespace");
      return register(new Set(namespaces));
    }
  },
  slots: {
    inject(key, callback) {
      return callback();
    },
    register(options, Component) {
      registered.push({ options, Component });
      return () => {};
    }
  },
  locale: {
    bind(namespace) {
      return (key, vars) => (vars === undefined ? key : key + JSON.stringify(vars));
    },
    register(namespace, dicts) {
      registered.push({ locale: namespace, dicts });
      return () => {};
    }
  },
  remote: {
    credentials: {
      async describe(refs) {
        described.push([...refs]);
        const value = {};
        for (const ref of refs) value[ref] = { configured: ref === "KIMI_API_KEY", writable: true };
        return { ok: true, value };
      },
      async set(ref, value) {
        setCalls.push([ref, value]);
        return { ok: true, value: undefined };
      },
      async unset(ref) {
        unsetCalls.push(ref);
        return { ok: true, value: undefined };
      }
    },
    $on(event, listener) {
      remoteListeners.add(event);
      return () => remoteListeners.delete(event);
    }
  }
};

exportsOf.apply(ctx);
await new Promise((resolve) => setTimeout(resolve, 0));

// --- assertions --------------------------------------------------------------

assert.deepEqual(getCalls, ["llm-kimi"], "the controller must read the llm-kimi namespace");

const dict = registered.find((item) => item.locale === "settings.llmKimi");
assert.ok(dict, "the bundle must register its locale namespace");
assert.deepEqual(Object.keys(dict.dicts).sort(), ["en", "zh"]);

const section = registered.find((item) => item.options?.name === "settings.section");
assert.ok(section, "the bundle must register a settings.section");
assert.equal(section.options.id, "kimi");
assert.equal(section.options.order, 30);
assert.equal(section.options.locale, "settings.llmKimi");
assert.equal(typeof section.options.label, "function");
assert.equal(section.options.label(), "nav");
assert.equal(typeof section.Component, "function");

const injected = section.options.inject();
assert.ok(injected.controller, "the section must receive the controller");

assert.deepEqual([...remoteListeners].sort(), ["credentials/record-updated", "credentials/reference-updated"]);

assert.deepEqual(described[0], ["KIMI_API_KEY", "MOONSHOT_API_KEY"], "initial credential read must be de-duplicated");

const controller = injected.controller;
const [code, cn, global] = ["kimi-code", "kimi-cn", "kimi-global"].map((id) =>
  controller.credentialOf({ id, refFields: refFieldsOf(id), fallbackRef: id === "kimi-code" ? "KIMI_API_KEY" : "MOONSHOT_API_KEY" })
);

function refFieldsOf(id) {
  if (id === "kimi-code") return ["apiKeyEnvCode", "apiKeyEnv"];
  if (id === "kimi-cn") return ["apiKeyEnvCn", "apiKeyEnv"];
  return ["apiKeyEnvGlobal", "apiKeyEnv"];
}

assert.equal(code.ref, "KIMI_API_KEY");
assert.equal(code.configured, true);
assert.equal(cn.ref, "MOONSHOT_API_KEY");
assert.equal(global.ref, "MOONSHOT_API_KEY");

// per-route override beats the shared field
sectionValue = { ...sectionValue, apiKeyEnvCn: "MY_CN_KEY" };
const cnOverride = controller.credentialOf({ id: "kimi-cn", refFields: refFieldsOf("kimi-cn"), fallbackRef: "MOONSHOT_API_KEY" });
assert.equal(cnOverride.ref, "MY_CN_KEY", "apiKeyEnvCn must win over apiKeyEnv");

// writes go through the credential remote, base URLs through configForms
await controller.writeKey({ id: "kimi-code", refFields: refFieldsOf("kimi-code"), fallbackRef: "KIMI_API_KEY" }, "sk-test");
assert.deepEqual(setCalls, [["KIMI_API_KEY", "sk-test"]]);
assert.equal(await controller.setBaseURL({ id: "kimi-cn", field: "baseURLCn" }, "https://example.test/v1"), true);
assert.equal(sectionValue.baseURLCn, "https://example.test/v1");

await controller.clearKey({ id: "kimi-code", refFields: refFieldsOf("kimi-code"), fallbackRef: "KIMI_API_KEY" });
assert.deepEqual(unsetCalls, ["KIMI_API_KEY"]);

// snapshot shape the section renders from
const snapshot = controller.getSnapshot();
assert.equal(snapshot.status, "ready");
assert.equal(snapshot.revision, 1);
assert.equal(snapshot.writable, true);

// a rejected write must surface as ok:false rather than throwing
ctx.remote.credentials.set = async () => ({ ok: false, error: { code: "nope" } });
const rejected = await controller.writeKey({ id: "kimi-cn", refFields: refFieldsOf("kimi-cn"), fallbackRef: "MOONSHOT_API_KEY" }, "x");
assert.deepEqual(rejected, { ok: false });

// an unavailable namespace must still mount a section (the body explains it)
formStatus = "unavailable";
controller.emit();
assert.equal(controller.getSnapshot().status, "unavailable");

console.log("CLIENT SMOKE OK");
