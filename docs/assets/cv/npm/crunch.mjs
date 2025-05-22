import {readFile} from "node:fs/promises";
const data = (await readFile(new URL("download.jsonl", import.meta.url), "utf8"))
  .split("\n")
  .filter((line) => line.length > 0)
  .map(JSON.parse);
const download = {};
for (const { name, count } of data) {
  download[name] = (download[name] ?? 0) + count;
}
let total = 0;
for (const [name, count] of Object.entries(download)) {
  console.log(`${name}: ${count}`);
  total += count;
}
console.log(`Total: ${total}`);