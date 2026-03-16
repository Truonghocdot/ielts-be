import { FastifyPluginAsync } from "fastify";
import { paginationSchema } from "../schemas/common.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { hashPassword } from "../utils/password.js";
import { handleValidation } from "../utils/validation.js";
import { withFileUrls, withFileUrlsMany } from "../utils/file.js";
import {
  getTeacherStudentIds,
  isStudentInTeacherClasses,
} from "../utils/teacherScope.js";

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /users - List users (admin/teacher only)
  fastify.get(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const dataQuery = handleValidation(
        paginationSchema.safeParse(request.query),
        request,
        reply,
      );
      if (!dataQuery) return;

      const { role } = request.query as any;

      const {
        page,
        limit,
        search,
        sortBy = "createdAt",
        sortOrder,
      } = dataQuery;
      const skip = (page - 1) * limit;

      const where: any = {};

      // Teacher: only see students in their classes
      const user = request.user;
      const isAdmin = user.roles.includes("admin");
      const isTeacher = user.roles.includes("teacher");

      if (isTeacher && !isAdmin) {
        const teacherStudentIds = await getTeacherStudentIds(
          fastify.prisma,
          user.id,
        );
        where.id = { in: teacherStudentIds };
      }

      if (search) {
        where.OR = [
          { email: { contains: search } },
          { fullName: { contains: search } },
        ];
      }

      if (role) {
        where.roles = {
          some: { role },
        };
      }

      const [data, total] = await Promise.all([
        fastify.prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          select: {
            id: true,
            email: true,
            fullName: true,
            avatarUrl: true,
            gender: true,
            dateOfBirth: true,
            phone: true,
            parentName: true,
            parentPhone: true,
            isActive: true,
            createdAt: true,
            roles: true,
            _count: {
              select: { enrollments: true, submissions: true },
            },
          },
        }),
        fastify.prisma.user.count({ where }),
      ]);

      const users = data.map((u) => ({
        ...u,
        roles: u.roles.map((r) => r.role),
      }));

      return {
        data: withFileUrlsMany(users, ["avatarUrl"]),
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
      };
    },
  );

  // GET /users/:id
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;

      const user = await fastify.prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          fullName: true,
          avatarUrl: true,
          bio: true,
          isActive: true,
          createdAt: true,
          roles: true,
          enrollments: {
            include: { course: { select: { id: true, title: true } } },
          },
        },
      });

      if (!user) {
        return reply.status(404).send({ error: "Không tìm thấy người dùng" });
      }

      // Teacher: check if this user is a student in their classes
      const currentUser = request.user;
      const isCurrentAdmin = currentUser.roles.includes("admin");
      const isCurrentTeacher = currentUser.roles.includes("teacher");
      if (isCurrentTeacher && !isCurrentAdmin) {
        const hasAccess = await isStudentInTeacherClasses(
          fastify.prisma,
          currentUser.id,
          id,
        );
        if (!hasAccess) {
          return reply
            .status(403)
            .send({
              error:
                "Từ chối truy cập - người dùng không thuộc lớp bạn phụ trách",
            });
        }
      }

      const userWithRoles = {
        ...user,
        roles: user.roles.map((r) => r.role),
      };

      return withFileUrls(userWithRoles, ["avatarUrl"]);
    },
  );

  // POST /users - Create user (admin only)
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const {
        email,
        password,
        fullName,
        role = "student",
        gender,
        dateOfBirth,
        phone,
        parentName,
        parentPhone,
      } = request.body as any;

      if (!email) {
        return reply.status(400).send({ error: "Yêu cầu email" });
      }

      const existing = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (existing) {
        return reply.status(409).send({ error: "Email đã tồn tại" });
      }

      // Generate a random 16-character string if no password is provided
      const finalPassword = password || Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
      const hashedPassword = await hashPassword(finalPassword);

      const user = await fastify.prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          fullName,
          gender,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : undefined,
          phone,
          parentName,
          parentPhone,
          roles: {
            create: { role },
          },
        },
        include: { roles: true },
      });

      return reply.status(201).send({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        roles: user.roles.map((r) => r.role),
      });
    },
  );

  // PUT /users/:id - Update user (admin only)
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      const {
        fullName,
        isActive,
        role,
        gender,
        dateOfBirth,
        phone,
        parentName,
        parentPhone,
      } = request.body as any;

      const user = await fastify.prisma.user.update({
        where: { id },
        data: {
          ...(fullName !== undefined && { fullName }),
          ...(isActive !== undefined && { isActive }),
          ...(gender !== undefined && { gender }),
          ...(dateOfBirth !== undefined && {
            dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          }),
          ...(phone !== undefined && { phone }),
          ...(parentName !== undefined && { parentName }),
          ...(parentPhone !== undefined && { parentPhone }),
        },
        include: { roles: true },
      });

      // Update role if provided
      if (role) {
        await fastify.prisma.userRole.deleteMany({
          where: { userId: id },
        });
        await fastify.prisma.userRole.create({
          data: { userId: id, role },
        });
      }

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        isActive: user.isActive,
        roles: role ? [role] : user.roles.map((r) => r.role),
      };
    },
  );

  // DELETE /users/:id - Delete user (admin only)
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;
      await fastify.prisma.user.delete({ where: { id } });
      return { success: true };
    },
  );
};

export default usersRoutes;
