import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "child_process";
import { text } from "node:stream/consumers";

// Through the production systems and prototypes I have developed over the years, I have established a proven track record as an excellent programmer with expert-level knowledge of JavaScript and TypeScript. I am highly proficient in standard web and mobile technologies and have mastered related languages such as SQL, Python, Java, Kotlin, and Ruby. Additionally, I have significant experience with Haskell, having taught it for seven years at the university and successfully applied it in several projects.

const HEAD = "__HEAD__";

const BODY = "__BODY__";

/** @type {(command: string, argv: string[], cwd: URL) => Promise<void>} */
const spawnAsync = (command, argv, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(
            `Command "${command} ${argv.join(" ")}" was killed with signal ${signal}`,
          ),
        );
      } else {
        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              `Command "${command} ${argv.join(" ")}" exited with code ${code}`,
            ),
          );
        }
      }
    });
  });

/** @type {(template: string, head: string, body: string[]) -> string} */
const compileMarkdown = (template, head, body) =>
  template.replace(HEAD, head).replace(BODY, body.join("\n\n"));

/** @type {(text: string) -> string} */
const convertMarkdownLink = (text) =>
  text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/gu,
    (_, label, url) => `\\ImplicitLink{${url}}{${label}}`,
  );

/** @type {(text: string) -> string} */
const escapePercent = (text) => text.replace(/%/gu, "\\%");

/** @type {(text: string) -> string} */
const prependSkip = (text) => `\\vspace{12pt}\n${text}`;

/** @type {(text: string) -> string} */
const fromMarkdownToLatex = (text) => convertMarkdownLink(escapePercent(text));

/** @type {(template: string, head: string, body: string[]) -> string} */
const compileLatex = (template, head, body) =>
  template
    .replace(HEAD, fromMarkdownToLatex(head))
    .replace(BODY, body.map(fromMarkdownToLatex).map(prependSkip).join("\n\n"));

/** @type {(base: string) => Promise<void>} */
const buildLatexBiber = async (base) => {
  const cwd = new URL(".", import.meta.url);
  await spawnAsync("xelatex", [base], cwd);
  await spawnAsync("biber", [base], cwd);
  await spawnAsync("xelatex", [base], cwd);
  await spawnAsync("xelatex", [base], cwd);
  await spawnAsync("mv", [`${base}.pdf`, `../docs/assets/${base}.pdf`], cwd);
};

/** @type {(base: string) => Promise<void>} */
const buildLatex = async (base) => {
  const cwd = new URL(".", import.meta.url);
  await spawnAsync("xelatex", [base], cwd);
  await spawnAsync("mv", [`${base}.pdf`, `../docs/assets/${base}.pdf`], cwd);
};

/** @type {(text: string) -> string} */
const trim = (text) => text.trim();

/** @type {(text: string) -> boolean} */
const isNotEmpty = (text) => text !== "";

const main = async () => {
  const bio = await readFile(new URL("bio.md", import.meta.url), "utf-8");
  const [head, ...body] = bio.split("\n\n").map(trim).filter(isNotEmpty);
  // Index //
  await writeFile(
    new URL("../docs/index.md", import.meta.url),
    compileMarkdown(
      await readFile(new URL("index.template.md", import.meta.url), "utf-8"),
      head,
      body,
    ),
    "utf-8",
  );
  // CV //
  await writeFile(
    new URL("cv.tex", import.meta.url),
    compileLatex(
      await readFile(new URL("cv.template.tex", import.meta.url), "utf-8"),
      head,
      body,
    ),
    "utf-8",
  );
  await buildLatexBiber("cv");
  // CV Academic //
  await buildLatexBiber("cv-academic");
  // Cover //
  await writeFile(
    new URL("cover.tex", import.meta.url),
    compileLatex(
      await readFile(new URL("cover.template.tex", import.meta.url), "utf-8"),
      head,
      body,
    ),
    "utf-8",
  );
  await buildLatex("cover");
};

await main();
