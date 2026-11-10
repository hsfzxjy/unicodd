# unicodd

unicodd is a browser workspace for Unicode puzzle definitions. The Unicode Workbench can also inspect and normalize individual characters independently.

## Build and run

Install Node.js 22.12 or newer, npm, and Rust through rustup. The build was verified with Node.js 26 and Rust 1.99.1. Install the Rust target and the matching WASM binding CLI once.

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked
npm ci
npm run build:wasm
npm run dev
```

Run `npm run build:wasm` again after changing the Rust core. The script builds with the Cargo lockfile and writes browser bindings to `src/lib/wasm/pkg/`. Run `npm run build` to type-check and build the static site in `dist/`. Serve it over HTTPS for clipboard access, or use localhost during development.

Append `?fixtures` to the development URL to load the integration fixtures. The production build reads its target catalog from `src/data/targets.ts`.

```sh
cargo test --locked
npm test
npm run typecheck
npx playwright install chromium
npm run test:browser
```

## Target definitions

Export a catalog of `Target` objects from `src/data/targets.ts`. Each target provides an `id`, `title`, `objective`, and a `program`. Optional `description`, `payloads`, `checks`, and `output` fields control presentation. The [TypeScript definitions](src/types.ts) describe these fields. Initial text is optional and defaults to an empty draft. The UI retains each target's drafts for the current page session. Workbench favorites and recents use browser storage when available.

### Program schema v1

A program has four fields.

| Field     | Meaning                                             |
| --------- | --------------------------------------------------- |
| `version` | Schema version, currently `1`                       |
| `inputs`  | Array of unique text input IDs                      |
| `nodes`   | Array of computation nodes in any declaration order |
| `checks`  | Array of Boolean checks in display order            |

Identifiers contain 1–64 ASCII letters, digits, underscores, hyphens, or dots. Input, node, and check identifiers are unique within their respective arrays. Nodes have an `id`, an `op`, and the fields shown below. The entries of `args` are node IDs. Literals use `{ "type": "text" | "boolean" | "integer", "value": … }`. Integers range from zero to `Number.MAX_SAFE_INTEGER`.

| Operation                            | Additional fields or argument types                                 | Result       |
| ------------------------------------ | ------------------------------------------------------------------- | ------------ |
| `input`                              | `input` is a declared input ID                                      | Text         |
| `literal`                            | `value` is a typed literal                                          | Literal type |
| `concat`                             | Text, text                                                          | Text         |
| `normalize`                          | One text argument and `form` set to `NFC`, `NFD`, `NFKC`, or `NFKD` | Text         |
| `codePointLength`                    | Text                                                                | Integer      |
| `textEqual`                          | Text, text                                                          | Boolean      |
| `contains`, `startsWith`, `endsWith` | Text to search, text to find                                        | Boolean      |
| `not`                                | Boolean                                                             | Boolean      |
| `and`, `or`, `booleanEqual`          | Boolean, Boolean                                                    | Boolean      |
| `integerEqual`                       | Integer, integer                                                    | Boolean      |

Each check has an `id`, a `node` referring to a Boolean result, an `expected` Boolean, and an optional `required` flag that defaults to true. The check passes when actual equals expected. The program is solved when every required check passes, including programs with zero required checks.

### Evaluator API and Unicode behavior

Rust consumers can call `validate_program`, `evaluate`, and `normalize` from `unicodd-core`. The browser uses the typed `Engine` interface. Its WASM bindings accept UTF-8 byte arrays for JSON programs, JSON input objects, and plain text to normalize. The exports return JSON envelopes with `ok` and either `value` or an `error` containing a code, message, and optional path. The TypeScript bridge rejects unpaired surrogates before encoding and reports their zero-based UTF-16 offset. Rust rejects invalid UTF-8 and malformed JSON.

Evaluation returns `solved`, ordered `checks` with their actual and expected Booleans, and, when requested, a topologically ordered `trace`. Each trace record includes its node ID, operator, dependency IDs, and typed result. When the trace reaches its text budget, the response includes the available prefix and `traceTruncated: true`.

Unicode normalization uses the versioned data in the locked `unicode-normalization` crate (Unicode 18.0.0). Query `engine.info()` for the schema and Unicode versions. Text is compared exactly unless a program explicitly normalizes it. The evaluator counts Unicode scalar values. The editor shows code points and UTF-16 units separately and marks isolated surrogates so they can be repaired. In Workbench lookup, a single literal scalar takes precedence over bare hex. Use `U+` to disambiguate a one-digit hex value.

Limits include 32 input declarations, 256 nodes, 128 checks, 32 KiB of UTF-8 per input and 256 KiB total, 128 KiB per text value, 2 MiB combined intermediate text, and 512 KiB of trace text. WASM request limits are 13 MiB for serialized programs and 2 MiB for serialized input objects.
