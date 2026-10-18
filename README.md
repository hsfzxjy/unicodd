# unicodd

**When text behaves oddly.**

unicodd is a browser-based puzzle game about surprising Unicode behavior. Its nine-puzzle
collection covers normalization boundaries, UTF encoding lengths, grapheme clusters, case-fold
collisions, compatibility normalization, visual confusables, invisible format controls, and
malformed UTF-16, plus a verified normalization difference between Unicode 15.1 and Unicode 17.
The Vue workspace lets players recursively explore characters, send discoveries to puzzle inputs,
and inspect every real operation in a read-only graph. Normalization, case folding, and grapheme
segmentation run through ICU4X over raw WASM.

## Development

```sh
npm install
npm run dev
```

The development, test, and production commands compile `crates/unicodd-ops-core` for
`wasm32-unknown-unknown` and generate the pinned Unicode 17 discovery indexes before starting
Vite. Install that Rust target with `rustup target add wasm32-unknown-unknown` if it is not already
available.

## Verification

```sh
npm run format:check
npm run typecheck
npm test
npm run build
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo fmt --manifest-path crates/unicode-15/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/unicode-15/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/unicode-15/Cargo.toml
```

`npm test` builds the WASM binary first and includes adapter integration tests against the compiled
artifact. Rust tests also run the official Unicode 17.0.0 normalization, case-folding, and
grapheme-break conformance data plus the Unicode 15.1.0 normalization corpus. Normalization is
checked across all four supported forms for both profiles.

## Architecture

- `src/components/` contains Vue presentation and interaction.
- `src/composables/` owns editor, explorer, history, and engine state.
- `src/explorer/` contains framework-light grapheme mapping, explicit editing and history behavior,
  plus typed, UI-independent relationship and name-search indexes.
- `src/engine/` defines and executes typed, UI-independent operation graphs.
- `src/puzzles/` contains declarative puzzle content and independently testable success logic.
- `src/unicode.ts` contains only version-independent representation utilities.
- `crates/unicodd-ops-core/` exposes ICU4X normalization, default full case folding, and grapheme
  segmentation plus Unicode names through a C-compatible ABI without `wasm-bindgen`.
- `crates/unicode-15/` is an independent Cargo workspace pinned to ICU4X 1.5 and Unicode 15.1
  normalization data. It shares ABI version 3 and is loaded only by the historical puzzle.
- `src/wasm/` owns module loading, ABI validation, memory allocation, typed-array views, and output
  copying. Its profile registry dispatches and caches WASM modules lazily.
- `tools/unicode-indexer/` generates versioned reverse-decomposition, casing, property, name, and
  UTS #39 confusable data from pinned official sources. The full name index loads only when used.

Scalar sequences (`Uint32Array`), raw bytes (`Uint8Array`), and UTF-16 code units (`Uint16Array`)
are deliberately distinct types. The editor does not normalize or otherwise transform input.
