// The server is ESM ("type": "module") but Jest runs through CJS — this preset transpiles our source to CJS for tests only; node_modules stay untouched.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]]
};
