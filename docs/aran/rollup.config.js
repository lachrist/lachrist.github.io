import resolve from "@rollup/plugin-node-resolve";

export default [
  {
    input: "./docs/aran/index.mjs",
    output: {
      file: "./docs/aran/index-bundle.mjs",
      format: "module",
    },
    plugins: [resolve()],
  },
  {
    input: "./docs/aran/worker.mjs",
    output: {
      file: "./docs/aran/worker-bundle.mjs",
      format: "module",
    },
    plugins: [resolve()],
  },
];
