import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationSchema } from "../schemas/common.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";
import { toFileUrl } from "../utils/file.js";
import {
  getTeacherStudentIds,
  isStudentInTeacherClasses,
} from "../utils/teacherScope.js";

const submissionStatusEnum = z.enum(["in_progress", "submitted", "graded"], {
  errorMap: () => ({ message: "Trạng thái bài nộp không hợp lệ" }),
});

const submissionsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /submissions - List submissions (for current user or all for admin/teacher)
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const dataQuery = handleValidation(
      paginationSchema.safeParse(request.query),
      request,
      reply,
    );
    if (!dataQuery) return;

    const { examId, studentId, status } = request.query as any;
    const { page, limit, sortBy = "createdAt", sortOrder } = dataQuery;
    const skip = (page - 1) * limit;
    const user = request.user;

    const where: any = {};

    // Role-based filtering
    const isAdmin = user.roles.includes("admin");
    const isTeacher = user.roles.includes("teacher");

    if (!isAdmin && !isTeacher) {
      // Students only see their own submissions
      where.studentId = user.id;
    } else if (isTeacher && !isAdmin) {
      // Teacher: only see submissions from students in their classes
      const teacherStudentIds = await getTeacherStudentIds(
        fastify.prisma,
        user.id,
      );
      where.studentId = { in: teacherStudentIds };
      if (studentId) {
        // Further filter by specific student if requested
        where.studentId = teacherStudentIds.includes(studentId)
          ? studentId
          : "__none__";
      }
    } else if (studentId) {
      // Admin with student filter
      where.studentId = studentId;
    }

    if (examId) where.examId = examId;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      fastify.prisma.examSubmission.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          exam: { select: { id: true, title: true, examType: true } },
          student: { select: { id: true, fullName: true, email: true } },
          grader: { select: { id: true, fullName: true } },
          _count: { select: { answers: true } },
        },
      }),
      fastify.prisma.examSubmission.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  });

  // GET /submissions/:id - Get submission with answers
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const user = request.user;

      const submission = await fastify.prisma.examSubmission.findUnique({
        where: { id },
        include: {
          exam: {
            include: {
              sections: {
                orderBy: { orderIndex: "asc" },
                include: {
                  questionGroups: {
                    orderBy: { orderIndex: "asc" },
                    include: {
                      questions: { orderBy: { orderIndex: "asc" } },
                    },
                  },
                },
              },
            },
          },
          student: { select: { id: true, fullName: true, email: true } },
          grader: { select: { id: true, fullName: true } },
          answers: {
            include: {
              question: true,
            },
          },
        },
      });

      if (!submission) {
        return reply.status(404).send({ error: "Không tìm thấy bài nộp" });
      }

      // Check access permission
      const isAdmin = user.roles.includes("admin");
      const isTeacher = user.roles.includes("teacher");

      if (isTeacher && !isAdmin) {
        // Teacher: check if student belongs to their classes
        const hasAccess = await isStudentInTeacherClasses(
          fastify.prisma,
          user.id,
          submission.studentId,
        );
        if (!hasAccess) {
          return reply
            .status(403)
            .send({
              error:
                "Từ chối truy cập - học sinh không thuộc lớp bạn phụ trách",
            });
        }
      } else if (!isAdmin && submission.studentId !== user.id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      // Format audioUrl in answers
      const formattedAnswers = submission.answers.map((answer) => ({
        ...answer,
        audioUrl: toFileUrl(answer.audioUrl),
      }));

      // Format audioUrl in sections as well
      const formattedSections = submission.exam.sections.map((section) => ({
        ...section,
        audioUrl: toFileUrl(section.audioUrl),
      }));

      return {
        ...submission,
        exam: {
          ...submission.exam,
          sections: formattedSections,
        },
        answers: formattedAnswers,
      };
    },
  );

  // POST /submissions - Start new exam submission
  fastify.post("/", { preHandler: authenticate }, async (request, reply) => {
    const { examId } = request.body as any;
    const user = request.user;

    if (!examId) {
      return reply.status(400).send({ error: "Yêu cầu examId" });
    }

    // Check if exam exists and is published
    const exam = await fastify.prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!exam) {
      return reply.status(404).send({ error: "Không tìm thấy bài thi" });
    }

    if (!exam.isPublished) {
      return reply.status(400).send({ error: "Bài thi chưa được xuất bản" });
    }

    // Check if user already has an in-progress submission
    const existing = await fastify.prisma.examSubmission.findFirst({
      where: {
        examId,
        studentId: user.id,
        status: "in_progress",
      },
    });

    if (existing) {
      return existing; // Return existing in-progress submission
    }

    const submission = await fastify.prisma.examSubmission.create({
      data: {
        examId,
        studentId: user.id,
        status: "in_progress",
      },
    });

    return reply.status(201).send(submission);
  });

  // PUT /submissions/:id - Update submission (submit answers)
  fastify.put<{ Params: { id: string } }>(
    "/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const { answers, submit } = request.body as any;
      const user = request.user;

      const submission = await fastify.prisma.examSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        return reply.status(404).send({ error: "Không tìm thấy bài nộp" });
      }

      if (submission.studentId !== user.id) {
        return reply.status(403).send({ error: "Từ chối truy cập" });
      }

      if (submission.status !== "in_progress") {
        return reply.status(400).send({ error: "Không thể sửa bài đã nộp" });
      }

      // Save answers
      if (answers && Array.isArray(answers)) {
        for (const answer of answers) {
          await fastify.prisma.answer.upsert({
            where: {
              submissionId_questionId: {
                submissionId: id,
                questionId: answer.questionId,
              },
            },
            update: {
              answerText: answer.answerText,
              audioUrl: answer.audioUrl,
            },
            create: {
              submissionId: id,
              questionId: answer.questionId,
              answerText: answer.answerText,
              audioUrl: answer.audioUrl,
            },
          });
        }
      }

      // Submit if requested
      if (submit) {
        // === Auto-grading logic ===
        let correctAnswers = 0;
        let totalQuestions = 0;

        try {
          // Get all questions from the exam
          const examWithQuestions = await fastify.prisma.exam.findUnique({
            where: { id: submission.examId },
            include: {
              sections: {
                include: {
                  questionGroups: {
                    include: {
                      questions: true,
                    },
                  },
                },
              },
            },
          });

          if (examWithQuestions) {
            const allQuestions = examWithQuestions.sections.flatMap((s) =>
              s.questionGroups.flatMap((g) => g.questions)
            );
            totalQuestions = allQuestions.length;

            // Get all submitted answers for this submission
            const submittedAnswers = await fastify.prisma.answer.findMany({
              where: { submissionId: id },
            });
            const answerMap = new Map(
              submittedAnswers.map((a) => [a.questionId, a.answerText])
            );

            // Auto-gradable question types
            const autoGradableTypes = [
              "multiple_choice",
              "true_false_not_given",
              "yes_no_not_given",
              "short_answer",
              "fill_blank",
              "listening",
            ];

            for (const question of allQuestions) {
              if (
                !autoGradableTypes.includes(question.questionType) ||
                !question.correctAnswer
              ) {
                continue;
              }

              const studentAnswer = answerMap.get(question.id);
              if (!studentAnswer) continue;

              const correctAnswer = question.correctAnswer.trim();

              // Handle fill_blank with multiple blanks (JSON format)
              if (question.questionType === "fill_blank") {
                try {
                  const parsedStudent = JSON.parse(studentAnswer);
                  const parsedCorrect = JSON.parse(correctAnswer);

                  if (
                    typeof parsedStudent === "object" &&
                    typeof parsedCorrect === "object" &&
                    parsedStudent !== null &&
                    parsedCorrect !== null
                  ) {
                    // Compare each blank: correct answer may have pipe-delimited alternatives
                    let allCorrect = true;
                    for (const key of Object.keys(parsedCorrect)) {
                      const correctVal = String(parsedCorrect[key] || "").trim();
                      const studentVal = String(
                        parsedStudent[key] || ""
                      ).trim();
                      const alternatives = correctVal
                        .split("|")
                        .map((a: string) => a.trim().toLowerCase());
                      if (!alternatives.includes(studentVal.toLowerCase())) {
                        allCorrect = false;
                        break;
                      }
                    }
                    if (allCorrect) correctAnswers++;
                    continue;
                  }
                } catch {
                  // Not JSON, fall through to string comparison
                }
              }

              // Simple string comparison (case-insensitive, trimmed)
              // Support pipe-delimited alternatives in correctAnswer
              const alternatives = correctAnswer
                .split("|")
                .map((a: string) => a.trim().toLowerCase());
              if (alternatives.includes(studentAnswer.trim().toLowerCase())) {
                correctAnswers++;
              }
            }
          }
        } catch (gradingError) {
          console.error("[AutoGrade] Error:", gradingError);
        }

        await fastify.prisma.examSubmission.update({
          where: { id: id },
          data: {
            status: "submitted",
            submittedAt: new Date(),
            correctAnswers,
            totalQuestions,
          },
        });

        // Tự động cập nhật tiến độ enrollment
        try {
          const exam = await fastify.prisma.exam.findUnique({
            where: { id: submission.examId },
            select: { courseId: true },
          });

          if (exam) {
            const enrollment = await fastify.prisma.enrollment.findFirst({
              where: {
                courseId: exam.courseId,
                studentId: user.id,
              },
            });

            if (enrollment) {
              // 1. Đếm tổng số bài thi đang có trong khóa (Published & Active)
              const totalExams = await fastify.prisma.exam.count({
                where: {
                  courseId: exam.courseId,
                  isPublished: true,
                  isActive: true,
                },
              });

              // 2. Lấy danh sách các ExamId DUY NHẤT mà user này đã nộp trong khóa này
              const uniqueSubmissions =
                await fastify.prisma.examSubmission.groupBy({
                  by: ["examId"],
                  where: {
                    studentId: user.id,
                    status: { in: ["submitted", "graded"] },
                    exam: {
                      courseId: exam.courseId,
                      isPublished: true,
                      isActive: true,
                    },
                  },
                });

              const completedExamsCount = uniqueSubmissions.length;
              const progressPercent =
                totalExams > 0
                  ? Math.round((completedExamsCount / totalExams) * 100)
                  : 0;

              // 3. Cập nhật vào DB
              await fastify.prisma.enrollment.update({
                where: { id: enrollment.id },
                data: { progressPercent },
              });
            } else {
              console.warn(
                `[Progress] No enrollment found for course ${exam.courseId}`,
              );
            }
          }
        } catch (progressError) {
          console.error("[Progress] CRITICAL ERROR:", progressError);
        }
      }

      return fastify.prisma.examSubmission.findUnique({
        where: { id },
        include: { answers: true },
      });
    },
  );

  // POST /submissions/:id/grade - Grade submission (admin/teacher only)
  fastify.post<{ Params: { id: string } }>(
    "/:id/grade",
    { preHandler: [authenticate, requireRoles("admin", "teacher")] },
    async (request, reply) => {
      const { id } = request.params;
      const { grades, totalScore } = request.body as any;
      const user = request.user;

      const submission = await fastify.prisma.examSubmission.findUnique({
        where: { id },
      });

      if (!submission) {
        return reply.status(404).send({ error: "Không tìm thấy bài nộp" });
      }

      // Teacher: check if student belongs to their classes
      const isAdmin = user.roles.includes("admin");
      const isTeacher = user.roles.includes("teacher");
      if (isTeacher && !isAdmin) {
        const hasAccess = await isStudentInTeacherClasses(
          fastify.prisma,
          user.id,
          submission.studentId,
        );
        if (!hasAccess) {
          return reply
            .status(403)
            .send({
              error:
                "Từ chối truy cập - học sinh không thuộc lớp bạn phụ trách",
            });
        }
      }

      if (submission.status === "in_progress") {
        return reply
          .status(400)
          .send({ error: "Bài thi vẫn đang trong quá trình thực hiện" });
      }

      // Update individual answer grades
      if (grades && Array.isArray(grades)) {
        for (const grade of grades) {
          await fastify.prisma.answer.update({
            where: { id: grade.answerId },
            data: {
              score: grade.score,
              feedback: grade.feedback,
            },
          });
        }
      }

      // Update submission
      const updated = await fastify.prisma.examSubmission.update({
        where: { id },
        data: {
          status: "graded",
          totalScore: totalScore,
          gradedBy: user.id,
          gradedAt: new Date(),
        },
        include: {
          answers: true,
          student: { select: { id: true, fullName: true, email: true } },
        },
      });

      const formattedAnswers = updated.answers.map((answer) => ({
        ...answer,
        audioUrl: toFileUrl(answer.audioUrl),
      }));

      return {
        ...updated,
        answers: formattedAnswers,
      };
    },
  );
};

export default submissionsRoutes;
