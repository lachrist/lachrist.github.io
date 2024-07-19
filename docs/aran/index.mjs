import * as astring from "astring";
import * as acorn from "acorn";

const { globalThis: global, parent, String } = globalThis;

const defineGlobal = (name, value) => {
  Object.defineProperty(global, name, {
    __proto__: null,
    value,
    writable: false,
    configurable: false,
    enumerable: false,
  });
};

defineGlobal("astring", astring);
defineGlobal("acorn", acorn);
defineGlobal("aran", { instrument: (code, _options) => code });
defineGlobal("log", (data) => {
  parent.postMessage(String(data), "*");
});
