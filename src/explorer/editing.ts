import { unicodeScalarsToString } from '../unicode';
import type { EditorAction, TextEditResult, TextSelection } from './types';

export function applyEditorAction(
  text: string,
  selection: TextSelection,
  scalars: Uint32Array,
  action: EditorAction,
): TextEditResult {
  const insertion = unicodeScalarsToString(scalars);
  const selectionStart = Math.min(
    Math.max(Math.min(selection.start, selection.end), 0),
    text.length,
  );
  const selectionEnd = Math.min(Math.max(Math.max(selection.start, selection.end), 0), text.length);

  let start: number;
  let end: number;
  switch (action) {
    case 'insert':
      start = selectionEnd;
      end = selectionEnd;
      break;
    case 'replace':
      start = selectionStart;
      end = selectionEnd;
      break;
    case 'append':
      start = text.length;
      end = text.length;
      break;
  }

  const nextText = `${text.slice(0, start)}${insertion}${text.slice(end)}`;
  const caret = start + insertion.length;
  return { text: nextText, selection: { start: caret, end: caret } };
}
