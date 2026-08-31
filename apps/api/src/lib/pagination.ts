export function parsePage(query: URLSearchParams): { page: number; perPage: number } {
  const page = Math.max(0, Number(query.get("page")) || 0);
  const perPage = Math.min(200, Math.max(1, Number(query.get("per_page")) || 60));
  return { page, perPage };
}
