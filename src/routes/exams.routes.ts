import { FastifyPluginAsync } from "fastify";
import { paginationSchema } from "../schemas/common.schema.js";
import { createExamSchema, updateExamSchema } from "../schemas/exam.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";
import { toFileUrl } from "../utils/file.js";

const examsRoutes: FastifyPluginAsync = async (fastify) => {
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

      // Format lại liên kết file trong các section và question
      const formattedSections = exam.sections.map((section) => ({
        ...section,
        audioUrl: toFileUrl(section.audioUrl),
        questionGroups: section.questionGroups.map((group) => ({
          ...group,
          questions: group.questions.map((question) => ({
            ...question,
            audioUrl: toFileUrl(question.audioUrl),
          })),
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

      const exam = await fastify.prisma.exam.update({
        where: { id },
        data,
      });

      return exam;
    },
  );

  // DELETE /exams/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      await fastify.prisma.exam.delete({ where: { id } });
      return { success: true };
    },
  );
};

export default examsRoutes;
