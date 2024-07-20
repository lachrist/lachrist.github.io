import {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  lineNumbers,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  foldGutter,
  foldKeymap,
} from "@codemirror/language";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";

const { document } = globalThis;

const listExtension = () => [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap]),
  javascript(),
];

const play = document.getElementById("play");
const stop = document.getElementById("stop");
const log = document.getElementById("log");

const analysis = new EditorView({
  state: EditorState.create({
    doc: `
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
    `,
    extensions: listExtension(),
  }),
  parent: document.getElementById("analysis"),
});

const target = new EditorView({
  state: EditorState.create({
    doc: "'Hello, World!';\n",
    extensions: listExtension(),
  }),
  parent: document.getElementById("target"),
});

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

play.addEventListener("click", (_event) => {
  log.textContent = "";
  getWorker()?.terminate();
  const worker = new Worker("./aran/worker-bundle.mjs", { type: "module" });
  worker.addEventListener("message", ({ data }) => {
    log.textContent += data;
  });
  worker.postMessage({
    analysis: analysis.state.doc.toString(),
    target: target.state.doc.toString(),
  });
  setWorker(worker);
});

document.getElementById("stop").addEventListener("click", (_event) => {
  getWorker()?.terminate();
  setWorker(null);
});
