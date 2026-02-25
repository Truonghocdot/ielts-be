import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { paginationSchema } from "../schemas/common.schema.js";

const createClassSchema = z.object({
  name: z.string().min(1, "Tên lớp là bắt buộc"),
  description: z.string().optional(),
  teacherId: z.string().optional(),
});

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  teacherId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const addStudentsSchema = z.object({
  studentIds: z.array(z.string()).min(1, "Cần ít nhất 1 học sinh"),
});

const classesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /classes - Danh sách lớp (admin/teacher)
  fastify.get(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const query = paginationSchema.safeParse(request.query);
      if (!query.success) {
        return reply
          .status(400)
          .send({ error: "Tham số truy vấn không hợp lệ" });
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
        where.name = { contains: search };
      }

      // Teacher chỉ thấy lớp của mình
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin) {
        where.teacherId = (request.user as any).id;
      }

      const [data, total] = await Promise.all([
        fastify.prisma.class.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          include: {
            teacher: {
              select: { id: true, fullName: true, email: true },
            },
            _count: {
              select: { students: true },
            },
          },
        }),
        fastify.prisma.class.count({ where }),
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
    },
  );

  // GET /classes/:id - Chi tiết lớp
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;

      const classData = await fastify.prisma.class.findUnique({
        where: { id },
        include: {
          teacher: {
            select: { id: true, fullName: true, email: true },
          },
          students: {
            include: {
              student: {
                select: {
                  id: true,
                  fullName: true,
                  email: true,
                  avatarUrl: true,
                },
              },
            },
            orderBy: { joinedAt: "desc" },
          },
        },
      });

      if (!classData) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      return classData;
    },
  );

  // POST /classes - Tạo lớp mới
  fastify.post(
    "/",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const parsed = createClassSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Dữ liệu không hợp lệ",
          details: parsed.error.flatten(),
        });
      }

      const { name, description, teacherId } = parsed.data;

      const classData = await fastify.prisma.class.create({
        data: {
          name,
          description,
          teacherId: teacherId || (request.user as any).id,
        },
        include: {
          teacher: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      return reply.status(201).send(classData);
    },
  );

  // PUT /classes/:id - Cập nhật lớp
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = updateClassSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Dữ liệu không hợp lệ",
          details: parsed.error.flatten(),
        });
      }

      const existing = await fastify.prisma.class.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const classData = await fastify.prisma.class.update({
        where: { id },
        data: parsed.data,
        include: {
          teacher: {
            select: { id: true, fullName: true, email: true },
          },
        },
      });

      return classData;
    },
  );

  // DELETE /classes/:id - Xoá lớp
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { id } = request.params;

      await fastify.prisma.class.delete({ where: { id } });
      return { success: true };
    },
  );

  // POST /classes/:id/students - Thêm học sinh vào lớp
  fastify.post<{ Params: { id: string } }>(
    "/:id/students",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = addStudentsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Dữ liệu không hợp lệ",
          details: parsed.error.flatten(),
        });
      }

      const existing = await fastify.prisma.class.findUnique({
        where: { id },
      });
      if (!existing) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const { studentIds } = parsed.data;

      // Dùng createMany với skipDuplicates để tránh lỗi unique
      const result = await fastify.prisma.classStudent.createMany({
        data: studentIds.map((studentId) => ({
          classId: id,
          studentId,
        })),
        skipDuplicates: true,
      });

      return { success: true, added: result.count };
    },
  );

  // DELETE /classes/:id/students/:studentId - Xoá học sinh khỏi lớp
  fastify.delete<{ Params: { id: string; studentId: string } }>(
    "/:id/students/:studentId",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id, studentId } = request.params;

      await fastify.prisma.classStudent.deleteMany({
        where: {
          classId: id,
          studentId,
        },
      });

      return { success: true };
    },
  );
};

export default classesRoutes;
