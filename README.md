# unicodd

**When text behaves oddly.**

unicodd is a browser-based puzzle game about surprising Unicode behavior. Milestone 1 provides a
small Vue workspace for entering Unicode text, inspecting individual scalar values, and following
an executable representation pipeline from scalars to UTF-8 bytes to byte length.

## Development

```sh
npm install
npm run dev
```

## Verification

```sh
npm run format:check
npm run typecheck
npm test
npm run build
```

The Rust formatter configuration is present for the future WASM workspace. Once a Rust crate is
introduced, also run `cargo fmt --all -- --check` and its Cargo test/build commands.

## Architecture

- `src/components/` contains Vue presentation and interaction.
- `src/composables/` owns editor and inspector selection state.
- `src/engine/` defines and executes typed, UI-independent operation graphs.
- `src/unicode.ts` contains only version-independent representation utilities.
- `src/wasm/` documents the future raw WebAssembly boundary; no Unicode engine is simulated yet.

Scalar sequences (`Uint32Array`), raw bytes (`Uint8Array`), and UTF-16 code units (`Uint16Array`)
are deliberately distinct types. The editor does not normalize or otherwise transform input.
