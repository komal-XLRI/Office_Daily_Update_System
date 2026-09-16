import type { Paginated } from "@/types";

export function paginationWindow(page: number, pageSize: number): { skip: number; limit: number } {
  return { skip: (page - 1) * pageSize, limit: pageSize };
}

export function toPaginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
