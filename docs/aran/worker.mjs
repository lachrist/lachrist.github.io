import * as astring from "./astring.mjs";
import * as acorn from "./acorn.mjs";

const { String, eval: evalGlobal, addEventListener, postMessage } = globalThis;

const aran = {
  instrument: (code, _options) => code,
};

const log = (data) => {
  postMessage(String(data));
};

addEventListener("message", ({ data: { analysis, target } }) => {
  try {
    evalGlobal(`((context) => {\n${analysis}\n});`)({
      astring,
      acorn,
      aran,
      log,
      target,
    });
  } catch (error) {
    log(error);
  }
});
