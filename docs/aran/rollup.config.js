import resolve from "@rollup/plugin-node-resolve";

export default {
  input: "./docs/aran/index.mjs",
  output: {
    file: "./docs/aran/index.js",
    format: "iife",
  },
  plugins: [resolve()],
};
