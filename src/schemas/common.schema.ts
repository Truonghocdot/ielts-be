import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().min(1, "Trang phải ít nhất là 1").default(1),
  limit: z.coerce
    .number()
    .min(1, "Giới hạn phải ít nhất là 1")
    .max(100, "Giới hạn tối đa là 100")
    .default(10),
  search: z.string().optional(),
  sortBy: z.string().optional(),
  sortOrder: z
    .enum(["asc", "desc"], {
      errorMap: () => ({ message: "Thứ tự sắp xếp phải là 'asc' hoặc 'desc'" }),
    })
    .default("desc"),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
