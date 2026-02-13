import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";

const questionTypeEnum = z.enum(
  [
    "multiple_choice",
    "fill_blank",
    "matching",
    "essay",
    "speaking",
    "short_answer",
    "true_false_not_given",
    "yes_no_not_given",
  ],
  {
    errorMap: () => ({
      message: "Loại câu hỏi không hợp lệ",
    }),
  },
);

const createQuestionGroupSchema = z.object({
  sectionId: z.string({ required_error: "ID phần thi là bắt buộc" }),
  title: z.string().optional(),
  instructions: z.string().optional(),
  passage: z.string().optional(),
  orderIndex: z.number().int().default(0),
});

const createQuestionSchema = z.object({
  groupId: z.string({ required_error: "ID nhóm câu hỏi là bắt buộc" }),
  questionType: questionTypeEnum,
  questionText: z.string().min(1, "Nội dung câu hỏi là bắt buộc"),
  options: z.any().optional(),
  correctAnswer: z.string().optional(),
  points: z.number({ invalid_type_error: "Điểm phải là số" }).int().default(1),
  orderIndex: z.number().int().default(0),
});

const questionsRoutes: FastifyPluginAsync = async (fastify) => {
  // ============ Question Groups ============

  // POST /questions/groups
  fastify.post(
    "/groups",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const data = handleValidation(
        createQuestionGroupSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const group = await fastify.prisma.questionGroup.create({
        data,
      });

      return reply.status(201).send(group);
    },
  );

  // PUT /questions/groups/:id
  fastify.put<{ Params: { id: string } }>(
    "/groups/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body as any;

      const group = await fastify.prisma.questionGroup.update({
        where: { id },
        data,
      });

      return group;
    },
  );

  // DELETE /questions/groups/:id
  fastify.delete<{ Params: { id: string } }>(
    "/groups/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      await fastify.prisma.questionGroup.delete({ where: { id } });
      return { success: true };
    },
  );

  // ============ Questions ============

  // POST /questions
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const data = handleValidation(
        createQuestionSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const question = await fastify.prisma.question.create({
        data: data as any,
      });

      return reply.status(201).send(question);
    },
  );

  // PUT /questions/:id
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body as any;

      const question = await fastify.prisma.question.update({
        where: { id },
        data,
      });

      return question;
    },
  );

  // DELETE /questions/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      await fastify.prisma.question.delete({ where: { id } });
      return { success: true };
    },
  );

  // POST /questions/bulk - Bulk create questions
  fastify.post(
    "/bulk",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { questions, groupId } = request.body as any;

      if (!Array.isArray(questions) || !groupId) {
        return reply
          .status(400)
          .send({ error: "Yêu cầu mảng questions và groupId" });
      }

      const created = await fastify.prisma.question.createMany({
        data: questions.map((q: any, index: number) => ({
          groupId,
          questionType: q.questionType,
          questionText: q.questionText,
          options: q.options,
          correctAnswer: q.correctAnswer,
          points: q.points || 1,
          orderIndex: q.orderIndex ?? index,
        })),
      });

      return { created: created.count };
    },
  );
};

export default questionsRoutes;
