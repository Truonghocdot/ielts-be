import { z } from "zod";

export const createCourseSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  thumbnailUrl: z.string().url().optional(),
  level: z.enum(["beginner", "intermediate", "advanced"]).default("beginner"),
  price: z.number().min(0).default(0),
  syllabus: z.any().optional(),
  slug: z.string().optional(),
});

export const updateCourseSchema = createCourseSchema.partial().extend({
  isPublished: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
