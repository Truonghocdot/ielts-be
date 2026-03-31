import { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { paginationSchema } from "../schemas/common.schema.js";
import { createExamSchema, updateExamSchema } from "../schemas/exam.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";
import { toFileUrl } from "../utils/file.js";
import { verifyPassword } from "../utils/password.js";

const examsRoutes: FastifyPluginAsync = async (fastify) => {
  const cleanQuestionData = (q: any, isAdminOrTeacher: boolean) => {
    if (isAdminOrTeacher) return q;
    const cleaned = { ...q };
    if (q.questionType === "matching" && q.correctAnswer) {
      try {
        const config = JSON.parse(q.correctAnswer);
        delete config.pairs;
        cleaned.correctAnswer = JSON.stringify(config);
      } catch {
        cleaned.correctAnswer = null;
      }
    } else {
      cleaned.correctAnswer = null;
    }
    return cleaned;
  };

  // GET /exams - List all exams
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const query = paginationSchema.safeParse(request.query);
    const { courseId, isPublished, isActive } = request.query as any;

    if (!query.success) {
      return reply.status(400).send({ error: "Tham số truy vấn không hợp lệ" });
    }

    const { page, limit, search, sortBy = "createdAt", sortOrder } = query.data;
    const skip = (page - 1) * limit;

    const where: any = {};

    // Teacher: only see exams from courses they teach
    const user = request.user;
    const isAdmin = user.roles.includes("admin");
    const isTeacher = user.roles.includes("teacher");

    if (isTeacher && !isAdmin) {
      where.course = { teacherId: user.id };
    } else if (!isAdmin && !isTeacher) {
      // Student: see exams from enrolled courses OR open exams
      where.OR = [
        {
          course: {
            enrollments: { some: { studentId: user.id } },
          },
        },
        { isOpen: true },
      ];
      where.isPublished = true;
      where.isActive = true;
    }

    if (courseId) {
      where.courseId = courseId;
    }

    if (isPublished !== undefined) {
      where.isPublished = isPublished === "true";
    }

    if (isActive !== undefined) {
      where.isActive = isActive === "true";
    }

    if (search) {
      where.title = { contains: search };
    }

    const [data, total] = await Promise.all([
      fastify.prisma.exam.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          course: {
            select: { id: true, title: true },
          },
          _count: {
            select: { sections: true, submissions: true },
          },
        },
      }),
      fastify.prisma.exam.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  });

  // GET /exams/:id - Get exam with sections
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;

      const exam = await fastify.prisma.exam.findUnique({
        where: { id },
        include: {
          course: { select: { id: true, title: true } },
          sections: {
            orderBy: { orderIndex: "asc" },
            include: {
              questionGroups: {
                orderBy: { orderIndex: "asc" },
                include: {
                  questions: { orderBy: { orderIndex: "asc" } },
                },
              },
            },
          },
        },
      });

      if (!exam) {
        return reply.status(404).send({ error: "Không tìm thấy bài thi" });
      }

      const user = request.user;
      const isAdmin = user.roles.includes("admin");
      const isTeacher = user.roles.includes("teacher");

      // IDOR Check
      if (!isAdmin && !isTeacher) {
        const enrollment = await fastify.prisma.enrollment.findUnique({
          where: {
            courseId_studentId: {
              courseId: exam.courseId,
              studentId: user.id,
            },
          },
        });

        if (!enrollment) {
          if (!exam.isOpen) {
            return reply
              .status(403)
              .send({ error: "Bạn chưa đăng ký khóa học này để xem bài thi" });
          }
        }

        if (!exam.isPublished || !exam.isActive) {
          return reply.status(403).send({ error: "Bài thi hiện không còn khả dụng" });
        }
      }

      // Format lại liên kết file trong các section và question
      const shouldShowTranscript = isAdmin || isTeacher;
      const formattedSections = exam.sections.map((section) => ({
        ...section,
        audioUrl: toFileUrl(section.audioUrl),
        audioScript: shouldShowTranscript ? section.audioScript : undefined,
        questionGroups: section.questionGroups.map((group) => ({
          ...group,
          audioUrl: toFileUrl(group.audioUrl),
          questions: group.questions.map((question) => {
            const formatted = {
              ...question,
              audioUrl: toFileUrl(question.audioUrl),
            };
            return cleanQuestionData(formatted, isAdmin || isTeacher);
          }),
        })),
      }));

      return {
        ...exam,
        sections: formattedSections,
      };
    },
  );

  // POST /exams - Create exam
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const data = handleValidation(
        createExamSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const exam = await fastify.prisma.exam.create({
        data,
      });

      // Auto-create 5 default sections
      const defaultSections = [
        {
          sectionType: "listening" as const,
          title: "Listening",
          orderIndex: 0,
        },
        { sectionType: "reading" as const, title: "Reading", orderIndex: 1 },
        { sectionType: "writing" as const, title: "Writing", orderIndex: 2 },
        { sectionType: "speaking" as const, title: "Speaking", orderIndex: 3 },
        { sectionType: "general" as const, title: "Grammar", orderIndex: 4 },
      ];

      await fastify.prisma.examSection.createMany({
        data: defaultSections.map((s) => ({
          examId: exam.id,
          ...s,
        })),
      });

      // Return exam with sections
      const examWithSections = await fastify.prisma.exam.findUnique({
        where: { id: exam.id },
        include: {
          sections: { orderBy: { orderIndex: "asc" } },
        },
      });

      return reply.status(201).send(examWithSections);
    },
  );

  // PUT /exams/:id - Update exam
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = handleValidation(
        updateExamSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const existing = await fastify.prisma.exam.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy bài thi" });
      }

      const updatedExam = await fastify.prisma.exam.update({
        where: { id },
        data,
      });

      return updatedExam;
    },
  );

  // DELETE /exams/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      const { password } = (request.body || {}) as { password?: string };

      if (!password) {
        return reply.status(400).send({ error: "Yêu cầu mật khẩu xác nhận" });
      }

      const actor = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: { password: true },
      });
      if (!actor) {
        return reply.status(401).send({ error: "Không thể xác thực người dùng" });
      }

      const validPassword = await verifyPassword(password, actor.password);
      if (!validPassword) {
        return reply.status(401).send({ error: "Mật khẩu xác nhận không đúng" });
      }

      const existing = await fastify.prisma.exam.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy bài thi" });
      }

      const lockRows = await fastify.prisma.$queryRaw<
        Array<{ is_locked: number | boolean | null }>
      >(Prisma.sql`SELECT is_locked FROM exams WHERE id = ${id} LIMIT 1`);
      const isLocked = Boolean(lockRows[0]?.is_locked);

      if (isLocked) {
        return reply.status(423).send({
          error: "Bài thi đang bị khóa. Hãy mở khóa trước khi xóa",
        });
      }

      await fastify.prisma.exam.delete({ where: { id } });
      return { success: true };
    },
  );
};

export default examsRoutes;
