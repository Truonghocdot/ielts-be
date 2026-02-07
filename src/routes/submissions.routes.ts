import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { paginationSchema } from "../schemas/common.schema.js";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const submissionStatusEnum = z.enum(["in_progress", "submitted", "graded"]);

const submissionsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /submissions - List submissions (for current user or all for admin/teacher)
  fastify.get("/", { preHandler: authenticate }, async (request, reply) => {
    const query = paginationSchema.safeParse(request.query);
    const { examId, studentId, status } = request.query as any;

    if (!query.success) {
      return reply.status(400).send({ error: "Invalid query parameters" });
    }

    const { page, limit, sortBy = "createdAt", sortOrder } = query.data;
    const skip = (page - 1) * limit;
    const user = request.user;

    const where: any = {};

    // Non-admin users can only see their own submissions
    const isAdminOrTeacher =
      user.roles.includes("admin") || user.roles.includes("teacher");
    if (!isAdminOrTeacher) {
      where.studentId = user.id;
    } else if (studentId) {
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
        return reply.status(404).send({ error: "Submission not found" });
      }

      // Check access permission
      const isAdminOrTeacher =
        user.roles.includes("admin") || user.roles.includes("teacher");
      if (!isAdminOrTeacher && submission.studentId !== user.id) {
        return reply.status(403).send({ error: "Access denied" });
      }

      return submission;
    },
  );

  // POST /submissions - Start new exam submission
  fastify.post("/", { preHandler: authenticate }, async (request, reply) => {
    const { examId } = request.body as any;
    const user = request.user;

    if (!examId) {
      return reply.status(400).send({ error: "examId is required" });
    }

    // Check if exam exists and is published
    const exam = await fastify.prisma.exam.findUnique({
      where: { id: examId },
    });

    if (!exam) {
      return reply.status(404).send({ error: "Exam not found" });
    }

    if (!exam.isPublished) {
      return reply.status(400).send({ error: "Exam is not published yet" });
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
        return reply.status(404).send({ error: "Submission not found" });
      }

      if (submission.studentId !== user.id) {
        return reply.status(403).send({ error: "Access denied" });
      }

      if (submission.status !== "in_progress") {
        return reply
          .status(400)
          .send({ error: "Cannot modify a submitted submission" });
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
        await fastify.prisma.examSubmission.update({
          where: { id },
          data: {
            status: "submitted",
            submittedAt: new Date(),
          },
        });
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
        return reply.status(404).send({ error: "Submission not found" });
      }

      if (submission.status === "in_progress") {
        return reply
          .status(400)
          .send({ error: "Submission is still in progress" });
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

      return updated;
    },
  );
};

export default submissionsRoutes;
