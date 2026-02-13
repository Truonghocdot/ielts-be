import { FastifyPluginAsync } from "fastify";
import { authenticate } from "../middlewares/auth.middleware.js";

const enrollmentsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /enrollments - Get user enrollments
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const user = request.user;

    const enrollments = await fastify.prisma.enrollment.findMany({
      where: { studentId: user.id },
      include: {
        course: {
          include: {
            teacher: { select: { id: true, fullName: true } },
            _count: { select: { exams: true } },
          },
        },
      },
      orderBy: { enrolledAt: "desc" },
    });

    return enrollments;
  });

  // POST /enrollments - Enroll in a course
  fastify.post("/", { preHandler: authenticate }, async (request, reply) => {
    const { courseId } = request.body as any;
    const user = request.user;

    if (!courseId) {
      return reply.status(400).send({ error: "Yêu cầu courseId" });
    }

    // Check course exists and is published
    const course = await fastify.prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      return reply.status(404).send({ error: "Không tìm thấy khóa học" });
    }

    if (!course.isPublished) {
      return reply
        .status(400)
        .send({ error: "Khóa học không khả dụng để đăng ký" });
    }

    // Check if already enrolled
    const existing = await fastify.prisma.enrollment.findUnique({
      where: {
        courseId_studentId: {
          courseId,
          studentId: user.id,
        },
      },
    });

    if (existing) {
      return existing; // Already enrolled
    }

    const enrollment = await fastify.prisma.enrollment.create({
      data: {
        courseId,
        studentId: user.id,
      },
      include: {
        course: true,
      },
    });

    return reply.status(201).send(enrollment);
  });

  // PUT /enrollments/:id - Update enrollment progress
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const { progressPercent } = request.body as any;
      const user = request.user;

      const enrollment = await fastify.prisma.enrollment.findUnique({
        where: { id },
      });

      if (!enrollment) {
        return reply.status(404).send({ error: "Không tìm thấy đăng ký" });
      }

      if (enrollment.studentId !== user.id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      const updated = await fastify.prisma.enrollment.update({
        where: { id },
        data: { progressPercent },
      });

      return updated;
    },
  );

  // DELETE /enrollments/:id - Unenroll from course
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user;

      const enrollment = await fastify.prisma.enrollment.findUnique({
        where: { id },
      });

      if (!enrollment) {
        return reply.status(404).send({ error: "Enrollment not found" });
      }

      const isAdmin = user.roles.includes("admin");
      if (!isAdmin && enrollment.studentId !== user.id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      await fastify.prisma.enrollment.delete({ where: { id } });
      return { success: true };
    },
  );
};

export default enrollmentsRoutes;
