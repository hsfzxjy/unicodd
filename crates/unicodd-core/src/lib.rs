mod evaluator;
mod schema;
mod unicode;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use evaluator::{evaluate, validate_program};
pub use schema::*;
pub use unicode::{normalize, unicode_version, MAX_TEXT_BYTES};
