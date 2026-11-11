# Unicode security data

The build reads the official Unicode 15.1.0 data below and writes sorted Rust tables to Cargo's output directory. It never fetches data during a build. Retain the upstream bytes when refreshing these files. Run the native and WASM tests before shipping any version change.

| Vendored file               | Unicode source                                                                    | SHA-256                                                            |
| --------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `confusables.txt`           | [UTS #39 15.1.0](https://www.unicode.org/Public/security/15.1.0/confusables.txt)  | `8289f833e4cf78fde56b2080dc0e42934ef5182c9c3f4dd1fbdf2bced69fd5ed` |
| `CaseFolding.txt`           | [UCD 15.1.0](https://www.unicode.org/Public/15.1.0/ucd/CaseFolding.txt)           | `4e55acfdc32825a22e87670e9056a3bf94ad7c5400065778e9e10f8314372bcf` |
| `DerivedCoreProperties.txt` | [UCD 15.1.0](https://www.unicode.org/Public/15.1.0/ucd/DerivedCoreProperties.txt) | `f55d0db69123431a7317868725b1fcbf1eab6b265d756d1bd7f0f6d9f9ee108b` |
| `Scripts.txt`               | [UCD 15.1.0](https://www.unicode.org/Public/15.1.0/ucd/Scripts.txt)               | `0eacb65169ae6eb1d399cd70826b3da15fff19f6f586eecf819b70c83b1d9b32` |

## Algorithms

- `caseFold` uses the default full mapping from `CaseFolding.txt`. It uses the C and F rows and leaves unmapped code points unchanged. This operation is locale independent and preserves the mapped sequence without normalizing it.
- `skeleton` implements the logical-order definition in [UTS #39 revision 28, section 4](https://www.unicode.org/reports/tr39/tr39-28.html#Confusable_Detection). It applies NFD, drops scalars with `Default_Ignorable_Code_Point`, applies the MA prototypes once, and reapplies NFD. That revision defines the directional `bidiSkeleton` separately. Directional skeletons are outside the evaluator's operator set.
- The skeleton's NFD passes use `icu_normalizer` 1.5.0 with the locked 1.5.1 compiled data from ICU 75. The general-purpose normalization operation keeps its separately versioned `unicode-normalization` data.
- Inspection uses `unicode_names2` 1.2.2 for Unicode 15.1 character names and `Scripts.txt` for the primary Script property. Candidates are a bounded view of related scalar mappings with equal skeletons. The general category labels use the browser's Unicode property data.

Unicode data terms and the character-name data notice ship with the built game. [Unicode license notices](../../../public/UNICODE-LICENSE.txt)

## Internationalization data

| Capability                   | Locked implementation                        | Data                                                                                                                                              |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Collation and sort keys      | `icu_collator` and `icu_collator_data` 2.1.1 | Unicode 17.0, CLDR 48.0.0 and ICU `release-78.1rc`. The dependency's locale fallback data is `icu_locale_data` 2.1.2, generated from CLDR 48.1.0. |
| Full-string lowercase        | `icu_casemap` and `icu_casemap_data` 2.1.1   | Unicode 17.0, CLDR 48.0.0 and ICU `release-78.1rc`.                                                                                               |
| Extended grapheme boundaries | `unicode-segmentation` 1.12.0                | Unicode 16.0.0, UAX #29 revision 45                                                                                                               |
| Bidirectional analysis       | `unicode-bidi` 0.3.18                        | Unicode 16.0.0, UAX #9 revision 50                                                                                                                |
| General normalization        | `unicode-normalization` 0.1.26               | Unicode 18.0.0                                                                                                                                    |

The recovery API exposes `en-US` and `sv-SE` with primary, secondary and tertiary collation. Queue cursors bind the locale, strength, key strategy, page size, dataset revision and collation profile to a record boundary. Change the profile ID when upgrading data or sort options. ICU4X generates the keys and compares titles. Full-string lowercase uses ICU4X's root, Turkish, Azeri and Lithuanian behavior. Default case folding continues to use the separate Unicode 15.1.0 operation.

Audit boundaries are UTF-8 byte offsets into the original string. The preview checks whether a candidate cut lands on one of those boundaries, measures the final serialized UTF-8 line, and uses UAX #9 resolved levels to test the ordering of fixed anchors around a dynamic field. The DOM keeps fields in separate `bdi` elements. Copy uses a serialized line with balanced FSI/PDI and visible escapes for formatting controls. Original fields remain exact.

The size-optimized WASM build uses the upstream ICU4X compiled tables. Game commands expose the supported locales above, and the artifact includes the linked ICU4X tailoring tables. Builds require no separate locale downloads. See the [collation data](https://docs.rs/icu_collator_data/2.1.1/src/icu_collator_data/lib.rs.html), [case mapping data](https://docs.rs/icu_casemap_data/2.1.1/src/icu_casemap_data/lib.rs.html), and [ICU 78 Unicode release notes](https://unicode-org.github.io/icu/download/78.html).
