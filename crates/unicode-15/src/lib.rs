//! Unicode 15.1 normalization behind unicodd's stable raw WebAssembly ABI.

use icu_normalizer::{ComposingNormalizer, DecomposingNormalizer};
use std::alloc::{Layout, alloc_zeroed, dealloc};
use std::ptr;
use std::slice;

pub const ABI_VERSION: u32 = 3;

#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NormalizationForm {
    Nfc = 1,
    Nfd = 2,
    Nfkc = 3,
    Nfkd = 4,
}

impl TryFrom<u32> for NormalizationForm {
    type Error = (AbiStatus, u32);

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Nfc),
            2 => Ok(Self::Nfd),
            3 => Ok(Self::Nfkc),
            4 => Ok(Self::Nfkd),
            _ => Err((AbiStatus::InvalidOperation, value)),
        }
    }
}

#[repr(u32)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AbiStatus {
    Success = 0,
    InsufficientCapacity = 1,
    InvalidOperation = 2,
    InvalidScalar = 3,
    InvalidPointer = 4,
    MisalignedPointer = 5,
    LengthOverflow = 6,
    AllocationFailed = 7,
    InternalError = 8,
    MissingData = 9,
}

struct AbiResult {
    status: AbiStatus,
    detail: u32,
}

impl AbiResult {
    const fn success(length: u32) -> Self {
        Self {
            status: AbiStatus::Success,
            detail: length,
        }
    }

    const fn error(status: AbiStatus, detail: u32) -> Self {
        Self { status, detail }
    }

    const fn packed(self) -> u64 {
        ((self.status as u64) << 32) | self.detail as u64
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn unicodd_abi_version() -> u32 {
    ABI_VERSION
}

#[unsafe(no_mangle)]
pub extern "C" fn unicodd_alloc(byte_len: u32) -> *mut u8 {
    if byte_len == 0 {
        return ptr::null_mut();
    }
    let Ok(layout) = Layout::from_size_align(byte_len as usize, align_of::<u32>()) else {
        return ptr::null_mut();
    };

    // SAFETY: `layout` has a non-zero size and valid power-of-two alignment.
    unsafe { alloc_zeroed(layout) }
}

/// Releases a buffer allocated by `unicodd_alloc`.
///
/// # Safety
///
/// `buffer` and `byte_len` must match a live allocation returned by `unicodd_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unicodd_dealloc(buffer: *mut u8, byte_len: u32) {
    if buffer.is_null() || byte_len == 0 {
        return;
    }
    let Ok(layout) = Layout::from_size_align(byte_len as usize, align_of::<u32>()) else {
        return;
    };

    // SAFETY: The raw ABI makes the matching-allocation requirement explicit to callers.
    unsafe { dealloc(buffer, layout) };
}

#[unsafe(no_mangle)]
pub extern "C" fn unicodd_normalize(
    form: u32,
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> u64 {
    normalize_abi(form, input_ptr, input_len, output_ptr, output_capacity).packed()
}

/// Reports an unsupported operation while retaining ABI-compatible exports.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_case_fold(
    _input_ptr: *const u32,
    _input_len: u32,
    _output_ptr: *mut u32,
    _output_capacity: u32,
) -> u64 {
    AbiResult::error(AbiStatus::InvalidOperation, 0).packed()
}

/// Reports an unsupported operation while retaining ABI-compatible exports.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_grapheme_boundaries(
    _input_ptr: *const u32,
    _input_len: u32,
    _output_ptr: *mut u32,
    _output_capacity: u32,
) -> u64 {
    AbiResult::error(AbiStatus::InvalidOperation, 0).packed()
}

/// Reports an unsupported operation while retaining ABI-compatible exports.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_name(_scalar: u32, _output_ptr: *mut u8, _output_capacity: u32) -> u64 {
    AbiResult::error(AbiStatus::InvalidOperation, 0).packed()
}

fn normalize_abi(
    form: u32,
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> AbiResult {
    let Ok(form) = NormalizationForm::try_from(form) else {
        return AbiResult::error(AbiStatus::InvalidOperation, form);
    };
    let text = match read_scalar_string(input_ptr, input_len) {
        Ok(text) => text,
        Err(result) => return result,
    };
    let normalized = match form {
        NormalizationForm::Nfc => ComposingNormalizer::new_nfc().normalize(&text),
        NormalizationForm::Nfd => DecomposingNormalizer::new_nfd().normalize(&text),
        NormalizationForm::Nfkc => ComposingNormalizer::new_nfkc().normalize(&text),
        NormalizationForm::Nfkd => DecomposingNormalizer::new_nfkd().normalize(&text),
    };
    let scalars: Vec<u32> = normalized.chars().map(u32::from).collect();
    write_output(&scalars, output_ptr, output_capacity)
}

fn read_scalar_string(input_ptr: *const u32, input_len: u32) -> Result<String, AbiResult> {
    if let Err(status) = validate_range(input_ptr, input_len) {
        return Err(AbiResult::error(status, 0));
    }
    let input = if input_len == 0 {
        &[]
    } else {
        // SAFETY: The full range and alignment are checked above.
        unsafe { slice::from_raw_parts(input_ptr, input_len as usize) }
    };
    let mut text = String::with_capacity(input.len());
    for (index, scalar) in input.iter().copied().enumerate() {
        let Some(character) = char::from_u32(scalar) else {
            return Err(AbiResult::error(AbiStatus::InvalidScalar, index as u32));
        };
        text.push(character);
    }
    Ok(text)
}

fn validate_range(pointer: *const u32, length: u32) -> Result<(), AbiStatus> {
    if length == 0 {
        return Ok(());
    }
    if pointer.is_null() {
        return Err(AbiStatus::InvalidPointer);
    }
    let address = pointer as usize;
    if !address.is_multiple_of(align_of::<u32>()) {
        return Err(AbiStatus::MisalignedPointer);
    }
    let Some(byte_len) = (length as usize).checked_mul(size_of::<u32>()) else {
        return Err(AbiStatus::LengthOverflow);
    };
    let Some(end) = address.checked_add(byte_len) else {
        return Err(AbiStatus::LengthOverflow);
    };

    #[cfg(target_arch = "wasm32")]
    {
        const WASM_PAGE_SIZE: usize = 65_536;
        let Some(memory_len) = core::arch::wasm32::memory_size(0).checked_mul(WASM_PAGE_SIZE)
        else {
            return Err(AbiStatus::LengthOverflow);
        };
        if end > memory_len {
            return Err(AbiStatus::InvalidPointer);
        }
    }

    #[cfg(not(target_arch = "wasm32"))]
    let _ = end;

    Ok(())
}

fn write_output(values: &[u32], output_ptr: *mut u32, capacity: u32) -> AbiResult {
    if let Err(status) = validate_range(output_ptr.cast_const(), capacity) {
        return AbiResult::error(status, 0);
    }
    let Ok(required) = u32::try_from(values.len()) else {
        return AbiResult::error(AbiStatus::LengthOverflow, 0);
    };
    if capacity < required {
        return AbiResult::error(AbiStatus::InsufficientCapacity, required);
    }
    if required == 0 {
        return AbiResult::success(0);
    }

    // SAFETY: The complete range and alignment were checked, and capacity is sufficient.
    let output = unsafe { slice::from_raw_parts_mut(output_ptr, values.len()) };
    output.copy_from_slice(values);
    AbiResult::success(required)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unpack(value: u64) -> (u32, u32) {
        ((value >> 32) as u32, value as u32)
    }

    fn normalize(form: NormalizationForm, input: &[u32]) -> Vec<u32> {
        let query = unicodd_normalize(
            form as u32,
            input.as_ptr(),
            input.len() as u32,
            ptr::null_mut(),
            0,
        );
        let (_, required) = unpack(query);
        let mut output = vec![0; required as usize];
        let result = unicodd_normalize(
            form as u32,
            input.as_ptr(),
            input.len() as u32,
            output.as_mut_ptr(),
            required,
        );
        assert_eq!(unpack(result), (AbiStatus::Success as u32, required));
        output
    }

    #[test]
    fn implements_the_shared_normalization_abi() {
        assert_eq!(unicodd_abi_version(), ABI_VERSION);
        assert_eq!(
            normalize(NormalizationForm::Nfc, &[0x65, 0x301]),
            vec![0xe9]
        );
        assert_eq!(normalize(NormalizationForm::Nfkd, &[0x2460]), vec![0x31]);
    }

    #[test]
    fn leaves_post_unicode_15_compatibility_characters_unchanged() {
        assert_eq!(normalize(NormalizationForm::Nfkc, &[0xa7f1]), vec![0xa7f1]);
    }
}
