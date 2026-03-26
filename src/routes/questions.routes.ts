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
    "listening",
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
  audioUrl: z.string().optional(),
  orderIndex: z.number().int().default(0),
});

const createQuestionSchema = z.object({
  groupId: z.string({ required_error: "ID nhóm câu hỏi là bắt buộc" }),
  questionType: questionTypeEnum,
  questionText: z.string().min(1, "Nội dung câu hỏi là bắt buộc"),
  options: z.any().optional(),
  correctAnswer: z.string().optional(),
  audioUrl: z.string().optional(),
  points: z.number({ invalid_type_error: "Điểm phải là số" }).int().default(1),
  orderIndex: z.number().int().default(0),
});

const updateQuestionGroupSchema = createQuestionGroupSchema.partial();
const updateQuestionSchema = createQuestionSchema.partial();

const questionsRoutes: FastifyPluginAsync = async (fastify) => {
  const MAX_AUTO_ORDER_RETRIES = 5;

  const isPrismaErrorCode = (error: unknown, code: string) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code;

  const createQuestionWithAutoOrder = async (data: any) => {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < MAX_AUTO_ORDER_RETRIES) {
      try {
        return await fastify.prisma.$transaction(
          async (tx) => {
            const maxOrder = await tx.question.aggregate({
              where: { groupId: data.groupId },
              _max: { orderIndex: true },
            });
            const nextOrderIndex = (maxOrder._max.orderIndex ?? -1) + 1;
            return tx.question.create({
              data: {
                ...data,
                orderIndex: nextOrderIndex,
              },
            });
          },
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        lastError = error;
        const shouldRetry =
          isPrismaErrorCode(error, "P2002") || isPrismaErrorCode(error, "P2034");

        if (!shouldRetry) {
          throw error;
        }

        attempt += 1;
      }
    }

    throw lastError;
  };

  const hasOrderConflict = async (
    groupId: string,
    orderIndex: number,
    excludeId?: string,
  ) => {
    const existing = await fastify.prisma.question.findFirst({
      where: {
        groupId,
        orderIndex,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    });
    return !!existing;
  };

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
      const data = handleValidation(
        updateQuestionGroupSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

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

      const body = request.body as any;
      const orderIndexProvided =
        body &&
        (Object.prototype.hasOwnProperty.call(body, "orderIndex") ||
          Object.prototype.hasOwnProperty.call(body, "order_index"));

      if (!orderIndexProvided) {
        try {
          const question = await createQuestionWithAutoOrder(data as any);
          return reply.status(201).send(question);
        } catch (error) {
          if (isPrismaErrorCode(error, "P2002")) {
            return reply.status(409).send({
              error: "Thứ tự câu hỏi bị trùng trong cùng nhóm",
            });
          }
          throw error;
        }
      }

      const desiredOrder = data.orderIndex;

      if (await hasOrderConflict(data.groupId, desiredOrder)) {
        try {
          const question = await createQuestionWithAutoOrder(data as any);
          return reply.status(201).send(question);
        } catch (error) {
          if (isPrismaErrorCode(error, "P2002")) {
            return reply.status(409).send({
              error: "Thứ tự câu hỏi bị trùng trong cùng nhóm",
            });
          }
          throw error;
        }
      }

      data.orderIndex = desiredOrder;

      try {
        const question = await fastify.prisma.question.create({
          data: data as any,
        });
        return reply.status(201).send(question);
      } catch (error) {
        if (isPrismaErrorCode(error, "P2002")) {
          const question = await createQuestionWithAutoOrder(data as any);
          return reply.status(201).send(question);
        }
        throw error;
      }
    },
  );

  // PUT /questions/:id
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = handleValidation(
        updateQuestionSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const body = request.body as any;
      const orderIndexProvided =
        body &&
        (Object.prototype.hasOwnProperty.call(body, "orderIndex") ||
          Object.prototype.hasOwnProperty.call(body, "order_index"));

      if (!orderIndexProvided) {
        delete data.orderIndex;
      }

      const existing = await fastify.prisma.question.findUnique({
        where: { id },
        select: { id: true, groupId: true, orderIndex: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy câu hỏi" });
      }

      const nextGroupId = data.groupId ?? existing.groupId;
      const nextOrderIndex =
        data.orderIndex !== undefined && data.orderIndex !== null
          ? data.orderIndex
          : existing.orderIndex ?? 0;

      if (await hasOrderConflict(nextGroupId, nextOrderIndex, id)) {
        return reply.status(409).send({
          error: "Thứ tự câu hỏi bị trùng trong cùng nhóm",
        });
      }

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

      let attempt = 0;
      let lastError: unknown;

      while (attempt < MAX_AUTO_ORDER_RETRIES) {
        try {
          const created = await fastify.prisma.$transaction(
            async (tx) => {
              const existingOrders = await tx.question.findMany({
                where: { groupId },
                select: { orderIndex: true },
              });
              const usedOrders = new Set<number>();
              existingOrders.forEach((item) => {
                if (typeof item.orderIndex === "number") {
                  usedOrders.add(item.orderIndex);
                }
              });
              const maxExisting =
                usedOrders.size > 0 ? Math.max(...Array.from(usedOrders)) : -1;
              let nextOrder = maxExisting + 1;
              const batchOrders = new Set<number>();

              const payload = questions.map((q: any) => {
                const rawOrder =
                  q.orderIndex !== undefined && q.orderIndex !== null
                    ? q.orderIndex
                    : null;
                const orderIndex = rawOrder !== null ? rawOrder : nextOrder++;

                if (usedOrders.has(orderIndex) || batchOrders.has(orderIndex)) {
                  throw new Error("DUPLICATE_ORDER_INDEX");
                }
                batchOrders.add(orderIndex);

                return {
                  groupId,
                  questionType: q.questionType,
                  questionText: q.questionText,
                  options: q.options,
                  correctAnswer: q.correctAnswer,
                  audioUrl: q.audioUrl,
                  points: q.points || 1,
                  orderIndex,
                };
              });

              const result = await tx.question.createMany({
                data: payload,
              });
              return result.count;
            },
            { isolationLevel: "Serializable" },
          );

          return { created };
        } catch (error: any) {
          lastError = error;
          if (error?.message === "DUPLICATE_ORDER_INDEX" || isPrismaErrorCode(error, "P2002")) {
            return reply.status(409).send({
              error: "Thứ tự câu hỏi bị trùng trong cùng nhóm",
            });
          }

          if (isPrismaErrorCode(error, "P2034")) {
            attempt += 1;
            continue;
          }

          throw error;
        }
      }

      throw lastError;
    },
  );
};

export default questionsRoutes;
