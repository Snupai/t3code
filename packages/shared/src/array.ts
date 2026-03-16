/* eslint-disable unicorn/no-array-sort */

export function toSortedCompat<T>(
  values: readonly T[],
  compareFn?: (left: T, right: T) => number,
): T[] {
  return [...values].sort(compareFn);
}
