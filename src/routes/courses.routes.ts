import { FastifyPluginAsync } from "fastify";
import { paginationSchema } from "../schemas/common.schema.js";
import {
  createCourseSchema,
  updateCourseSchema,
  CreateCourseInput,
  UpdateCourseInput,
} from "../schemas/course.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";

const coursesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /courses - List all courses (public)
  fastify.get("/", async (request, reply) => {
    const query = paginationSchema.safeParse(request.query);

    if (!query.success) {
      return reply.status(400).send({ error: "Tham số truy vấn không hợp lệ" });
    }

    const { page, limit, search, sortBy = "createdAt", sortOrder } = query.data;
    const skip = (page - 1) * limit;
    const { level } = request.query as any;

    const where: any = {};

    // Only show published courses for public
    const isAuthenticated = request.headers.authorization;
    if (!isAuthenticated) {
      where.isPublished = true;
      where.isActive = true;
    }

    if (search) {
      where.title = { contains: search };
    }

    if (level && level !== "all") {
      where.level = level;
    }

    const [data, total] = await Promise.all([
      fastify.prisma.course.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          teacher: {
            select: { id: true, fullName: true, avatarUrl: true },
          },
          _count: {
            select: { exams: true, enrollments: true },
          },
        },
      }),
      fastify.prisma.course.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // GET /courses/:id - Get course by ID
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const { id } = request.params;

    const course = await fastify.prisma.course.findUnique({
      where: { id },
      include: {
        teacher: {
          select: { id: true, fullName: true, avatarUrl: true },
        },
        exams: {
          where: { isActive: true },
          orderBy: { week: "asc" },
        },
      },
    });

    if (!course) {
      return reply.status(404).send({ error: "Không tìm thấy khóa học" });
    }

    return course;
  });

  // GET /courses/slug/:slug - Get course by slug
  fastify.get<{ Params: { slug: string } }>(
    "/slug/:slug",
    async (request, reply) => {
      const { slug } = request.params;

      const course = await fastify.prisma.course.findUnique({
        where: { slug },
        include: {
          teacher: {
            select: { id: true, fullName: true, avatarUrl: true },
          },
          exams: {
            where: { isActive: true, isPublished: true },
            orderBy: { week: "asc" },
          },
        },
      });

      if (!course) {
        return reply.status(404).send({ error: "Course not found" });
      }

      return course;
    },
  );

  // POST /courses - Create course (admin/teacher only)
  fastify.post<{ Body: CreateCourseInput }>(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const data = handleValidation(
        createCourseSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const { id: teacherId } = request.user;

      // Generate slug if not provided
      if (!data.slug && data.title) {
        data.slug = data.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      }

      const course = await fastify.prisma.course.create({
        data: {
          ...data,
          price: data.price || 0,
          teacherId,
        },
      });

      return reply.status(201).send(course);
    },
  );

  // PUT /courses/:id - Update course (admin/teacher only)
  fastify.put<{ Params: { id: string }; Body: UpdateCourseInput }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const data = handleValidation(
        updateCourseSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      // Check if course exists
      const existing = await fastify.prisma.course.findUnique({
        where: { id },
      });

      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy khóa học" });
      }

      const course = await fastify.prisma.course.update({
        where: { id },
        data,
      });

      return course;
    },
  );

  // DELETE /courses/:id - Delete course (admin only)
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;

      await fastify.prisma.course.delete({
        where: { id },
      });

      return { success: true };
    },
  );
};

export default coursesRoutes;
