import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";
import { toFileUrl, withFileUrls } from "../utils/file.js";

const sectionTypeEnum = z.enum(
  ["listening", "reading", "writing", "speaking", "general"],
  {
    errorMap: () => ({
      message:
        "Loại phần thi không hợp lệ. Phải là: listening, reading, writing, speaking, general",
    }),
  },
);

const createSectionSchema = z.object({
  examId: z.string({ required_error: "ID bài tập là bắt buộc" }),
  sectionType: sectionTypeEnum,
  title: z.string().min(1, "Tiêu đề là bắt buộc"),
  instructions: z.string().max(5_000_000, "Nội dung hướng dẫn quá dài").optional(),
  content: z.any().optional(),
  audioUrl: z.string().optional(),
  audioScript: z.string().max(5_000_000, "Nội dung script quá dài").optional(),
  durationMinutes: z
    .number({ invalid_type_error: "Thời gian phải là số" })
    .int()
    .optional(),
  orderIndex: z.number().int().default(0),
});

const updateSectionSchema = z.object({
  title: z.string().min(1, "Tiêu đề là bắt buộc").optional(),
  instructions: z.string().max(5_000_000, "Nội dung hướng dẫn quá dài").optional(),
  content: z.any().optional(),
  audioUrl: z.string().optional(),
  audioScript: z.string().max(5_000_000, "Nội dung script quá dài").optional(),
  durationMinutes: z
    .number({ invalid_type_error: "Thời gian phải là số" })
    .int()
    .optional(),
  orderIndex: z.number().int().optional(),
});

const sectionsRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper to clean sensitive question data for students
  const cleanQuestionData = (q: any, isAdminOrTeacher: boolean) => {
    if (isAdminOrTeacher) return q;
    const cleaned = { ...q };
    if (q.questionType === "matching" && q.correctAnswer) {
      try {
        const config = JSON.parse(q.correctAnswer);
        delete config.pairs; // Hide correct matching pairs
        cleaned.correctAnswer = JSON.stringify(config);
      } catch {
        cleaned.correctAnswer = null;
      }
    } else {
      // For all other types, hide the answer completely
      cleaned.correctAnswer = null;
    }
    return cleaned;
  };

  // GET /sections/:id
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;

      const section = await fastify.prisma.examSection.findUnique({
        where: { id },
        include: {
          exam: { select: { id: true, courseId: true, isPublished: true, isActive: true } },
          questionGroups: {
            orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
            include: {
              questions: {
                orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      });

      if (!section) {
        return reply.status(404).send({ error: "Không tìm thấy Section" });
      }

      const user = request.user;
      const isAdmin = user.roles.includes("admin");
      const isTeacher = user.roles.includes("teacher");

      // IDOR/Enrollment Check
      if (!isAdmin && !isTeacher) {
        const enrollment = await fastify.prisma.enrollment.findUnique({
          where: {
            courseId_studentId: {
              courseId: section.exam.courseId,
              studentId: user.id,
            },
          },
        });

        if (!enrollment) {
          return reply.status(403).send({ error: "Bạn chưa đăng ký khóa học này" });
        }
      }

      // Format audioUrls and Clean questions
      const isAdminOrTeacher = isAdmin || isTeacher;
      const formatted = {
        ...section,
        audioUrl: toFileUrl(section.audioUrl),
        audioScript: isAdminOrTeacher ? section.audioScript : undefined,
        questionGroups: section.questionGroups.map((group: any) => ({
          ...group,
          audioUrl: toFileUrl(group.audioUrl),
          questions: group.questions.map((q: any) => {
            const fq = {
              ...q,
              audioUrl: toFileUrl(q.audioUrl),
            };
            return cleanQuestionData(fq, isAdminOrTeacher);
          }),
        })),
      };

      return formatted;
    },
  );

  // POST /sections - BLOCKED (sections are auto-created with exam)
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      return reply.status(403).send({
        error:
          "Không thể tạo section thủ công. Sections được tạo tự động khi tạo bài thi.",
      });
    },
  );

  // PUT /sections/:id
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = handleValidation(
        updateSectionSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      try {
        const section = await fastify.prisma.examSection.update({
          where: { id },
          data,
        });

        return withFileUrls(section, ["audioUrl"]);
      } catch (error: any) {
        if (error?.code === "P2000") {
          return reply.status(400).send({
            error: "Nội dung quá dài cho trường lưu trữ",
          });
        }
        throw error;
      }
    },
  );

  // DELETE /sections/:id - BLOCKED (sections cannot be deleted)
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      return reply.status(403).send({
        error: "Không thể xóa section. Mỗi bài tập luôn có đủ 5 sections.",
      });
    },
  );
};

export default sectionsRoutes;
