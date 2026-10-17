# Third-party data provenance

## Unicode normalization conformance data

- File: `tests/data/NormalizationTest-17.0.0.txt`
- Source: <https://www.unicode.org/Public/17.0.0/ucd/NormalizationTest.txt>
- Version: Unicode 17.0.0
- Retrieved: 2026-10-17
- Terms: <https://www.unicode.org/terms_of_use.html>

The file is retained verbatim and is used only to verify the normalization engine.

## Unicode grapheme-break conformance data

- File: `tests/data/GraphemeBreakTest-17.0.0.txt`
- Source: <https://www.unicode.org/Public/17.0.0/ucd/auxiliary/GraphemeBreakTest.txt>
- Version: Unicode 17.0.0
- Retrieved: 2026-10-17
- Terms: <https://www.unicode.org/terms_of_use.html>

The file is retained verbatim and is used only to verify the grapheme segmenter.

## Unicode character discovery data

The following Unicode 17.0.0 source files are retained verbatim under
`tools/unicode-data/17.0.0/` and processed locally by `tools/unicode-indexer`:

| File              | Source                                                           | SHA-256                                                            |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `UnicodeData.txt` | <https://www.unicode.org/Public/17.0.0/ucd/UnicodeData.txt>      | `2E1EFC1DCB59C575EEDF5CCAE60F95229F706EE6D031835247D843C11D96470C` |
| `Scripts.txt`     | <https://www.unicode.org/Public/17.0.0/ucd/Scripts.txt>          | `9F5E50D3ABAEE7D6CE09480F325C706F485AE3240912527E651954D2D6B035BF` |
| `DerivedAge.txt`  | <https://www.unicode.org/Public/17.0.0/ucd/DerivedAge.txt>       | `F8ECDF768BDC210F201ABD271D9BC587825618A86A7046A8146CC816393F1998` |
| `CaseFolding.txt` | <https://www.unicode.org/Public/17.0.0/ucd/CaseFolding.txt>      | `FF8D8FEFBF123574205085D6714C36149EB946D717A0C585C27F0F4EF58C4183` |
| `confusables.txt` | <https://www.unicode.org/Public/17.0.0/security/confusables.txt> | `091C7F82FC39EF208FAF8F94D29C244DE99254675E09DE163160C810D13EF22A` |

- Version: Unicode and UTS #39 17.0.0.
- Retrieved: 2026-10-17.
- Terms: <https://www.unicode.org/terms_of_use.html>.

`CaseFolding.txt` also verifies the default full case-fold operation exposed by the WASM engine.
The generated JSON files are build artifacts and are not tracked. Character names in the generated
search index come from the pinned `unicode_names2` 4.0.0 dependency, including algorithmic names.
