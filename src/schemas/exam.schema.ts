import { z } from "zod";

export const createExamSchema = z.object({
  courseId: z.string(),
  title: z.string().min(1, "Tiêu đề là bắt buộc"),
  description: z.string().optional(),
  week: z.number().int().min(1, "Tuần phải ít nhất là 1").default(1),
  durationMinutes: z
    .number()
    .int()
    .min(1, "Thời gian thi phải ít nhất là 1 phút")
    .default(60),
  examType: z.string().default("ielts"),
  isPublished: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  isLocked: z.boolean().optional().default(false),
  isOpen: z.boolean().optional().default(false),
  maxParticipants: z.number().int().positive().optional().nullable(),
});

export const updateExamSchema = createExamSchema.partial();

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type UpdateExamInput = z.infer<typeof updateExamSchema>;
