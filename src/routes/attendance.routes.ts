import { FastifyPluginAsync } from "fastify";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { isTeacherOfClass } from "../utils/teacherScope.js";

const parseMonthRange = (month?: string) => {
  const now = new Date();
  let year = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // 1-12
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [yStr, mStr] = month.split("-");
    year = Number(yStr);
    m = Number(mStr);
  }
  const start = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, m, 1, 0, 0, 0));
  return {
    start,
    end,
    monthLabel: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
  };
};

const attendanceRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /attendance/summary/monthly?month=YYYY-MM&classId=optional
  fastify.get(
    "/summary/monthly",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { month, classId } = request.query as {
        month?: string;
        classId?: string;
      };

      const { start, end, monthLabel } = parseMonthRange(month);

      const roles = ((request.user as any).roles || []).map((r: any) =>
        typeof r === "string" ? r : r?.role,
      );
      const isAdmin = roles.includes("admin");
      const userId = (request.user as any).id;

      let classFilter: any = {};
      if (classId) {
        if (!isAdmin) {
          const owned = await isTeacherOfClass(fastify.prisma, userId, classId);
          if (!owned) {
            return reply.status(403).send({ error: "Từ chối truy cập" });
          }
        }
        classFilter = { classId };
      } else if (!isAdmin) {
        // Teacher: only classes they own
        const ownClasses = await fastify.prisma.class.findMany({
          where: { teacherId: userId },
          select: { id: true },
        });
        const ids = ownClasses.map((c) => c.id);
        if (ids.length === 0) {
          return {
            month: monthLabel,
            totalPresent: 0,
            totalAbsent: 0,
            attendanceRate: 0,
          };
        }
        classFilter = { classId: { in: ids } };
      }

      const [presentCount, absentCount] = await Promise.all([
        fastify.prisma.classAttendance.count({
          where: {
            ...classFilter,
            status: "present",
            sessionDate: { gte: start, lt: end },
          },
        }),
        fastify.prisma.classAttendance.count({
          where: {
            ...classFilter,
            status: "absent",
            sessionDate: { gte: start, lt: end },
          },
        }),
      ]);

      const totalCount = presentCount + absentCount;
      const attendanceRate = totalCount > 0 ? presentCount / totalCount : 0;

      return {
        month: monthLabel,
        classId: classId || null,
        totalPresent: presentCount,
        totalAbsent: absentCount,
        attendanceRate,
      };
    },
  );
};

export default attendanceRoutes;
