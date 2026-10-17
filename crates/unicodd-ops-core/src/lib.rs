//! Unicode operations exposed through unicodd's raw C-compatible WebAssembly ABI.

use icu_normalizer::{ComposingNormalizerBorrowed, DecomposingNormalizerBorrowed};
use std::alloc::{Layout, alloc_zeroed, dealloc};
use std::ptr;
use std::slice;

pub const ABI_VERSION: u32 = 1;

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
}

#[derive(Debug, Eq, PartialEq)]
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

/// Allocates a zeroed byte buffer with at least four-byte alignment.
///
/// The caller must release a non-null result with `unicodd_dealloc`, passing the same byte length.
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
/// `buffer` and `byte_len` must exactly match a live allocation returned by `unicodd_alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn unicodd_dealloc(buffer: *mut u8, byte_len: u32) {
    if buffer.is_null() || byte_len == 0 {
        return;
    }

    let Ok(layout) = Layout::from_size_align(byte_len as usize, align_of::<u32>()) else {
        return;
    };

    // SAFETY: The ABI contract requires `buffer` and `byte_len` to match an allocation returned by
    // `unicodd_alloc` that has not already been released.
    unsafe { dealloc(buffer, layout) };
}

/// Normalizes a Unicode scalar sequence into another scalar sequence.
///
/// The returned `u64` packs a status code in the high 32 bits and a detail value in the low 32
/// bits. On success the detail is the number of written scalars. For insufficient capacity it is
/// the required scalar capacity. For an invalid scalar it is the scalar offset.
///
/// Passing a null output pointer with zero capacity performs a capacity query without writing.
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

    if let Err(status) = validate_scalar_range(input_ptr, input_len) {
        return AbiResult::error(status, 0);
    }
    if let Err(status) = validate_scalar_range(output_ptr.cast_const(), output_capacity) {
        return AbiResult::error(status, 0);
    }

    let input = if input_len == 0 {
        &[]
    } else {
        // SAFETY: The complete range and alignment were checked above. The ABI contract requires
        // the caller to keep this allocation alive for the duration of the call.
        unsafe { slice::from_raw_parts(input_ptr, input_len as usize) }
    };

    let mut text = String::with_capacity(input.len());
    for (index, scalar) in input.iter().copied().enumerate() {
        let Some(character) = char::from_u32(scalar) else {
            return AbiResult::error(AbiStatus::InvalidScalar, index as u32);
        };
        text.push(character);
    }

    let normalized = match form {
        NormalizationForm::Nfc => ComposingNormalizerBorrowed::new_nfc().normalize(&text),
        NormalizationForm::Nfd => DecomposingNormalizerBorrowed::new_nfd().normalize(&text),
        NormalizationForm::Nfkc => ComposingNormalizerBorrowed::new_nfkc().normalize(&text),
        NormalizationForm::Nfkd => DecomposingNormalizerBorrowed::new_nfkd().normalize(&text),
    };
    let normalized_len = normalized.chars().count();
    let Ok(normalized_len) = u32::try_from(normalized_len) else {
        return AbiResult::error(AbiStatus::LengthOverflow, 0);
    };

    if output_capacity < normalized_len {
        return AbiResult::error(AbiStatus::InsufficientCapacity, normalized_len);
    }
    if normalized_len == 0 {
        return AbiResult::success(0);
    }

    let output = {
        // SAFETY: The complete range and alignment were checked above, and the capacity is known
        // to be large enough. Input was fully copied into `text` before output is written, so
        // overlapping buffers do not invalidate reads.
        unsafe { slice::from_raw_parts_mut(output_ptr, normalized_len as usize) }
    };
    for (destination, character) in output.iter_mut().zip(normalized.chars()) {
        *destination = character as u32;
    }

    AbiResult::success(normalized_len)
}

fn validate_scalar_range(pointer: *const u32, length: u32) -> Result<(), AbiStatus> {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn unpack(value: u64) -> (u32, u32) {
        ((value >> 32) as u32, value as u32)
    }

    fn call_normalize(form: NormalizationForm, input: &[u32]) -> Vec<u32> {
        let query = unicodd_normalize(
            form as u32,
            input.as_ptr(),
            input.len() as u32,
            ptr::null_mut(),
            0,
        );
        let (status, required) = unpack(query);
        assert!(status == AbiStatus::InsufficientCapacity as u32 || required == 0);

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
    fn reports_the_abi_version() {
        assert_eq!(unicodd_abi_version(), ABI_VERSION);
    }

    #[test]
    fn normalizes_all_four_standard_forms() {
        let decomposed_e_acute = [0x65, 0x301];
        assert_eq!(
            call_normalize(NormalizationForm::Nfc, &decomposed_e_acute),
            vec![0xe9]
        );
        assert_eq!(
            call_normalize(NormalizationForm::Nfd, &[0xe9]),
            decomposed_e_acute
        );
        assert_eq!(
            call_normalize(NormalizationForm::Nfkc, &[0x2460]),
            vec![0x31]
        );
        assert_eq!(
            call_normalize(NormalizationForm::Nfkd, &[0x2460]),
            vec![0x31]
        );
    }

    #[test]
    fn reports_required_capacity_without_writing() {
        let input = [0xe9];
        let packed = unicodd_normalize(
            NormalizationForm::Nfd as u32,
            input.as_ptr(),
            1,
            ptr::null_mut(),
            0,
        );
        assert_eq!(unpack(packed), (AbiStatus::InsufficientCapacity as u32, 2));
    }

    #[test]
    fn rejects_invalid_operations_scalars_and_alignment() {
        let input = [0xd800];
        let invalid_operation = unicodd_normalize(99, input.as_ptr(), 1, ptr::null_mut(), 0);
        assert_eq!(
            unpack(invalid_operation),
            (AbiStatus::InvalidOperation as u32, 99)
        );

        let invalid_scalar = unicodd_normalize(
            NormalizationForm::Nfc as u32,
            input.as_ptr(),
            1,
            ptr::null_mut(),
            0,
        );
        assert_eq!(unpack(invalid_scalar), (AbiStatus::InvalidScalar as u32, 0));

        let misaligned = ptr::dangling::<u8>().cast::<u32>();
        let invalid_pointer = unicodd_normalize(
            NormalizationForm::Nfc as u32,
            misaligned,
            1,
            ptr::null_mut(),
            0,
        );
        assert_eq!(
            unpack(invalid_pointer),
            (AbiStatus::MisalignedPointer as u32, 0)
        );
    }

    #[test]
    fn accepts_empty_input_with_null_pointers() {
        let result = unicodd_normalize(
            NormalizationForm::Nfc as u32,
            ptr::null(),
            0,
            ptr::null_mut(),
            0,
        );
        assert_eq!(unpack(result), (AbiStatus::Success as u32, 0));
    }
}
