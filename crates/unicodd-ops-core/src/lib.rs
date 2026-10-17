//! Unicode operations exposed through unicodd's raw C-compatible WebAssembly ABI.

use icu_casemap::CaseMapper;
use icu_normalizer::{ComposingNormalizerBorrowed, DecomposingNormalizerBorrowed};
use icu_segmenter::GraphemeClusterSegmenter;
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

/// Applies the default full Unicode case-fold mapping to a scalar sequence.
///
/// Turkic-special mappings are not enabled. Result packing and capacity queries match
/// `unicodd_normalize`.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_case_fold(
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> u64 {
    case_fold_abi(input_ptr, input_len, output_ptr, output_capacity).packed()
}

/// Finds extended grapheme-cluster boundaries in a Unicode scalar sequence.
///
/// The output contains scalar offsets, including zero and the input length. Empty input produces
/// the single boundary `[0]`. Result packing and capacity queries match `unicodd_normalize`.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_grapheme_boundaries(
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> u64 {
    grapheme_boundaries_abi(input_ptr, input_len, output_ptr, output_capacity).packed()
}

/// Looks up the Unicode 17 character name for one scalar and writes it as ASCII bytes.
///
/// A scalar without an assigned Name property returns `MissingData`. Result packing and capacity
/// queries match `unicodd_normalize`, with lengths measured in bytes.
#[unsafe(no_mangle)]
pub extern "C" fn unicodd_name(scalar: u32, output_ptr: *mut u8, output_capacity: u32) -> u64 {
    name_abi(scalar, output_ptr, output_capacity).packed()
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
        NormalizationForm::Nfc => ComposingNormalizerBorrowed::new_nfc().normalize(&text),
        NormalizationForm::Nfd => DecomposingNormalizerBorrowed::new_nfd().normalize(&text),
        NormalizationForm::Nfkc => ComposingNormalizerBorrowed::new_nfkc().normalize(&text),
        NormalizationForm::Nfkd => DecomposingNormalizerBorrowed::new_nfkd().normalize(&text),
    };
    let scalars: Vec<u32> = normalized.chars().map(u32::from).collect();
    write_u32_output(&scalars, output_ptr, output_capacity)
}

fn case_fold_abi(
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> AbiResult {
    let text = match read_scalar_string(input_ptr, input_len) {
        Ok(text) => text,
        Err(result) => return result,
    };
    let folded = CaseMapper::new().fold_string(&text);
    let scalars: Vec<u32> = folded.chars().map(u32::from).collect();
    write_u32_output(&scalars, output_ptr, output_capacity)
}

fn validate_scalar_range(pointer: *const u32, length: u32) -> Result<(), AbiStatus> {
    validate_range(
        pointer.cast::<u8>(),
        length,
        size_of::<u32>(),
        align_of::<u32>(),
    )
}

fn validate_byte_range(pointer: *const u8, length: u32) -> Result<(), AbiStatus> {
    validate_range(pointer, length, size_of::<u8>(), align_of::<u8>())
}

fn validate_range(
    pointer: *const u8,
    length: u32,
    item_size: usize,
    alignment: usize,
) -> Result<(), AbiStatus> {
    if length == 0 {
        return Ok(());
    }
    if pointer.is_null() {
        return Err(AbiStatus::InvalidPointer);
    }

    let address = pointer as usize;
    if !address.is_multiple_of(alignment) {
        return Err(AbiStatus::MisalignedPointer);
    }
    let Some(byte_len) = (length as usize).checked_mul(item_size) else {
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

fn read_scalar_string(input_ptr: *const u32, input_len: u32) -> Result<String, AbiResult> {
    if let Err(status) = validate_scalar_range(input_ptr, input_len) {
        return Err(AbiResult::error(status, 0));
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
            return Err(AbiResult::error(AbiStatus::InvalidScalar, index as u32));
        };
        text.push(character);
    }
    Ok(text)
}

fn write_u32_output(values: &[u32], output_ptr: *mut u32, output_capacity: u32) -> AbiResult {
    if let Err(status) = validate_scalar_range(output_ptr.cast_const(), output_capacity) {
        return AbiResult::error(status, 0);
    }
    let Ok(required) = u32::try_from(values.len()) else {
        return AbiResult::error(AbiStatus::LengthOverflow, 0);
    };
    if output_capacity < required {
        return AbiResult::error(AbiStatus::InsufficientCapacity, required);
    }
    if required == 0 {
        return AbiResult::success(0);
    }

    // SAFETY: The complete range and alignment were checked above, and capacity is sufficient.
    let output = unsafe { slice::from_raw_parts_mut(output_ptr, values.len()) };
    output.copy_from_slice(values);
    AbiResult::success(required)
}

fn write_byte_output(values: &[u8], output_ptr: *mut u8, output_capacity: u32) -> AbiResult {
    if let Err(status) = validate_byte_range(output_ptr.cast_const(), output_capacity) {
        return AbiResult::error(status, 0);
    }
    let Ok(required) = u32::try_from(values.len()) else {
        return AbiResult::error(AbiStatus::LengthOverflow, 0);
    };
    if output_capacity < required {
        return AbiResult::error(AbiStatus::InsufficientCapacity, required);
    }
    if required == 0 {
        return AbiResult::success(0);
    }

    // SAFETY: The complete range was checked above, and capacity is sufficient.
    let output = unsafe { slice::from_raw_parts_mut(output_ptr, values.len()) };
    output.copy_from_slice(values);
    AbiResult::success(required)
}

fn grapheme_boundaries_abi(
    input_ptr: *const u32,
    input_len: u32,
    output_ptr: *mut u32,
    output_capacity: u32,
) -> AbiResult {
    let text = match read_scalar_string(input_ptr, input_len) {
        Ok(text) => text,
        Err(result) => return result,
    };

    let mut scalar_offset = 0u32;
    let mut characters = text.char_indices().peekable();
    let boundaries: Vec<u32> = GraphemeClusterSegmenter::new()
        .segment_str(&text)
        .map(|byte_boundary| {
            while characters
                .next_if(|(byte_offset, _)| *byte_offset < byte_boundary)
                .is_some()
            {
                scalar_offset += 1;
            }
            scalar_offset
        })
        .collect();

    write_u32_output(&boundaries, output_ptr, output_capacity)
}

fn name_abi(scalar: u32, output_ptr: *mut u8, output_capacity: u32) -> AbiResult {
    let Some(character) = char::from_u32(scalar) else {
        return AbiResult::error(AbiStatus::InvalidScalar, 0);
    };
    let Some(name) = unicode_names2::name(character) else {
        return AbiResult::error(AbiStatus::MissingData, 0);
    };
    write_byte_output(name.to_string().as_bytes(), output_ptr, output_capacity)
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

    fn call_boundaries(input: &[u32]) -> Vec<u32> {
        let query =
            unicodd_grapheme_boundaries(input.as_ptr(), input.len() as u32, ptr::null_mut(), 0);
        let (_, required) = unpack(query);
        let mut output = vec![0; required as usize];
        let result = unicodd_grapheme_boundaries(
            input.as_ptr(),
            input.len() as u32,
            output.as_mut_ptr(),
            required,
        );
        assert_eq!(unpack(result), (AbiStatus::Success as u32, required));
        output
    }

    fn call_case_fold(input: &[u32]) -> Vec<u32> {
        let query = unicodd_case_fold(input.as_ptr(), input.len() as u32, ptr::null_mut(), 0);
        let (_, required) = unpack(query);
        let mut output = vec![0; required as usize];
        let result = unicodd_case_fold(
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
    fn applies_full_default_case_folding() {
        let input: Vec<u32> = "Straße Σς".chars().map(u32::from).collect();
        let expected: Vec<u32> = "strasse σσ".chars().map(u32::from).collect();
        assert_eq!(call_case_fold(&input), expected);
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

    #[test]
    fn segments_combining_emoji_regional_and_invisible_sequences() {
        assert_eq!(call_boundaries(&[]), vec![0]);
        assert_eq!(call_boundaries(&[0x65, 0x301, 0x1f9e9]), vec![0, 2, 3]);
        assert_eq!(
            call_boundaries(&[0x1f469, 0x200d, 0x1f4bb, 0x1f1fa, 0x1f1f8, 0x200b]),
            vec![0, 3, 5, 6]
        );
    }

    #[test]
    fn returns_unicode_names_and_reports_missing_names() {
        let query = unicodd_name(0x1f9e9, ptr::null_mut(), 0);
        let (_, required) = unpack(query);
        let mut output = vec![0; required as usize];
        let result = unicodd_name(0x1f9e9, output.as_mut_ptr(), required);
        assert_eq!(unpack(result), (AbiStatus::Success as u32, required));
        assert_eq!(String::from_utf8(output).unwrap(), "JIGSAW PUZZLE PIECE");

        assert_eq!(
            unpack(unicodd_name(0x200b, ptr::null_mut(), 0)),
            (AbiStatus::InsufficientCapacity as u32, 16)
        );
        assert_eq!(
            unpack(unicodd_name(0x378, ptr::null_mut(), 0)),
            (AbiStatus::MissingData as u32, 0)
        );
    }
}
