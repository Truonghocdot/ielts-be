import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { paginationSchema } from "../schemas/common.schema.js";
import { isTeacherOfClass } from "../utils/teacherScope.js";

const createClassSchema = z.object({
  name: z.string().min(1, "Tên lớp là bắt buộc"),
  description: z.string().optional(),
  teacherId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

const updateClassSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  teacherId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

const addStudentsSchema = z.object({
  studentIds: z.array(z.string()).min(1, "Cần ít nhất 1 học sinh"),
});

const normalizeAttendanceStatus = (
  status: string | null | undefined,
): "present" | "absent" | "inactive" => {
  if (status === "present") return "present";
  if (status === "inactive") return "inactive";
  return "absent";
};

const classScheduleSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  durationMinutes: z.number().int().min(15).max(600),
  timezone: z.string().min(1).max(64).default("Asia/Ho_Chi_Minh"),
  isActive: z.boolean().optional().default(true),
});

const classAttendanceUpsertSchema = z.object({
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  records: z.array(
    z.object({
      studentId: z.string().min(1),
      status: z.enum(["present", "absent", "inactive"]),
      note: z.string().max(500).optional().nullable(),
    }),
  ),
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

      // Teacher: verify ownership
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin && classData.teacherId !== (request.user as any).id) {
        return reply
          .status(403)
          .send({
            error: "Từ chối truy cập - lớp không thuộc quyền quản lý của bạn",
          });
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

      const {
        name,
        description,
        teacherId,
        startDate,
        endDate,
        isActive,
      } = parsed.data;

      if (startDate && endDate) {
        const startTime = new Date(startDate).getTime();
        const endTime = new Date(endDate).getTime();
        if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
          if (startTime > endTime) {
            return reply
              .status(400)
              .send({ error: "Ngày bắt đầu không được lớn hơn ngày kết thúc" });
          }
        }
      }

      const classData = await fastify.prisma.class.create({
        data: {
          name,
          description,
          teacherId: teacherId || (request.user as any).id,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
          isActive,
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

      // Teacher: verify ownership
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin && existing.teacherId !== (request.user as any).id) {
        return reply
          .status(403)
          .send({
            error: "Từ chối truy cập - lớp không thuộc quyền quản lý của bạn",
          });
      }

      const updateData: any = { ...parsed.data };
      if (updateData.startDate !== undefined) {
        updateData.startDate = updateData.startDate
          ? new Date(updateData.startDate)
          : null;
      }
      if (updateData.endDate !== undefined) {
        updateData.endDate = updateData.endDate
          ? new Date(updateData.endDate)
          : null;
      }

      const effectiveStart =
        updateData.startDate !== undefined
          ? updateData.startDate
          : existing.startDate;
      const effectiveEnd =
        updateData.endDate !== undefined ? updateData.endDate : existing.endDate;

      if (effectiveStart && effectiveEnd) {
        const startTime = new Date(effectiveStart).getTime();
        const endTime = new Date(effectiveEnd).getTime();
        if (Number.isFinite(startTime) && Number.isFinite(endTime)) {
          if (startTime > endTime) {
            return reply
              .status(400)
              .send({ error: "Ngày bắt đầu không được lớn hơn ngày kết thúc" });
          }
        }
      }

      const classData = await fastify.prisma.class.update({
        where: { id },
        data: updateData,
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

      // Teacher: verify ownership
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin && existing.teacherId !== (request.user as any).id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
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

      // Teacher: verify ownership
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin) {
        const classData = await fastify.prisma.class.findUnique({
          where: { id },
        });
        if (!classData || classData.teacherId !== (request.user as any).id) {
          return reply.status(403).send({ error: "Từ chối truy cập" });
        }
      }

      await fastify.prisma.classStudent.deleteMany({
        where: {
          classId: id,
          studentId,
        },
      });

      return { success: true };
    },
  );

  // GET /classes/:id/schedules - Danh sách lịch học lặp lại
  fastify.get<{ Params: { id: string } }>(
    "/:id/schedules",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;

      const classData = await fastify.prisma.class.findUnique({
        where: { id },
        select: { id: true, teacherId: true },
      });
      if (!classData) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const roles = ((request.user as any).roles || []).map((r: any) =>
        typeof r === "string" ? r : r?.role,
      );
      const isAdmin = roles.includes("admin");
      if (!isAdmin && classData.teacherId !== (request.user as any).id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      const rows = await fastify.prisma.$queryRaw<
        Array<{
          id: string;
          class_id: string;
          day_of_week: number;
          start_time: string;
          duration_minutes: number;
          timezone: string;
          is_active: number | boolean;
          created_at: Date;
          updated_at: Date;
        }>
      >(Prisma.sql`
        SELECT id, class_id, day_of_week, start_time, duration_minutes, timezone, is_active, created_at, updated_at
        FROM class_schedules
        WHERE class_id = ${id}
        ORDER BY day_of_week ASC, start_time ASC
      `);

      return {
        data: rows.map((r) => ({
          id: r.id,
          classId: r.class_id,
          dayOfWeek: r.day_of_week,
          startTime: r.start_time,
          durationMinutes: r.duration_minutes,
          timezone: r.timezone,
          isActive: Boolean(r.is_active),
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    },
  );

  // POST /classes/:id/schedules - Tạo lịch học
  fastify.post<{ Params: { id: string } }>(
    "/:id/schedules",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = classScheduleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Dữ liệu lịch học không hợp lệ",
          details: parsed.error.flatten(),
        });
      }

      const classData = await fastify.prisma.class.findUnique({
        where: { id },
        select: { id: true, teacherId: true },
      });
      if (!classData) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const roles = ((request.user as any).roles || []).map((r: any) =>
        typeof r === "string" ? r : r?.role,
      );
      const isAdmin = roles.includes("admin");
      if (!isAdmin && classData.teacherId !== (request.user as any).id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      const scheduleId = randomUUID();
      const { dayOfWeek, startTime, durationMinutes, timezone, isActive } =
        parsed.data;

      // Prevent duplicate (same class + dayOfWeek + startTime)
      const duplicate = await fastify.prisma.classSchedule.findFirst({
        where: { classId: id, dayOfWeek, startTime },
        select: { id: true },
      });
      if (duplicate) {
        return reply.status(409).send({
          error: "Lịch học đã tồn tại (trùng ngày và giờ bắt đầu)",
        });
      }

      await fastify.prisma.$executeRaw(Prisma.sql`
        INSERT INTO class_schedules (
          id, class_id, day_of_week, start_time, duration_minutes, timezone, is_active
        ) VALUES (
          ${scheduleId}, ${id}, ${dayOfWeek}, ${startTime}, ${durationMinutes}, ${timezone}, ${isActive}
        )
      `);

      return reply.status(201).send({
        id: scheduleId,
        classId: id,
        dayOfWeek,
        startTime,
        durationMinutes,
        timezone,
        isActive,
      });
    },
  );

  // DELETE /classes/:id/schedules/:scheduleId - Xóa lịch học
  fastify.delete<{ Params: { id: string; scheduleId: string } }>(
    "/:id/schedules/:scheduleId",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id, scheduleId } = request.params;
      const userId = (request.user as any).id;

      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin) {
        const owned = await isTeacherOfClass(fastify.prisma, userId, id);
        if (!owned) {
          return reply.status(403).send({ error: "Từ chối truy cập" });
        }
      }

      await fastify.prisma.$executeRaw(Prisma.sql`
        DELETE FROM class_schedules
        WHERE id = ${scheduleId} AND class_id = ${id}
      `);

      return { success: true };
    },
  );

  // GET /classes/:id/attendance?sessionDate=YYYY-MM-DD
  fastify.get<{ Params: { id: string }; Querystring: { sessionDate?: string } }>(
    "/:id/attendance",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const sessionDate =
        request.query.sessionDate ||
        new Date().toISOString().slice(0, 10);

      const classData = await fastify.prisma.class.findUnique({
        where: { id },
        include: {
          students: {
            include: {
              student: {
                select: { id: true, fullName: true, email: true, avatarUrl: true },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
        },
      });
      if (!classData) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const roles = ((request.user as any).roles || []).map((r: any) =>
        typeof r === "string" ? r : r?.role,
      );
      const isAdmin = roles.includes("admin");
      if (!isAdmin && classData.teacherId !== (request.user as any).id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      const attendanceRows = await fastify.prisma.$queryRaw<
        Array<{ student_id: string; status: string; note: string | null }>
      >(Prisma.sql`
        SELECT student_id, status, note
        FROM class_attendance
        WHERE class_id = ${id} AND session_date = ${sessionDate}
      `);

      const byStudent = new Map(
        attendanceRows.map((r) => [
          r.student_id,
          { status: normalizeAttendanceStatus(r.status), note: r.note },
        ]),
      );

      return {
        classId: id,
        sessionDate,
        students: (classData.students || []).map((cs: any) => ({
          studentId: cs.studentId,
          fullName: cs.student?.fullName || "Chưa đặt tên",
          email: cs.student?.email || "",
          avatarUrl: cs.student?.avatarUrl || null,
          status: byStudent.get(cs.studentId)?.status || null,
          note: byStudent.get(cs.studentId)?.note || "",
        })),
      };
    },
  );

  // PUT /classes/:id/attendance - Upsert điểm danh theo buổi
  fastify.put<{ Params: { id: string } }>(
    "/:id/attendance",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const parsed = classAttendanceUpsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Dữ liệu điểm danh không hợp lệ",
          details: parsed.error.flatten(),
        });
      }

      const userId = (request.user as any).id;
      const userRoles = (request.user as any).roles || [];
      const isAdmin = userRoles.some(
        (r: any) => r.role === "admin" || r === "admin",
      );
      if (!isAdmin) {
        const owned = await isTeacherOfClass(fastify.prisma, userId, id);
        if (!owned) {
          return reply.status(403).send({ error: "Từ chối truy cập" });
        }
      }

      const { sessionDate, records } = parsed.data;

      await fastify.prisma.$transaction(
        records.map((record) =>
          fastify.prisma.$executeRaw(Prisma.sql`
            INSERT INTO class_attendance (
              id, class_id, student_id, session_date, status, note, marked_by
            ) VALUES (
              ${randomUUID()}, ${id}, ${record.studentId}, ${sessionDate}, ${record.status}, ${record.note || null}, ${userId}
            )
            ON DUPLICATE KEY UPDATE
              status = VALUES(status),
              note = VALUES(note),
              marked_by = VALUES(marked_by),
              updated_at = CURRENT_TIMESTAMP
          `),
        ),
      );

      return { success: true, updated: records.length };
    },
  );

  // GET /classes/:id/attendance/history - Lịch sử + thống kê chuyên cần
  fastify.get<{ Params: { id: string } }>(
    "/:id/attendance/history",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;

      const classData = await fastify.prisma.class.findUnique({
        where: { id },
        include: {
          students: {
            include: {
              student: {
                select: { id: true, fullName: true, email: true, avatarUrl: true },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
        },
      });
      if (!classData) {
        return reply.status(404).send({ error: "Không tìm thấy lớp học" });
      }

      const roles = ((request.user as any).roles || []).map((r: any) =>
        typeof r === "string" ? r : r?.role,
      );
      const isAdmin = roles.includes("admin");
      if (!isAdmin && classData.teacherId !== (request.user as any).id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      const dateRows = await fastify.prisma.classAttendance.findMany({
        where: { classId: id },
        select: { sessionDate: true },
        distinct: ["sessionDate"],
        orderBy: { sessionDate: "asc" },
      });

      const sessionDates = dateRows.map((d) =>
        d.sessionDate.toISOString().slice(0, 10),
      );

      const attendanceRows = await fastify.prisma.classAttendance.findMany({
        where: { classId: id },
        select: {
          studentId: true,
          sessionDate: true,
          status: true,
        },
      });

      const recordsByStudent: Record<
        string,
        Record<string, "present" | "absent" | "inactive">
      > = {};
      attendanceRows.forEach((row) => {
        const dateKey = row.sessionDate.toISOString().slice(0, 10);
        if (!recordsByStudent[row.studentId]) {
          recordsByStudent[row.studentId] = {};
        }
        recordsByStudent[row.studentId][dateKey] = normalizeAttendanceStatus(
          row.status,
        );
      });

      const students = (classData.students || []).map((cs: any) => {
        const statusMap = recordsByStudent[cs.studentId] || {};
        let present = 0;
        let absent = 0;
        Object.values(statusMap).forEach((status) => {
          if (status === "present") present += 1;
          else if (status === "absent") absent += 1;
        });
        const totalCount = present + absent;
        const attendanceRate = totalCount > 0 ? present / totalCount : 0;
        return {
          studentId: cs.studentId,
          fullName: cs.student?.fullName || "Chưa đặt tên",
          email: cs.student?.email || "",
          avatarUrl: cs.student?.avatarUrl || null,
          statuses: statusMap,
          summary: {
            present,
            absent,
            attendanceRate,
            isEligible: attendanceRate >= 0.8,
          },
        };
      });

      return {
        classId: id,
        sessionDates,
        students,
      };
    },
  );
};

export default classesRoutes;
