import { computed, ref, watch, type Ref } from 'vue';
import { scalarIndexAtUtf16Offset, stringToUnicodeScalars } from '../unicode';

export interface UnicodeEditorState {
  text: Ref<string>;
  selectedScalarIndex: Ref<number | null>;
  scalars: Readonly<Ref<Uint32Array>>;
  validationError: Readonly<Ref<string | null>>;
  selectedScalar: Readonly<Ref<number | null>>;
  inspectAtUtf16Offset: (offset: number) => void;
}

export function useUnicodeEditor(initialText: string): UnicodeEditorState {
  const text = ref(initialText);
  const selectedScalarIndex = ref<number | null>(0);

  const scalarResult = computed(() => {
    try {
      return { scalars: stringToUnicodeScalars(text.value), error: null };
    } catch (error) {
      return {
        scalars: new Uint32Array(),
        error: error instanceof Error ? error.message : 'Invalid Unicode input.',
      };
    }
  });

  const scalars = computed(() => scalarResult.value.scalars);
  const validationError = computed(() => scalarResult.value.error);
  const selectedScalar = computed(() => {
    const index = selectedScalarIndex.value;
    return index === null ? null : (scalars.value[index] ?? null);
  });

  function inspectAtUtf16Offset(offset: number): void {
    selectedScalarIndex.value = scalarIndexAtUtf16Offset(text.value, offset);
  }

  watch(scalars, (nextScalars) => {
    if (nextScalars.length === 0) {
      selectedScalarIndex.value = null;
    } else if (
      selectedScalarIndex.value === null ||
      selectedScalarIndex.value >= nextScalars.length
    ) {
      selectedScalarIndex.value = 0;
    }
  });

  return {
    text,
    selectedScalarIndex,
    scalars,
    validationError,
    selectedScalar,
    inspectAtUtf16Offset,
  };
}
