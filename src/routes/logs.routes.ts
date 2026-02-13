import { FastifyPluginAsync } from "fastify";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const logsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /log-viewer - View server logs (admin only)
  fastify.get(
    "/log-viewer",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const logFile = join(process.cwd(), "logs/app.log");

      if (!existsSync(logFile)) {
        return reply.status(404).send({ error: "Log file not found" });
      }

      try {
        const content = readFileSync(logFile, "utf-8");
        // Return as text for better readability
        return reply.type("text/plain").send(content);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: "Failed to read log file" });
      }
    },
  );

  // GET /log-viewer/last - View last N lines of logs
  fastify.get(
    "/log-viewer/last",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const { lines = "100" } = request.query as { lines?: string };
      const n = parseInt(lines);
      const logFile = join(process.cwd(), "logs/app.log");

      if (!existsSync(logFile)) {
        return reply.status(404).send({ error: "Log file not found" });
      }

      try {
        const content = readFileSync(logFile, "utf-8");
        const allLines = content.split("\n");
        const lastLines = allLines.slice(-n).join("\n");
        return reply.type("text/plain").send(lastLines);
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: "Failed to read log file" });
      }
    },
  );
};

export default logsRoutes;
