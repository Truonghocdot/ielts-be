import { FastifyPluginAsync } from "fastify";
import { paginationSchema } from "../schemas/common.schema.js";
import { createExamSchema, updateExamSchema } from "../schemas/exam.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";

const examsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /exams - List all exams
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const query = paginationSchema.safeParse(request.query);
    const { courseId } = request.query as any;

    if (!query.success) {
      return reply.status(400).send({ error: "Tham số truy vấn không hợp lệ" });
    }

    const { page, limit, search, sortBy = "createdAt", sortOrder } = query.data;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (courseId) {
      where.courseId = courseId;
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

      return exam;
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

      return reply.status(201).send(exam);
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
