import { z } from "zod";

export const createCourseSchema = z.object({
  title: z.string().min(1, "Tiêu đề là bắt buộc"),
  description: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  level: z
    .enum(["beginner", "intermediate", "advanced"], {
      errorMap: () => ({ message: "Cấp độ không hợp lệ" }),
    })
    .default("beginner"),
  price: z.coerce.number().min(0, "Giá không được nhỏ hơn 0").default(0),
  syllabus: z.any().optional().nullable(),
  slug: z.string().optional().nullable(),
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  isPublished: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
