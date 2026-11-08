/**
 * D1 caps a single query at 100 bound parameters. Every `inArray(...)` built
 * from a user-controlled or unbounded list must therefore be chunked; 90
 * leaves headroom for the other predicates in the same WHERE clause.
 */
export const D1_MAX_BOUND_PARAMS = 90;

export function chunkItems<T>(items: T[], size = D1_MAX_BOUND_PARAMS): T[][] {
  if (items.length === 0) {
    return [];
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
