import { FastifyPluginAsync } from "fastify";
import { paginationSchema } from "../schemas/common.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { hashPassword } from "../utils/password.js";

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /users - List users (admin/teacher only)
  fastify.get(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const query = paginationSchema.safeParse(request.query);
      const { role } = request.query as any;

      if (!query.success) {
        return reply.status(400).send({ error: "Invalid query parameters" });
      }

      const {
        page,
        limit,
        search,
        sortBy = "createdAt",
        sortOrder,
      } = query.data;
      const skip = (page - 1) * limit;

      const where: any = {};

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

      return {
        data: data.map((u) => ({
          ...u,
          roles: u.roles.map((r) => r.role),
        })),
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
        return reply.status(404).send({ error: "User not found" });
      }

      return {
        ...user,
        roles: user.roles.map((r) => r.role),
      };
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
      } = request.body as any;

      if (!email || !password) {
        return reply
          .status(400)
          .send({ error: "Email and password are required" });
      }

      const existing = await fastify.prisma.user.findUnique({
        where: { email },
      });

      if (existing) {
        return reply.status(409).send({ error: "Email already exists" });
      }

      const hashedPassword = await hashPassword(password);

      const user = await fastify.prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          fullName,
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
      const { fullName, isActive, role } = request.body as any;

      const user = await fastify.prisma.user.update({
        where: { id },
        data: {
          ...(fullName !== undefined && { fullName }),
          ...(isActive !== undefined && { isActive }),
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
