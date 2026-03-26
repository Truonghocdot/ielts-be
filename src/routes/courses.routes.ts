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
import { toFileUrl, withFileUrls } from "../utils/file.js";
import { verifyPassword } from "../utils/password.js";

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

    let currentUser: any = null;
    const authHeader = request.headers.authorization;
    if (authHeader) {
      try {
        await request.jwtVerify();
        currentUser = request.user;
      } catch (err) {
        // Token invalid/expired, treat as guest
      }
    }

    // Role-based visibility
    if (!currentUser) {
      // Guest: force empty result by returning early
      return {
        data: [],
        meta: {
          total: 0,
          page,
          limit,
          totalPages: 0,
        },
      };
    } else {
      const hasAdminOrTeacherRole = currentUser.roles?.some((r: string) =>
        ["admin", "teacher"].includes(r),
      );

      if (!hasAdminOrTeacherRole) {
        // Student: only show enrolled courses
        where.enrollments = { some: { studentId: currentUser.id } };
        where.isPublished = true;
        where.isActive = true;
      } else {
        // Admin or Teacher: keep defaults (no enrollment filter)
        // Adjust if they should only see active/published by default
      }
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

    const courses = data.map((c) => ({
      ...c,
      thumbnailUrl: toFileUrl(c.thumbnailUrl),
      teacher: c.teacher
        ? {
            ...c.teacher,
            avatarUrl: toFileUrl(c.teacher.avatarUrl),
          }
        : null,
    }));

    return {
      data: courses,
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

    let currentUser: any = null;
    const authHeader = request.headers.authorization;
    if (authHeader) {
      try {
        await request.jwtVerify();
        currentUser = request.user;
      } catch (err) {
        // Token invalid/expired, treat as guest
      }
    }

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

    if (!currentUser) {
      return reply.status(404).send({ error: "Không tìm thấy khóa học" });
    }

    const hasAdminOrTeacherRole = currentUser.roles?.some((r: string) =>
      ["admin", "teacher"].includes(r),
    );

    if (!hasAdminOrTeacherRole) {
      if (!course.isActive || !course.isPublished) {
        return reply.status(404).send({ error: "Không tìm thấy khóa học" });
      }
    }

    return {
      ...course,
      thumbnailUrl: toFileUrl(course.thumbnailUrl),
      teacher: course.teacher
        ? {
            ...course.teacher,
            avatarUrl: toFileUrl(course.teacher.avatarUrl),
          }
        : null,
    };
  });

  // GET /courses/slug/:slug - Get course by slug
  fastify.get<{ Params: { slug: string } }>(
    "/slug/:slug",
    async (request, reply) => {
      const { slug } = request.params;

      let currentUser: any = null;
      const authHeader = request.headers.authorization;
      if (authHeader) {
        try {
          await request.jwtVerify();
          currentUser = request.user;
        } catch (err) {
          // Token invalid/expired, treat as guest
        }
      }

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

      if (!currentUser) {
        return reply.status(404).send({ error: "Course not found" });
      }

      const hasAdminOrTeacherRole = currentUser.roles?.some((r: string) =>
        ["admin", "teacher"].includes(r),
      );

      if (!hasAdminOrTeacherRole) {
        if (!course.isActive || !course.isPublished) {
          return reply.status(404).send({ error: "Course not found" });
        }
      }

      return {
        ...course,
        thumbnailUrl: toFileUrl(course.thumbnailUrl),
        teacher: course.teacher
          ? {
              ...course.teacher,
              avatarUrl: toFileUrl(course.teacher.avatarUrl),
            }
          : null,
      };
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

      return reply.status(201).send(withFileUrls(course, ["thumbnailUrl"]));
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

      if (existing.isLocked) {
        const updateKeys = Object.keys(data);
        const lockOnlyUpdate =
          updateKeys.length > 0 && updateKeys.every((key) => key === "isLocked");

        if (!lockOnlyUpdate) {
          return reply.status(423).send({
            error: "Khóa học đang bị khóa. Hãy mở khóa trước khi chỉnh sửa",
          });
        }
      }

      const course = await fastify.prisma.course.update({
        where: { id },
        data,
      });

      return withFileUrls(course, ["thumbnailUrl"]);
    },
  );

  // DELETE /courses/:id - Delete course (admin only)
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

      const existing = await fastify.prisma.course.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy khóa học" });
      }

      const [enrollmentCount, submissionCount] = await Promise.all([
        fastify.prisma.enrollment.count({ where: { courseId: id } }),
        fastify.prisma.examSubmission.count({
          where: { exam: { courseId: id } },
        }),
      ]);

      if (enrollmentCount > 0 || submissionCount > 0) {
        return reply.status(409).send({
          error:
            "Không thể xóa khóa học khi vẫn còn học viên hoặc bài nộp liên quan",
        });
      }

      await fastify.prisma.course.update({
        where: { id },
        data: {
          isActive: false,
          isPublished: false,
        },
      });

      return { success: true, softDeleted: true };
    },
  );
};

export default coursesRoutes;
