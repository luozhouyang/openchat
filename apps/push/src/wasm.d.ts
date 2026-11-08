// Wrangler's esbuild bundles .wasm imports as CompiledWasm modules: the import
// value at runtime is the parsed WebAssembly.Module. This declaration backs
// the "import photon_wasm from 'photon-wasm/dist/photon_bg.wasm'" in
// src/thumbnail.ts (wrangler's own generated types cover relative globs, not
// node_modules specifiers).
declare module "*.wasm" {
  const value: WebAssembly.Module;
  export default value;
}
