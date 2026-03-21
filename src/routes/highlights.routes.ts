import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware.js";

const createHighlightSchema = z.object({
  sectionId: z.string().min(1),
  startIndex: z.number().int().nonnegative(),
  endIndex: z.number().int().positive(),
  color: z.enum(["yellow", "green"]).optional(),
});

const updateHighlightSchema = z.object({
  color: z.enum(["yellow", "green"]),
});

const highlightsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /highlights?sectionId=...
  fastify.get<{ Querystring: { sectionId: string } }>(
    "/",
    { preHandler: authenticate },
    async (request, reply) => {
      const { sectionId } = request.query;
      const studentId = (request as any).user.id;

      if (!sectionId) {
        return reply.status(400).send({ error: "sectionId là bắt buộc" });
      }

      const highlights = await fastify.prisma.highlight.findMany({
        where: {
          sectionId,
          studentId,
        },
        orderBy: {
          createdAt: "asc",
        },
      });

      return { data: highlights };
    },
  );

  // POST /highlights
  fastify.post("/", { preHandler: authenticate }, async (request, reply) => {
    const studentId = (request as any).user.id;
    const parsed = createHighlightSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Dữ liệu highlight không hợp lệ" });
    }

    const { sectionId, startIndex, endIndex, color } = parsed.data;

    if (endIndex <= startIndex) {
      return reply
        .status(400)
        .send({ error: "Khoảng highlight không hợp lệ (endIndex <= startIndex)" });
    }

    const highlight = await fastify.prisma.highlight.create({
      data: {
        sectionId,
        studentId,
        startIndex,
        endIndex,
        color: color || "yellow",
      },
    });

    return highlight;
  });

  // PATCH /highlights/:id
  fastify.patch<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const studentId = (request as any).user.id;

      const parsed = updateHighlightSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Dữ liệu cập nhật không hợp lệ" });
      }

      const existing = await fastify.prisma.highlight.findFirst({
        where: { id, studentId },
      });
      if (!existing) {
        return reply
          .status(404)
          .send({ error: "Highlight không tồn tại hoặc không có quyền sửa" });
      }

      const updated = await fastify.prisma.highlight.update({
        where: { id },
        data: { color: parsed.data.color },
      });

      return updated;
    },
  );

  // DELETE /highlights/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const studentId = (request as any).user.id;

      try {
        const deleted = await fastify.prisma.highlight.deleteMany({
          where: {
            id,
            studentId, // Ensure user can only delete their own highlights
          },
        });
        if (deleted.count === 0) {
          return reply
            .status(404)
            .send({ error: "Ghi chú không tồn tại hoặc không có quyền xóa" });
        }
        return { success: true };
      } catch (error) {
        return reply
          .status(404)
          .send({ error: "Ghi chú không tồn tại hoặc không có quyền xóa" });
      }
    },
  );
};

export default highlightsRoutes;
