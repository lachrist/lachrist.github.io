import { readFile, writeFile } from "node:fs/promises";

const listName = async () => {
  const data = JSON.parse(await readFile(new URL("package.json", import.meta.url)));
  const names = [];
  for (const item of data.objects) {
    const { name } = item.package;
    if (!name.startsWith("@appland")) {
      names.push(name);
    }
  }
  return names;
}

const countDownload = async (name, begin, end) => {
  const response = await fetch(`https://api.npmjs.org/downloads/range/${begin}:${end}/${name}`);
  const body = await response.text();
  if (!response.ok) {
    const { status, statusText: status_text } = response;
    console.log({ name, begin, end, status, status_text, body });
    return 0;
  }
  const data = JSON.parse(body);
  const total = data.downloads.reduce((sum, day) => sum + day.downloads, 0);
  return total;
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const listRange = () => {
  const ranges = [];
  for (let year = 2012; year < 2025; year++) {
    ranges.push([`${year}-01-01`, `${year}-12-31`]);
  }
  ranges.push(["2025-01-01", "2025-05-22"]);
  return ranges;
};

const main = async () => {
  const names = await listName();
  const ranges = listRange();
  for (const name of names) {
    console.log(`${name}...`);
    for (const [begin, end] of ranges) {
      await wait(1000);
      const count = await countDownload(name, begin, end);
      await writeFile(
        new URL("download.jsonl", import.meta.url),
        JSON.stringify({name, begin, end, count}) + "\n",
        { encoding: "utf-8", flag: "a" },
      );
    }
  }
};

await main();