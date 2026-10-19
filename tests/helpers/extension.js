const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const flush = () => new Promise(setImmediate);
const event = () => {
  const listeners = [];
  return {listeners, addListener: fn => listeners.push(fn), removeListener() {},
    fire: (...args) => Promise.all(listeners.map(fn => fn(...args)))};
};
function storage(initial = {}) {
  const changed = event();
  const area = (values, name) => ({
    values,
    async get(keys, callback) {
      const result = keys == null ? {...values} : typeof keys === 'string' ? {[keys]: values[keys]} :
        Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, values[key]])) : {...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in values).map(key => [key, values[key]]))};
      const copy = structuredClone(result);
      if (callback) queueMicrotask(() => callback(copy));
      return copy;
    },
    async set(items, callback) {
      const changes = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = {oldValue: values[key], newValue: structuredClone(value)};
        values[key] = structuredClone(value);
      }
      await changed.fire(changes, name);
      if (callback) callback();
    },
    async remove(keys, callback) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
      if (callback) callback();
    },
    async clear() { Object.keys(values).forEach(key => delete values[key]); }
  });
  return {local: area({...initial.local}, 'local'), session: area({...initial.session}, 'session'),
    sync: area({...initial.sync}, 'sync'), onChanged: changed};
}
function worker(options = {}) {
  const calls = [];
  const imports = [];
  const activeTab = {id: 42, url: 'https://example.test/register'};
  const runtime = {id: 'fixture', getURL: file => 'chrome-extension://fixture' + file,
    getManifest: () => ({version: 'fixture'}), onMessage: event(), onInstalled: event(), onStartup: event()};
  const chrome = {
    runtime, storage: options.storage || storage(),
    action: {setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {}, setIcon() {}},
    contextMenus: {create() {}, remove() {}, onClicked: event()}, commands: {onCommand: event()},
    tabs: {onRemoved: event(), query: async () => [activeTab]},
    sidePanel: {
      setOptions: async value => {calls.push(['options', value]);},
      open: value => {calls.push(['open', value]); return options.open ? options.open(value) : Promise.resolve();}
    },
    scripting: {
      unregisterContentScripts: async () => {},
      executeScript: async value => {calls.push(['script', value]); return options.executeScript ? options.executeScript(value) : [{result: []}];}
    },
    windows: {
      getCurrent: async () => ({left: 0, top: 0, width: 1000, height: 800}),
      create: async value => {calls.push(['window', value]); return options.createWindow ? options.createWindow(value) : {id: 1};}
    }
  };
  const context = {chrome, console: {warn() {}, info() {}}, navigator: {webdriver: true, userAgent: 'Chrome'},
    URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Uint8Array, atob, btoa,
    crypto: require('node:crypto').webcrypto, setTimeout: () => 1, clearTimeout() {}};
  context.self = context;
  vm.createContext(context);
  context.importScripts = (...files) => files.forEach(file => {
    imports.push(file);
    vm.runInContext(read(file.replace(/^\//, '')), context, {filename: file});
  });
  vm.runInContext(read('worker.js'), context, {filename: 'worker.js'});
  const message = (request, sender = {tab: activeTab, frameId: 7}) => new Promise(resolve => {
    const result = runtime.onMessage.listeners[0](request, sender, resolve);
    if (result !== true) resolve(result);
  });
  return {context, chrome, calls, imports, activeTab, message};
}
function panel(chrome, extra = {}) {
  const elements = new Map();
  const listeners = {};
  const field = selector => {
    if (!elements.has(selector)) elements.set(selector, {value: '', name: selector.match(/name=([^\]]+)/)?.[1],
      dataset: {}, style: {}, classList: {toggle() {}, add() {}, remove() {}},
      addEventListener() {}, focus() {}, setAttribute() {}, select() {}, blur() {}});
    return elements.get(selector);
  };
  const styles = [];
  const document = {querySelector: field, querySelectorAll: () => [],
    createElement: () => ({}), head: {appendChild: node => styles.push(node)},
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }};
  const context = {chrome, document, URL, URLSearchParams, location: {search: '?tab=42'}, console,
    localStorage: {getItem: () => extra.style || null}, addEventListener() {},
    setTimeout: () => 1, clearTimeout() {}, window: {close() {}},
    tldjs: {getDomain: () => 'example.test'},
    __kpPasswordPrefs: require('../../tools/password-prefs.js'),
    __kpSaveState: require('../../tools/save-state.js'),
    __kpPasswordGen: {generate: prefs => extra.generate ? extra.generate(prefs) : 'generated-fixture'}, ...extra.context};
  context.self = context;
  vm.createContext(context);
  vm.runInContext(read('data/save/index.js'), context, {filename: 'data/save/index.js'});
  const input = (name, value) => {
    const element = field('[name=' + name + ']');
    element.value = value;
    for (const fn of listeners.input || []) fn({target: element});
  };
  return {field, input, context, listeners, styles};
}
module.exports = {read, flush, event, storage, worker, panel};
