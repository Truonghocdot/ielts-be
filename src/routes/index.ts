import { FastifyPluginAsync } from "fastify";

import authRoutes from "./auth.routes.js";
import coursesRoutes from "./courses.routes.js";
import examsRoutes from "./exams.routes.js";
import sectionsRoutes from "./sections.routes.js";
import questionsRoutes from "./questions.routes.js";
import submissionsRoutes from "./submissions.routes.js";
import usersRoutes from "./users.routes.js";
import enrollmentsRoutes from "./enrollments.routes.js";

const routes: FastifyPluginAsync = async (fastify) => {
  // Health check
  fastify.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    };
  });

  // Register all routes with prefixes
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(coursesRoutes, { prefix: "/courses" });
  await fastify.register(examsRoutes, { prefix: "/exams" });
  await fastify.register(sectionsRoutes, { prefix: "/sections" });
  await fastify.register(questionsRoutes, { prefix: "/questions" });
  await fastify.register(submissionsRoutes, { prefix: "/submissions" });
  await fastify.register(usersRoutes, { prefix: "/users" });
  await fastify.register(enrollmentsRoutes, { prefix: "/enrollments" });
};

export default routes;
