import { computed, ref, watch, type Ref } from 'vue';
import { applyEditorAction } from '../explorer/editing';
import type { EditorAction, TextSelection } from '../explorer/types';
import { stringToUnicodeScalars } from '../unicode';

export interface UnicodeEditorState {
  text: Ref<string>;
  scalars: Readonly<Ref<Uint32Array>>;
  validationError: Readonly<Ref<string | null>>;
  selection: Ref<TextSelection>;
  selectionRevision: Ref<number>;
  updateSelection: (selection: TextSelection) => void;
  selectRange: (selection: TextSelection) => void;
  applyScalars: (scalars: Uint32Array, action: EditorAction) => void;
}

export function useUnicodeEditor(initialText: string): UnicodeEditorState {
  const text = ref(initialText);
  const selection = ref<TextSelection>({ start: 0, end: 0 });
  const selectionRevision = ref(0);

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

  function updateSelection(nextSelection: TextSelection): void {
    selection.value = clampSelection(nextSelection, text.value.length);
  }

  function selectRange(nextSelection: TextSelection): void {
    updateSelection(nextSelection);
    selectionRevision.value += 1;
  }

  function applyScalars(insertedScalars: Uint32Array, action: EditorAction): void {
    const result = applyEditorAction(text.value, selection.value, insertedScalars, action);
    text.value = result.text;
    selectRange(result.selection);
  }

  watch(text, (nextText) => {
    selection.value = clampSelection(selection.value, nextText.length);
  });

  return {
    text,
    scalars,
    validationError,
    selection,
    selectionRevision,
    updateSelection,
    selectRange,
    applyScalars,
  };
}

function clampSelection(selection: TextSelection, textLength: number): TextSelection {
  return {
    start: Math.min(Math.max(selection.start, 0), textLength),
    end: Math.min(Math.max(selection.end, 0), textLength),
  };
}
