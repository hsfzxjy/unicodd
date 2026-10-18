# unicodd

**When text behaves oddly.**

unicodd is a browser-based puzzle game about surprising Unicode behavior. Its nine-puzzle
collection covers normalization boundaries, UTF encoding lengths, grapheme clusters, case-fold
collisions, compatibility normalization, visual confusables, invisible format controls, and
malformed UTF-16, plus a verified normalization difference between Unicode 15.1 and Unicode 17.
The Vue workspace lets players recursively explore characters, send discoveries to puzzle inputs,
and inspect every real operation in a read-only graph. Normalization, case folding, and grapheme
segmentation run through ICU4X over raw WASM. The interface supports English and Simplified
Chinese; the language selector preserves the active puzzle, input values, and exploration state.

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
npm run size:check
npm run test:browser
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo fmt --manifest-path crates/unicode-15/Cargo.toml --all -- --check
cargo clippy --manifest-path crates/unicode-15/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path crates/unicode-15/Cargo.toml
```

`npm run size:check` inspects the completed production build and reports raw sizes for the shipped
JavaScript, CSS, WASM modules, and generated Unicode indexes. JavaScript and CSS also report their
gzip sizes. The command fails with the exact overage when a guarded asset exceeds its release
budget.

`npm test` builds the WASM binary first and includes adapter integration tests against the compiled
artifact. Rust tests also run the official Unicode 17.0.0 normalization, case-folding, and
grapheme-break conformance data plus the Unicode 15.1.0 normalization corpus. Normalization is
checked across all four supported forms for both profiles.

The Playwright smoke suite builds and serves the application at `/unicodd/` to verify non-root
static hosting, lazy discovery data, and lazy historical-engine loading. Install its local browser
once with `npx playwright install chromium`.

## Architecture

- `src/components/` contains Vue presentation and interaction.
- `src/composables/` owns editor, explorer, history, and engine state.
- `src/explorer/` contains framework-light grapheme mapping, explicit editing and history behavior,
  plus typed, UI-independent relationship and name-search indexes.
- `src/engine/` defines and executes typed, UI-independent operation graphs.
- `src/puzzles/` contains declarative puzzle content and independently testable success logic.
- `src/puzzles/definitions/` contains one validated JSON content file per puzzle. The catalog loads
  these files automatically and binds each file's named runtime to tested TypeScript behavior.
- `src/puzzles/runtime/` contains the focused, framework-independent runtime registry, evaluation
  families, graph builders, shared typed-value guards, and localized runtime presentation.
- `src/i18n.ts` owns the small reactive UI locale layer, `src/locales/` owns application messages,
  and `src/puzzles/translations/zh-CN.json` contains the validated Simplified Chinese puzzle copy.
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

## Editing and adding puzzles

Puzzle-facing content lives in standalone JSON files under `src/puzzles/definitions/`. Edit a file
to change its title, objective, inputs, graph copy, hints, explanation, capabilities, or profile.
Each file references `src/puzzles/puzzle.schema.json` for editor completion and validation.

To add a puzzle that uses an existing success condition and operation graph, copy the corresponding
JSON file, choose a unique kebab-case `id` and positive `number`, and retain its `runtime`, input ids,
input kinds, and required capabilities. Then add the same id and translated presentation fields to
`src/puzzles/translations/zh-CN.json`. The Vite catalog discovers the new file automatically and
fails fast when its Chinese translation is missing or structurally incomplete.

The runtime catalog validates every file at startup and in tests, including unique ids/numbers,
supported capabilities, and the input contract required by its runtime. A genuinely new success
condition still requires a small TypeScript runtime implementation; executable logic is deliberately
not evaluated from JSON.

## Playing

Use the previous/next buttons or the puzzle list to move through the collection. Puzzle links use a
stable `?puzzle=<id>` query parameter and work with browser back/forward navigation. “How to play”
summarizes the construct → inspect → apply → observe loop; the character lab never changes a puzzle
input until an explicit action is chosen.
