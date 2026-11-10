# unicodd

unicodd is a browser-based Unicode puzzle game. Explore fictional hosts, read their files, and investigate how they interpret text. Use commands or clickable actions to navigate, and inspect Unicode characters and reuse them directly in the terminal.

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

```sh
cargo test --locked
npm test
npm run typecheck
npm run validate:content
npx playwright install chromium
npm run test:browser
```

## Authoring scenarios

The game reads the manifest and UTF-8 content files at runtime. Publish the contents of `public/content/` under `content/` on the static site.

1. **Register the scenario.** Add an entry to `scenarios` in [manifest.json](public/content/manifest.json), in display order. The version-1 entry has a unique `id`, a selector `label`, and a `scenario` path relative to `content/`. Optional `available: false` disables selection. The first available scenario opens automatically.
2. **Define the world.** In the version-1 scenario file, supply `title`, `introduction`, declared `roles` and `flags`, a `local` identity, `hosts`, and an `objective`. An identity has `user` and `role`. A host has an `id`, `name`, `guest` identity, `welcome` message, and `resources`. An optional `discover` flag hides the host until set. An optional `initialHost` starts the player on an initially discoverable host.
3. **Add resources.** Give each resource a unique `id`, an absolute virtual `path`, and a `type` of `directory` or `file`. The root is implicit. Declare each other parent directory. Files have a `content` asset path relative to the scenario file. Optional `discover` and `access` guards govern visibility and use, including descendants. A guard can require membership in a list of `roles`, a set `flag`, or both. Mark specific file lines with one-based `inspectLines` to make their code points interactive. Optional `onRead` effects can set a `flag`, change the `session` identity, or emit a `message`.
4. **Bind a puzzle.** A host's optional `login` defines the editor `label`, the referenced `puzzle` file, its single `input`, optional `initial` text and `access` guard, `success` effects, and fallback `failure` text. Optional `rejected` entries map failed check IDs to messages in priority order. The puzzle file contains only the program described below.
5. **Set the objective.** Give `objective` its visible `text`, the file resource ID under `read`, and a completion `message`. The runtime completes the objective on an authorized read of that resource.
6. **Validate and play-test.** Run `npm run validate:content` after building WASM. It checks every registered entry, including unavailable ones, and reports the file and field for invalid content and references. Try both command and click paths in the browser.

Use stable ASCII IDs and safe relative asset paths. Published resources are public static assets, including files that require access in the game. Keep real secrets out of content. Objective completion uses browser storage when available. Session identity and the transcript, including Unicode inspection history, are kept in memory.

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

Unicode normalization uses the versioned data in the locked `unicode-normalization` crate (Unicode 18.0.0). Query `engine.info()` for the schema and Unicode versions. Text is compared exactly unless a program explicitly normalizes it. The evaluator counts Unicode scalar values. The editor shows code-point counts and positions and marks isolated surrogates so they can be repaired. In the terminal, `inspect` accepts a single literal scalar or a code point. A single literal scalar takes precedence over bare hex. Use `U+` to disambiguate a one-digit hex value.

Limits include 32 input declarations, 256 nodes, 128 checks, 32 KiB of UTF-8 per input and 256 KiB total, 128 KiB per text value, 2 MiB combined intermediate text, and 512 KiB of trace text. WASM request limits are 13 MiB for serialized programs and 2 MiB for serialized input objects.
