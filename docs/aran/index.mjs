const { document } = globalThis;

const play = document.getElementById("play");
const stop = document.getElementById("stop");
const target = document.getElementById("target");
const analysis = document.getElementById("analysis");
const log = document.getElementById("log");

/**
 * @type {Worker | null}
 */
let worker;

/**
 * @type {() => Worker | null}
 */
const getWorker = () => worker;

/**
 * @type {(
 *   value: Worker | null,
 * ) => void}
 */
const setWorker = (value) => {
  worker = value;
  stop.disabled = value === null;
};

setWorker(null);

target.value = "'Hello, World!';";

analysis.value = `
    const {
      eval: evalGlobal,
    } = globalThis;
    const {
      log,
      aran,
      astring,
      acorn,
      target,
    } = context;
    log(
      evalGlobal(
        astring.generate(
          aran.instrument(
            acorn.parse(
              target,
              { ecmaVersion: 2024 },
            ),
          ),
        ),
      ),
    );
  `;

play.addEventListener("click", (_event) => {
  log.textContent = "";
  getWorker()?.terminate();
  const worker = new Worker("./aran/worker.mjs", { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    log.textContent += data;
  });
  worker.postMessage({
    analysis: analysis.value,
    target: target.value,
  });
  setWorker(worker);
});

document.getElementById("stop").addEventListener("click", (_event) => {
  getWorker()?.terminate();
  setWorker(null);
});
