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

### Debug levels

With `npm run dev`, open `/?debug=1` to switch between all available levels from the terminal title bar. Add `&scenario=<id>` to start on a specific level. The debug session uses direct-entry evidence and keeps its workspaces in memory for the lifetime of the page.

## Local console and remote sessions

The local console holds the inbox, host directory, and campaign. Use `connect <host>` to open a host listed in the current case's directory. The remote prompt starts with `@`. On that host, `ls`, `cat`, and any available host operations use its own files and access rules. `logout` closes the connection and returns you to the local console.

While connected, use the title-bar inbox or host directory, or type `local mail` and `local hosts`. They run at the local console and leave your remote session active. `local connect <host>` can switch to another reachable host in the same case. The campaign selector and `local scenario <id>` open discovered cases in their own workspaces.

## Composing commands

Type a command followed by Space to select its tag and edit its arguments in the terminal prompt. Click the tag to switch commands without executing them. Enter on a bare command with required arguments opens its fields. Complete one-line commands, including quoted arguments, still work.

Enter moves to the next parameter or runs from the last. Shift+Enter inserts a newline. Tab reaches the editor controls, and Shift+Tab from an argument goes back to the previous parameter or command tag. Run submits from any field. Escape returns to command-name editing and keeps the structured draft cached. Up/Down recall history in the ordinary prompt. Use Alt+Up/Down from an argument. Rejected commands keep their arguments and selection for retry. Each scenario saves its drafts and command history. Opening or closing a remote connection clears the active draft context.

The active parameter can offer Code points, UTF-8, UTF-16, or WTF-8. Choose a representation from the title when several are available. The title shows a zero-based caret position or half-open selection range and a total in that representation's units. Selecting a group selects its source character or escape. The expanded inspector toolbar stays above the scrolling groups. Drag the grip at the top of an argument editor or focus it and use Up/Down to resize it. The browser remembers each command argument's height. Explicit Insert and Replace actions use the active parameter's remembered selection. Edit this command in the transcript restores the raw command for reuse.

## Authoring scenarios

The game reads the manifest and UTF-8 content files at runtime. Publish the contents of `public/content/` under `content/` on the static site.

1. **Register the scenario.** Add an entry to `scenarios` in [manifest.json](public/content/manifest.json), in display order. The version-1 entry has a unique `id`, a selector `label`, and a `scenario` path relative to `content/`. Optional `available: false` disables selection. Optional `initiallyDiscovered: false` hides an available scenario until an objective discovers it. On a fresh campaign the first initially discovered scenario opens.
2. **Define the world.** In the version-1 scenario file, supply `title`, `introduction`, declared `roles` and `flags`, a `local` identity, `hosts`, and an `objective`. An identity has `user` and `role`. A host has an `id`, `name`, `guest` identity, `welcome` message, and `resources`. An optional `discover` flag hides the host until set. An optional `initialHost` starts the player on an initially discoverable host. Host `status` rows show a `label`, a `value`, and an optional `description` in the session panel. An optional `after` gives the condition and replacement `value`. Use state values that make sense by themselves in the narrow title bar.
3. **Add resources.** Give each resource a unique `id`, an absolute virtual `path`, and a `type` of `directory`, `file`, or `mail`. The root is implicit. Declare each other parent directory. Files and archived mail have a `content` asset path relative to the scenario file. Optional `discover` and `access` guards govern visibility and use, including descendants. A guard can require membership in a list of `roles`, a set `flag`, or both. Mark specific plain-text file lines with one-based `inspectLines` to make their code points interactive. Set `inspectNotation: true` on a plain-text file to make its valid `U+XXXX` references clickable. Optional `onRead` effects can set a `flag`, change the `session` identity, emit a `message`, deliver inbox mail, or add a `resourceLink` to an accessible resource on the host.
4. **Bind a puzzle.** A host can define an `operations` array with distinct built-in commands (`login`, `route`, `reconcile`, `reconstruct`). Each binding supplies `label`, `actionLabel`, `submitLabel`, a `puzzle` path, optional `access` guard, `success` effects, and fallback `failure` text. Use `fields` to bind every program input in command argument order. Each field has an `input`, `label`, and optional `initial` draft or `fixed` value. Fixed fields show compact read-only context and take no command argument. The terminal composer derives its editable parameter labels and initial drafts from these bindings; no per-operation input UI is needed. Single-input bindings can use `input` and `initial` at the binding level. A host can also use a single `operation` or the legacy `login` shorthand. The first failed check per optional `stage` in `rejected` supplies the corresponding diagnostic. Entries without a stage share one priority group. Gate later operations with declared flags and set those flags through earlier success effects.
5. **Set the objective.** Give `objective` its visible `text`, a completion `message`, and one trigger. Use `read` with the ID of a file or archived mail resource, or `action` for a successful `commit` bound on a recovery host. Optional `onComplete` effects can `discover` a later available scenario or `deliverMail` from the scenario’s inbox asset. Campaign completion effects run once per scenario.
6. **Validate and play-test.** Run `npm run validate:content` after building WASM. It checks every registered entry, including unavailable ones, and reports the file and field for invalid content and references. Try both command and click paths in the browser.

Use stable ASCII IDs and safe relative asset paths. Published resources are public static assets, including files that require access in the game. Keep real secrets out of content. The browser save retains campaign progress, inbox state, and each scenario's session, drafts, and recent commands. The transcript is rebuilt from saved commands and their starting state. Changes to game logic or loaded content clear saved command history. Reset session starts the current scenario again. Reset campaign, available from Campaign, clears campaign progress and starts at the first destination. In development, open `/?scenario=<id>` for an isolated direct entry.

An editable puzzle or dataset field can list `inspectors` in presentation order. Valid IDs are `code-points`, `utf-8`, `utf-16`, and `wtf-8`. Single-input shorthand bindings put the list beside `input`. The first entry is the default. Omit the list for fields that need no inspector.

### Output timing

Set `outputTiming` in `scenario.json` to pace selected commands. Each command maps to an array of pauses.

```json
{
  "outputTiming": {
    "connect": [{ "afterRows": 0, "minMs": 160, "maxMs": 320 }],
    "cat": [{ "afterRows": 1, "minMs": 160, "maxMs": 280 }]
  }
}
```

`afterRows: 0` pauses after the command echo and before the first result. `afterRows: 1` pauses between the first and second structured output rows. A whole listing, file, or report counts as one row. Each boundary can appear once and is used only when another row follows. Each wait samples an inclusive range of whole milliseconds from 0 to 2000. The terminal skips simulated waits for players who prefer reduced motion.

### Recovery datasets and commands

For record-set operations, declare `recovery.dataset` and `recovery.source` as paths relative to `content/`. The version-1 dataset defines the incident, snapshot revision, exact registrations and owners, appeals, receipt channels, diagnostic records, audit samples and archived cursors. The source points to the verified original export. Validation compares the incident, registration IDs, exact names and their scalar notation against the dataset. Verified receipt metadata is authored evidence.

Bind operations in the host's `recovery` array. Use the same labels, guards, success effects and staged diagnostics as puzzle bindings. Supply one ordered `fields` entry per argument with `input`, `label`, `initial` and optional `kind`. Use `payload` for fields that need Unicode editing tools. Set `quick` to add a toolbar shortcut. A command remains available through the Command Tag and terminal help while its access guard passes. `invalidates` clears listed flags when the evaluator accepts a request for processing. A success effect can clear an earlier flag with `clearFlag`.

| Commands                                 | Evaluated behavior                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `collate`, `replay`, `recover`           | Locale and strength comparison, cursor replay over the snapshot, verified selection of authentic appeals |
| `casing`, `lookup`, `probe`, `bind`      | Locale-aware label mapping, unambiguous retrieval, routing collision checks and owner associations       |
| `prepare`, `preview`, `verify`, `commit` | Identity mapping, grapheme and bidi audit, dry run and atomic fictional recovery                         |

The Rust/WASM recovery interface accepts typed version-1 requests and returns check results, structured display rows and new evaluation context. The dispatcher applies the scenario effects and saves the handoff when the objective completes. Set `recovery.prior` to the earlier scenario that produced the required handoff. Both scenarios must reference the same dataset, and the predecessor must discover its successor. Completed handoffs and committed records persist with campaign progress. Development direct entry provides isolated evidence for the selected scenario. See the [Unicode profiles and versions](crates/unicodd-core/data/README.md).

### Fictional mail

Archived mail and an optional local inbox use JSON assets with an ordered `messages` array. Each entry has a unique `id`, single-line `from`, `to`, and `subject` fields, an optional `date`, and a `body` string. Players open archived threads with `cat` or by clicking a resource.

Set `inbox.content` to a mail asset and `inbox.initial` to the ordered IDs delivered at scenario start. An `onRead` or login `success` effect with `type: "deliverMail"` and `message` set to an inbox message ID can deliver later mail. Players open the local inbox from the title bar or with `mail` at the local console, and can read a message with `mail <id>`. While connected, the explicit command form is `local mail [id]`. Message IDs must be unique across scenario inboxes. Delivered mail is available from any scenario. Delivery and read status persist across reloads and session resets.

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
| `remove_code_point`                  | Text, integer Unicode scalar                                        | Text         |
| `caseFold`                           | Text                                                                | Text         |
| `skeleton`                           | Text                                                                | Text         |
| `codePointLength`                    | Text                                                                | Integer      |
| `utf16_length`                       | Text, counted as UTF-16 code units                                  | Integer      |
| `utf8_length`                        | Text, counted as UTF-8 bytes                                        | Integer      |
| `textEqual`                          | Text, text                                                          | Boolean      |
| `contains`, `startsWith`, `endsWith` | Text to search, text to find                                        | Boolean      |
| `not`                                | Boolean                                                             | Boolean      |
| `and`, `or`, `booleanEqual`          | Boolean, Boolean                                                    | Boolean      |
| `integerEqual`, `integerLessOrEqual` | Integer, integer                                                    | Boolean      |

Each check has an `id`, a `node` referring to a Boolean result, an `expected` Boolean, and an optional `required` flag that defaults to true. The check passes when actual equals expected. The program is solved when every required check passes, including programs with zero required checks.

### Evaluator API and Unicode behavior

Rust consumers can call `validate_program`, `evaluate`, and `normalize` from `unicodd-core`. The browser uses the typed `Engine` interface. Its WASM bindings accept UTF-8 byte arrays for JSON programs, JSON input objects, and plain text to normalize. The exports return JSON envelopes with `ok` and either `value` or an `error` containing a code, message, and optional path. The TypeScript bridge rejects unpaired surrogates before encoding and reports their zero-based UTF-16 offset. Rust rejects invalid UTF-8 and malformed JSON.

Evaluation returns `solved`, ordered `checks` with their actual and expected Booleans, and, when requested, a topologically ordered `trace`. Each trace record includes its node ID, operator, dependency IDs, and typed result. When the trace reaches its text budget, the response includes the available prefix and `traceTruncated: true`.

Unicode normalization uses the versioned data in the locked `unicode-normalization` crate (Unicode 18.0.0). The full case-folding and UTS #39 revision 28 skeleton operators use Unicode 15.1.0. Query `engine.info()` for the schema, normalization, folding, and skeleton versions. The terminal’s Confusables list is a bounded view of scalar relationships derived from the same data. See the [Unicode data provenance and algorithms](crates/unicodd-core/data/README.md). Text is compared exactly unless a program explicitly normalizes it. The evaluator distinguishes Unicode scalar count, UTF-16 code units, and UTF-8 bytes. The inspector shows the selected scalar’s encodings. The editor shows code-point counts and positions and marks isolated surrogates so they can be repaired. In the terminal, `inspect` accepts a single literal scalar or a code point. A single literal scalar takes precedence over bare hex. Use `U+` to disambiguate a one-digit hex value.

In one-line commands and composer arguments, `\u` or `\U` followed by one to six hexadecimal digits is read greedily. For example, `\U1F9EA` denotes 🧪. Use six digits when a following literal character is also hexadecimal. `\\` represents a backslash and `\"` represents a double quote. The spelling stays visible while editing, while inspectors and the command echo show the rendered text. The JSON editor keeps its source escapes literal for the strict JSON parser. UTF-8 inspection requires well-formed UTF-16. The WTF-8 inspector can show isolated surrogates for diagnosis. [WTF-8 specification](https://wtf-8.codeberg.page/)

Limits include 32 input declarations, 256 nodes, 128 checks, 32 KiB of UTF-8 per input and 256 KiB total, 128 KiB per text value, 2 MiB combined intermediate text, and 512 KiB of trace text. WASM request limits are 13 MiB for serialized programs and 2 MiB for serialized input objects.
