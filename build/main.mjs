import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from "child_process";

// Through the production systems and prototypes I have developed over the years, I have established a proven track record as an excellent programmer with expert-level knowledge of JavaScript and TypeScript. I am highly proficient in standard web and mobile technologies and have mastered related languages such as SQL, Python, Java, Kotlin, and Ruby. Additionally, I have significant experience with Haskell, having taught it for seven years at the university and successfully applied it in several projects.

const XELATEX = "xelatex"
const BIBER = "biber";

/** @type {(command: string, argv: string[], cwd: URL) => Promise<void>} */
const spawnAsync = (command, argv, cwd) => new Promise((resolve, reject) => {
    const child = spawn(command, argv, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
        if (signal) {
            reject(new Error(`Command "${command} ${argv.join(" ")}" was killed with signal ${signal}`));
        } else {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Command "${command} ${argv.join(" ")}" exited with code ${code}`));
            }
        }
    });
});

const bio = await readFile(
    new URL("bio.md", import.meta.url),
    "utf-8",
);

const [head, ...body] = bio.split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0);

/** @type {(template: string, head: string, body: string[]) -> string} */
const compileIndex = (template, head, body) => 
    template
        .replace("__HEAD__", head)
        .replace("__BODY__", body.join("\n\n"));

/** @type {(template: string, head: string, body: string[]) -> string} */
const convertLink = (text) => text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/gu,
    (_, label, url) => `\\ImplicitLink{${url}}{${label}}`,
);

/** @type {(text: string) -> string} */
const escapePercent = (text) => text.replace(/%/gu, "\\%");

/** @type {(text: string) -> string} */
const prependSkip = (text) => `\\vspace{12pt}\n${text}`;

/** @type {(text: string) -> string} */
const toLatex = (text) => convertLink(escapePercent(text));

/** @type {(template: string, head: string, body: string[]) -> string} */
const compileLatex = (template, head, body) => template
    .replace("__HEAD__", toLatex(head))
    .replace(
        "__BODY__",
        body
            .map(toLatex)
            .map(prependSkip)
            .join("\n\n"),
    );

const buildCV = async () => {
    const cwd = new URL("../docs/assets/cv", import.meta.url);
    await spawnAsync(XELATEX, ["cv"], cwd);
    await spawnAsync(BIBER, ["cv"], cwd);
    await spawnAsync(XELATEX, ["cv"], cwd);
    await spawnAsync(XELATEX, ["cv"], cwd);
};

const buildCover = async () => {
    const cwd = new URL("../docs/assets/cover", import.meta.url);
    await spawnAsync(XELATEX, ["cover"], cwd);
};

await writeFile(
    new URL("../docs/index.tex", import.meta.url),
    compileIndex(
        await readFile(
            new URL("index.md", import.meta.url),
            "utf-8",
        ),
        head,
        body,
    ),
    "utf-8",
);

await writeFile(
    new URL("../docs/assets/cover/cover.tex", import.meta.url),
    compileLatex(
        await readFile(
            new URL("cover.tex", import.meta.url),
            "utf-8",
        ),
        head,
        body,
    ),
    "utf-8",
);

await writeFile(
    new URL("../docs/assets/cv/cv.tex", import.meta.url),
    compileLatex(
        await readFile(
            new URL("cv.tex", import.meta.url),
            "utf-8",
        ),
        head,
        body,
    ),
    "utf-8",
);

await buildCV();

await buildCover();

