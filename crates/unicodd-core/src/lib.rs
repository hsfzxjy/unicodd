mod evaluator;
pub mod international;
pub mod recovery;
mod schema;
mod security;
mod unicode;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use evaluator::{evaluate, validate_program};
pub use schema::*;
pub use security::{case_fold, scalar_details, skeleton, SECURITY_UNICODE_VERSION, UTS39_REVISION};
pub use unicode::{normalize, unicode_version, MAX_TEXT_BYTES};
