import { z } from "zod";

export const createExamSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  week: z.number().int().min(1).default(1),
  durationMinutes: z.number().int().min(1).default(60),
  examType: z.string().default("ielts"),
});

export const updateExamSchema = createExamSchema.partial().extend({
  isPublished: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type UpdateExamInput = z.infer<typeof updateExamSchema>;
