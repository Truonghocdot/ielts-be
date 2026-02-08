import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { env } from "./config/env.js";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import routes from "./routes/index.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      transport:
        env.NODE_ENV !== "production"
          ? {
              target: "pino-pretty",
              options: { colorize: true },
            }
          : undefined,
    },
  });

  // CORS
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? env.FRONTEND_URL : true,
    credentials: true,
  });

  // File upload (multipart)
  await app.register(multipart, {
    limits: {
      fileSize: parseInt(env.MAX_FILE_SIZE), // 50MB default
    },
  });

  // Ensure upload directory exists
  const uploadDir = join(process.cwd(), env.UPLOAD_DIR);
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  // Serve static files (uploaded files)
  await app.register(staticPlugin, {
    root: uploadDir,
    prefix: "/uploads/",
    decorateReply: false,
  });

  // Plugins
  await app.register(authPlugin);
  await app.register(prismaPlugin);

  // API Routes
  await app.register(routes, { prefix: "/api/v1" });

  // Global error handler
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);

    const statusCode = error.statusCode || 500;
    const message =
      statusCode === 500 ? "Internal Server Error" : error.message;

    reply.status(statusCode).send({
      error: message,
      statusCode,
      ...(env.NODE_ENV !== "production" && { stack: error.stack }),
    });
  });

  // Not found handler
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      error: "Route not found",
      statusCode: 404,
    });
  });

  return app;
}
