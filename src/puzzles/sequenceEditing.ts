export function moveSequenceValue(
  values: readonly number[],
  sourceIndex: number,
  targetIndex: number,
): number[] {
  if (
    sourceIndex < 0 ||
    sourceIndex >= values.length ||
    targetIndex < 0 ||
    targetIndex >= values.length ||
    sourceIndex === targetIndex
  ) {
    return [...values];
  }

  const result = [...values];
  const [moved] = result.splice(sourceIndex, 1);
  if (moved !== undefined) result.splice(targetIndex, 0, moved);
  return result;
}

export function removeSequenceValue(values: readonly number[], index: number): number[] {
  if (index < 0 || index >= values.length) return [...values];
  return values.filter((_, valueIndex) => valueIndex !== index);
}

export function insertSequenceValues(
  values: readonly number[],
  index: number,
  inserted: readonly number[],
): number[] {
  const boundedIndex = Math.min(Math.max(index, 0), values.length);
  return [...values.slice(0, boundedIndex), ...inserted, ...values.slice(boundedIndex)];
}
