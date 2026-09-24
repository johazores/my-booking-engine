export const INVENTORY_PAGE_SIZE_DEFAULT = 20;
export const INVENTORY_PAGE_SIZE_MAX = 50;

export function normalizeInventoryPagination(input: { page?: number; pageSize?: number }) {
  const page = Number.isSafeInteger(input.page) && (input.page ?? 0) > 0 ? input.page as number : 1;
  const pageSize = Number.isSafeInteger(input.pageSize) && (input.pageSize ?? 0) > 0
    ? Math.min(input.pageSize as number, INVENTORY_PAGE_SIZE_MAX)
    : INVENTORY_PAGE_SIZE_DEFAULT;
  return { page, pageSize };
}

export function resolveInventoryPagination(input: { total: number; page?: number; pageSize?: number }) {
  if (!Number.isSafeInteger(input.total) || input.total < 0) {
    throw new RangeError('Collection total must be a non-negative safe integer.');
  }
  const normalized = normalizeInventoryPagination(input);
  const totalPages = Math.max(1, Math.ceil(input.total / normalized.pageSize));
  const page = Math.min(normalized.page, totalPages);
  return {
    page,
    pageSize: normalized.pageSize,
    totalPages,
    skip: (page - 1) * normalized.pageSize,
    take: normalized.pageSize,
  };
}
