import { PrismaClient } from "@prisma/client";

/**
 * Lấy danh sách studentId thuộc các lớp mà teacher phụ trách.
 * Dùng để filter dữ liệu cho teacher chỉ thấy học sinh lớp mình.
 */
export async function getTeacherStudentIds(
  prisma: PrismaClient,
  teacherId: string,
): Promise<string[]> {
  const classStudents = await prisma.classStudent.findMany({
    where: {
      class: {
        teacherId,
      },
    },
    select: {
      studentId: true,
    },
  });

  return [...new Set(classStudents.map((cs) => cs.studentId))];
}

/**
 * Kiểm tra xem teacher có phụ trách lớp có chứa student này không.
 */
export async function isStudentInTeacherClasses(
  prisma: PrismaClient,
  teacherId: string,
  studentId: string,
): Promise<boolean> {
  const count = await prisma.classStudent.count({
    where: {
      studentId,
      class: {
        teacherId,
      },
    },
  });

  return count > 0;
}

/**
 * Kiểm tra teacher có phải chủ lớp không.
 */
export async function isTeacherOfClass(
  prisma: PrismaClient,
  teacherId: string,
  classId: string,
): Promise<boolean> {
  const cls = await prisma.class.findFirst({
    where: {
      id: classId,
      teacherId,
    },
  });

  return !!cls;
}
