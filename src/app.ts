import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
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
              options: {
                colorize: true,
              },
            }
          : undefined,
    },
  });

  // CORS
  await app.register(cors, {
    origin: env.NODE_ENV === "production" ? env.FRONTEND_URL : true,
    credentials: true,
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // File upload
  await app.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
    },
  });

  // Plugins
  await app.register(authPlugin);
  await app.register(prismaPlugin);

  // API Routes
  await app.register(routes, { prefix: "/api/v1" });

  // Global error handler
  app.setErrorHandler((error, request, reply) => {
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
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: "Route not found",
      statusCode: 404,
    });
  });

  return app;
}
