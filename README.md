# unicodd

**When text behaves oddly.**

unicodd is a browser-based puzzle game about surprising Unicode behavior. The current foundation
provides a Vue workspace for entering Unicode text, inspecting individual scalar values, following
an executable representation pipeline, and observing ICU4X NFC normalization through raw WASM.

## Development

```sh
npm install
npm run dev
```

The development and production commands compile `crates/unicodd-ops-core` for
`wasm32-unknown-unknown` before starting Vite. Install that Rust target with
`rustup target add wasm32-unknown-unknown` if it is not already available.

## Verification

```sh
npm run format:check
npm run typecheck
npm test
npm run build
cargo fmt --all -- --check
cargo test --workspace
```

`npm test` builds the WASM binary first and includes adapter integration tests against the compiled
artifact. Rust tests also run the official Unicode 17.0.0 normalization conformance corpus against
all four supported normalization forms.

## Architecture

- `src/components/` contains Vue presentation and interaction.
- `src/composables/` owns editor and inspector selection state.
- `src/engine/` defines and executes typed, UI-independent operation graphs.
- `src/unicode.ts` contains only version-independent representation utilities.
- `crates/unicodd-ops-core/` exposes ICU4X normalization through a C-compatible ABI without
  `wasm-bindgen`.
- `src/wasm/` owns module loading, ABI validation, memory allocation, typed-array views, and output
  copying.

Scalar sequences (`Uint32Array`), raw bytes (`Uint8Array`), and UTF-16 code units (`Uint16Array`)
are deliberately distinct types. The editor does not normalize or otherwise transform input.
