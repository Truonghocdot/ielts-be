import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware.js";

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
    const { sectionId, startIndex, endIndex, color } = request.body as any;

    if (!sectionId || startIndex === undefined || endIndex === undefined) {
      return reply.status(400).send({ error: "Thiếu thông tin bắt buộc" });
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

  // DELETE /highlights/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const studentId = (request as any).user.id;

      try {
        await fastify.prisma.highlight.deleteMany({
          where: {
            id,
            studentId, // Ensure user can only delete their own highlights
          },
        });
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
