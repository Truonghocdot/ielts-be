import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationSchema } from "../schemas/common.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";
import { toFileUrl } from "../utils/file.js";
import {
  getClassStudentIds,
  getTeacherStudentIds,
  isStudentInTeacherClasses,
  isTeacherOfClass,
} from "../utils/teacherScope.js";

const submissionStatusEnum = z.enum(["in_progress", "submitted", "graded"], {
  errorMap: () => ({ message: "Trạng thái bài nộp không hợp lệ" }),
});

const OBJECTIVE_TYPES = new Set([
  "multiple_choice",
  "true_false_not_given",
  "yes_no_not_given",
  "short_answer",
  "fill_blank",
  "listening",
  "matching",
]);

const MANUAL_TYPES = new Set(["essay", "speaking"]);

function getRemainingSeconds(startedAt: Date | null, durationMinutes: number | null) {
  const safeDuration = Math.max(1, durationMinutes || 60);
  if (!startedAt) return safeDuration * 60;

  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return safeDuration * 60;

  const elapsed = Math.floor((Date.now() - startedMs) / 1000);
  return Math.max(0, safeDuration * 60 - Math.max(0, elapsed));
}

const submissionsRoutes: FastifyPluginAsync = async (fastify) => {
  const cleanQuestionData = (q: any, isAdminOrTeacher: boolean) => {
    if (isAdminOrTeacher) return q;
    const cleaned = { ...q };
    if (q.questionType === "matching" && q.correctAnswer) {
      try {
        const config = JSON.parse(q.correctAnswer);
        delete config.pairs;
        cleaned.correctAnswer = JSON.stringify(config);
      } catch {
        cleaned.correctAnswer = null;
      }
    } else {
      cleaned.correctAnswer = null;
    }
    return cleaned;
  };

  // GET /submissions - List submissions (for current user or all for admin/teacher)
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const dataQuery = handleValidation(
      paginationSchema.safeParse(request.query),
      request,
      reply,
    );
    if (!dataQuery) return;

    const { examId, studentId, status, classId } = request.query as any;
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
      let teacherStudentIds: string[] = [];

      if (classId) {
        const owned = await isTeacherOfClass(fastify.prisma, user.id, classId);
        if (!owned) {
          return reply
            .status(403)
            .send({
              error: "Từ chối truy cập - lớp không thuộc quyền quản lý của bạn",
            });
        }
        teacherStudentIds = await getClassStudentIds(fastify.prisma, classId);
      } else {
        teacherStudentIds = await getTeacherStudentIds(fastify.prisma, user.id);
      }

      where.studentId = {
        in: teacherStudentIds.length > 0 ? teacherStudentIds : ["__none__"],
      };
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

    if (isAdmin && classId) {
      const classStudentIds = await getClassStudentIds(fastify.prisma, classId);
      const inClass = classStudentIds.length > 0 ? classStudentIds : ["__none__"];

      if (studentId) {
        where.studentId = classStudentIds.includes(studentId)
          ? studentId
          : "__none__";
      } else {
        where.studentId = { in: inClass };
      }
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
          exam: { select: { id: true, title: true, examType: true, course: { select: { id: true, title: true } } } },
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

  // GET /submissions/latest/:examId - Latest completed submission for current user by exam
  fastify.get<{ Params: { examId: string } }>(
    "/latest/:examId",
    { preHandler: authenticate },
    async (request, reply) => {
      const { examId } = request.params;
      const user = request.user;

      if (!examId) {
        return reply.status(400).send({ error: "Yêu cầu examId" });
      }

      const latestSubmission = await fastify.prisma.examSubmission.findFirst({
        where: {
          examId,
          studentId: user.id,
          status: { in: ["submitted", "graded"] },
        },
        orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          examId: true,
          status: true,
          submittedAt: true,
          totalScore: true,
          correctAnswers: true,
          totalQuestions: true,
        },
      });

      return { data: latestSubmission ?? null };
    },
  );

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
                orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
                include: {
                  questionGroups: {
                    orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
                    include: {
                      questions: {
                        orderBy: [{ orderIndex: "asc" }, { createdAt: "asc" }],
                      },
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

      // Format question data to hide answers if user is a student
      const isAdminOrTeacher = isAdmin || isTeacher;

      const canShowTranscript = submission.status !== "in_progress";
      const formattedExam = {
        ...submission.exam,
        sections: submission.exam.sections.map((section: any) => ({
          ...section,
          audioUrl: toFileUrl(section.audioUrl),
          audioScript: canShowTranscript ? section.audioScript : undefined,
          questionGroups: section.questionGroups.map((group: any) => ({
            ...group,
            audioUrl: toFileUrl(group.audioUrl),
            questions: group.questions.map((q: any) => {
              const formatted = {
                ...q,
                audioUrl: toFileUrl(q.audioUrl),
              };
              return cleanQuestionData(formatted, isAdminOrTeacher);
            }),
          })),
        })),
      };

      const formattedAnswersFinal = formattedAnswers.map((answer: any) => {
        if (!answer.question) return answer;
        return {
          ...answer,
          question: cleanQuestionData(answer.question, isAdminOrTeacher),
        };
      });

      return {
        ...submission,
        exam: formattedExam,
        answers: formattedAnswersFinal,
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

    // IDOR Check: Students must be enrolled unless exam is open
    const isAdmin = user.roles.includes("admin");
    const isTeacher = user.roles.includes("teacher");

    if (!isAdmin && !isTeacher) {
      if (!exam.isActive) {
        return reply.status(403).send({ error: "Bài thi hiện đang bị khóa" });
      }

      if (!exam.isOpen) {
        const enrollment = await fastify.prisma.enrollment.findUnique({
          where: {
            courseId_studentId: {
              courseId: exam.courseId,
              studentId: user.id,
            },
          },
        });

        if (!enrollment) {
          return reply
            .status(403)
            .send({ error: "Bạn chưa đăng ký khóa học này để bắt đầu bài thi" });
        }
      }
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
      const remainingSeconds = getRemainingSeconds(
        existing.startedAt,
        exam.durationMinutes,
      );

      if (remainingSeconds > 0) {
        return {
          ...existing,
          remainingSeconds,
          serverTime: new Date().toISOString(),
        };
      }

      const existingAnswerCount = await fastify.prisma.answer.count({
        where: { submissionId: existing.id },
      });
      if (existingAnswerCount === 0) {
        const resetSubmission = await fastify.prisma.examSubmission.update({
          where: { id: existing.id },
          data: { startedAt: new Date() },
        });
        return {
          ...resetSubmission,
          remainingSeconds: Math.max(1, (exam.durationMinutes || 60) * 60),
          serverTime: new Date().toISOString(),
        };
      }

      // Expired stale attempt: close it to avoid immediate auto-submit loop on client
      await fastify.prisma.examSubmission.update({
        where: { id: existing.id },
        data: {
          status: "submitted",
          submittedAt: new Date(),
        },
      });
    }

    // Open exam participant quota + refresh spam protection.
    // Count a user only once per exam (first time they ever start/submit).
    const hadAnySubmissionBefore = await fastify.prisma.examSubmission.findFirst({
      where: {
        examId,
        studentId: user.id,
      },
      select: { id: true },
    });

    try {
      const submission = await fastify.prisma.$transaction(async (tx) => {
        const inProgress = await tx.examSubmission.findFirst({
          where: {
            examId,
            studentId: user.id,
            status: "in_progress",
          },
        });
        if (inProgress) {
          const remainingSeconds = getRemainingSeconds(
            inProgress.startedAt,
            exam.durationMinutes,
          );
          if (remainingSeconds > 0) {
            return {
              ...inProgress,
              remainingSeconds,
              serverTime: new Date().toISOString(),
            };
          }

          const inProgressAnswerCount = await tx.answer.count({
            where: { submissionId: inProgress.id },
          });
          if (inProgressAnswerCount === 0) {
            const resetSubmission = await tx.examSubmission.update({
              where: { id: inProgress.id },
              data: { startedAt: new Date() },
            });
            return {
              ...resetSubmission,
              remainingSeconds: Math.max(1, (exam.durationMinutes || 60) * 60),
              serverTime: new Date().toISOString(),
            };
          }

          await tx.examSubmission.update({
            where: { id: inProgress.id },
            data: {
              status: "submitted",
              submittedAt: new Date(),
            },
          });
        }

        if (
          exam.isOpen &&
          exam.maxParticipants !== null &&
          !hadAnySubmissionBefore
        ) {
          const updated = await tx.exam.updateMany({
            where: {
              id: exam.id,
              currentParticipants: { lt: exam.maxParticipants },
            },
            data: {
              currentParticipants: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            throw new Error("OPEN_EXAM_FULL");
          }
        }

        const created = await tx.examSubmission.create({
          data: {
            examId,
            studentId: user.id,
            status: "in_progress",
            startedAt: new Date(),
          },
        });

        return {
          ...created,
          remainingSeconds: Math.max(1, (exam.durationMinutes || 60) * 60),
          serverTime: new Date().toISOString(),
        };
      });

      return reply.status(201).send(submission);
    } catch (error: any) {
      if (error?.message === "OPEN_EXAM_FULL") {
        return reply.status(409).send({
          error: "Bài thi mở đã đạt giới hạn người tham gia",
        });
      }
      throw error;
    }

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
        let objectiveScore = 0;
        let hasManualQuestions = false;

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
            hasManualQuestions = allQuestions.some((question) =>
              MANUAL_TYPES.has(question.questionType),
            );

            // Get all submitted answers for this submission
            const submittedAnswers = await fastify.prisma.answer.findMany({
              where: { submissionId: id },
            });
            const answerMap = new Map(
              submittedAnswers.map((a) => [a.questionId, a.answerText])
            );

            for (const question of allQuestions) {
              if (
                !OBJECTIVE_TYPES.has(question.questionType) ||
                !question.correctAnswer
              ) {
                continue;
              }

              totalQuestions++;

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
                    const keys = Object.keys(parsedCorrect);
                    const blankCount = keys.length;

                    if (blankCount === 0) continue;

                    let correctBlanks = 0;

                    for (const key of keys) {
                      const correctVal = String(parsedCorrect[key] || "").trim();
                      const studentVal = String(parsedStudent[key] || "").trim();
                      const alternatives = correctVal
                        .split("|")
                        .map((a: string) => a.trim().toLowerCase());

                      if (alternatives.includes(studentVal.toLowerCase())) {
                        correctBlanks++;
                      }
                    }

                    // Add the number of blanks minus 1 to the total questions, 
                    // since the question itself was already counted as 1.
                    totalQuestions += (blankCount - 1);
                    correctAnswers += correctBlanks;
                    const totalPoints = question.points || 1;
                    const partialScore = (correctBlanks / blankCount) * totalPoints;
                    objectiveScore += partialScore;

                    // Set fractional score based on correct blanks
                    const answerRecord = submittedAnswers.find(a => a.questionId === question.id);
                    if (answerRecord) {
                      await fastify.prisma.answer.update({
                        where: { id: answerRecord.id },
                        data: { score: partialScore },
                      });
                    }
                    continue;
                  }
                } catch {
                  // Not JSON, fall through to string comparison
                }
              }

              // Handle matching with JSON answers
              if (question.questionType === "matching") {
                try {
                  const parsedStudent = JSON.parse(studentAnswer);
                  const parsedCorrect = JSON.parse(correctAnswer);

                  if (
                    typeof parsedStudent === "object" &&
                    typeof parsedCorrect === "object" &&
                    parsedStudent !== null &&
                    parsedCorrect !== null &&
                    parsedCorrect.pairs
                  ) {
                    const keys = Object.keys(parsedCorrect.pairs);
                    const pairsCount = keys.length;

                    if (pairsCount === 0) continue;

                    let correctPairs = 0;

                    for (const key of keys) {
                      const correctVal = String(parsedCorrect.pairs[key] || "").trim();
                      const studentVal = String(parsedStudent[key] || "").trim();

                      if (correctVal === studentVal) {
                        correctPairs++;
                      }
                    }

                    // Add the number of pairs minus 1 to the total questions, 
                    // since the question itself was already counted as 1.
                    totalQuestions += (pairsCount - 1);
                    correctAnswers += correctPairs;
                    const totalPoints = question.points || 1;
                    const partialScore = (correctPairs / pairsCount) * totalPoints;
                    objectiveScore += partialScore;

                    // Set fractional score based on correct pairs
                    const answerRecord = submittedAnswers.find(a => a.questionId === question.id);
                    if (answerRecord) {
                      await fastify.prisma.answer.update({
                        where: { id: answerRecord.id },
                        data: { score: partialScore },
                      });
                    }
                    continue;
                  }
                } catch {
                  // Not JSON, fall through to string comparison
                }
              }

              // Support pipe-delimited alternatives in correctAnswer
              const alternatives = correctAnswer
                .split("|")
                .map((a: string) => a.trim())
                .filter(Boolean);

              let isCorrect = false;
              let questionScore = 0;
              const questionPoints = question.points || 1;

              if (
                (question.questionType === "multiple_choice" ||
                  question.questionType === "listening") &&
                alternatives.length > 1
              ) {
                // Multi-select MCQ/listening answers are stored as JSON arrays.
                // Fallback to comma/pipe strings for backward compatibility.
                let studentSelections: string[] = [];
                try {
                  const parsed = JSON.parse(studentAnswer);
                  if (Array.isArray(parsed)) {
                    studentSelections = parsed.map((v) => String(v).trim());
                  }
                } catch {
                  studentSelections = studentAnswer
                    .split("|")
                    .flatMap((part) => part.split(","))
                    .map((v) => v.trim())
                    .filter(Boolean);
                }

                const normalizedStudent = studentSelections.map((v) => v.toLowerCase());
                const normalizedCorrect = alternatives.map((v) => v.toLowerCase());

                const correctHits = normalizedStudent.filter((v) =>
                  normalizedCorrect.includes(v),
                ).length;
                const wrongSelections = normalizedStudent.filter(
                  (v) => !normalizedCorrect.includes(v),
                ).length;

                // Partial scoring: (hits - wrong) / total_correct, min 0
                const ratio = Math.max(
                  0,
                  (correctHits - wrongSelections) / normalizedCorrect.length,
                );
                questionScore = Math.round(ratio * questionPoints * 100) / 100;
                isCorrect = questionScore >= questionPoints;
              } else {
                isCorrect = alternatives
                  .map((a) => a.toLowerCase())
                  .includes(studentAnswer.trim().toLowerCase());
                questionScore = isCorrect ? questionPoints : 0;
              }

              if (isCorrect) {
                correctAnswers++;
              }

              objectiveScore += questionScore;

              // Set score on the individual answer record
              const answerRecord = submittedAnswers.find(a => a.questionId === question.id);
              if (answerRecord) {
                await fastify.prisma.answer.update({
                  where: { id: answerRecord.id },
                  data: { score: questionScore },
                });
              }
            }

          }
        } catch (gradingError) {
          console.error("[AutoGrade] Error:", gradingError);
        }

        const normalizedObjectiveScore = Math.round(objectiveScore * 100) / 100;
        const finalStatus = hasManualQuestions ? "submitted" : "graded";

        await fastify.prisma.examSubmission.update({
          where: { id: id },
          data: {
            status: finalStatus,
            submittedAt: new Date(),
            correctAnswers,
            totalQuestions,
            totalScore: normalizedObjectiveScore,
            ...(finalStatus === "graded" && { gradedAt: new Date() }),
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
