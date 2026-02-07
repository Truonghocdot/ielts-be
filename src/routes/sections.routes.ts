import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const sectionTypeEnum = z.enum([
  "listening",
  "reading",
  "writing",
  "speaking",
  "general",
]);

const createSectionSchema = z.object({
  examId: z.string().uuid(),
  sectionType: sectionTypeEnum,
  title: z.string().min(1),
  instructions: z.string().optional(),
  content: z.any().optional(),
  audioUrl: z.string().optional(),
  durationMinutes: z.number().int().optional(),
  orderIndex: z.number().int().default(0),
});

const sectionsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /sections/:id
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;

      const section = await fastify.prisma.examSection.findUnique({
        where: { id },
        include: {
          questionGroups: {
            orderBy: { orderIndex: "asc" },
            include: {
              questions: { orderBy: { orderIndex: "asc" } },
            },
          },
        },
      });

      if (!section) {
        return reply.status(404).send({ error: "Section not found" });
      }

      return section;
    },
  );

  // POST /sections
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const validation = createSectionSchema.safeParse(request.body);

      if (!validation.success) {
        return reply
          .status(400)
          .send({
            error: "Validation failed",
            details: validation.error.flatten().fieldErrors,
          });
      }

      const section = await fastify.prisma.examSection.create({
        data: validation.data as any,
      });

      return reply.status(201).send(section);
    },
  );

  // PUT /sections/:id
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = request.body as any;

      const section = await fastify.prisma.examSection.update({
        where: { id },
        data,
      });

      return section;
    },
  );

  // DELETE /sections/:id
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      await fastify.prisma.examSection.delete({ where: { id } });
      return { success: true };
    },
  );
};

export default sectionsRoutes;
