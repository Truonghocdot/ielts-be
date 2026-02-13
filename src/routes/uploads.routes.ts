import { FastifyPluginAsync, FastifyRequest } from "fastify";
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, extname } from "path";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import { authenticate } from "../middlewares/auth.middleware.js";
import { env } from "../config/env.js";

// Allowed file types
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
];
const ALLOWED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_AUDIO_TYPES];

// Get upload directory path
function getUploadDir(subDir?: string): string {
  const baseDir = join(process.cwd(), env.UPLOAD_DIR);
  const targetDir = subDir ? join(baseDir, subDir) : baseDir;

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  return targetDir;
}

// Generate unique filename
function generateFileName(originalName: string): string {
  const ext = extname(originalName);
  return `${Date.now()}-${randomUUID()}${ext}`;
}

const uploadsRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /uploads - Upload single file
  fastify.post(
    "/",
    { preHandler: authenticate },
    async (request: FastifyRequest, reply) => {
      const data = await (request as any).file();

      if (!data) {
        return reply
          .status(400)
          .send({ error: "Không có tệp nào được tải lên" });
      }

      // Check file type
      if (!ALLOWED_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          error: "Loại tệp không hợp lệ",
          allowedTypes: ALLOWED_TYPES,
        });
      }

      // Determine subdirectory based on file type
      const isImage = ALLOWED_IMAGE_TYPES.includes(data.mimetype);
      const subDir = isImage ? "images" : "audio";

      const uploadDir = getUploadDir(subDir);
      const fileName = generateFileName(data.filename);
      const filePath = join(uploadDir, fileName);

      try {
        // Save file
        await pipeline(data.file, createWriteStream(filePath));

        // Generate URL
        const url = `/uploads/${subDir}/${fileName}`;

        return {
          url,
          fileName,
          mimeType: data.mimetype,
          size: data.file.bytesRead,
        };
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: "Tải tệp lên thất bại" });
      }
    },
  );

  // POST /uploads/image - Upload image specifically
  fastify.post(
    "/image",
    { preHandler: authenticate },
    async (request: FastifyRequest, reply) => {
      const data = await (request as any).file();

      if (!data) {
        return reply
          .status(400)
          .send({ error: "Không có tệp nào được tải lên" });
      }

      if (!ALLOWED_IMAGE_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          error: "Loại hình ảnh không hợp lệ",
          allowedTypes: ALLOWED_IMAGE_TYPES,
        });
      }

      const uploadDir = getUploadDir("images");
      const fileName = generateFileName(data.filename);
      const filePath = join(uploadDir, fileName);

      try {
        await pipeline(data.file, createWriteStream(filePath));

        return {
          url: `/uploads/images/${fileName}`,
          fileName,
          mimeType: data.mimetype,
        };
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: "Tải tệp lên thất bại" });
      }
    },
  );

  // POST /uploads/audio - Upload audio specifically
  fastify.post(
    "/audio",
    { preHandler: authenticate },
    async (request: FastifyRequest, reply) => {
      const data = await (request as any).file();

      if (!data) {
        return reply
          .status(400)
          .send({ error: "Không có tệp nào được tải lên" });
      }

      if (!ALLOWED_AUDIO_TYPES.includes(data.mimetype)) {
        return reply.status(400).send({
          error: "Loại âm thanh không hợp lệ",
          allowedTypes: ALLOWED_AUDIO_TYPES,
        });
      }

      const uploadDir = getUploadDir("audio");
      const fileName = generateFileName(data.filename);
      const filePath = join(uploadDir, fileName);

      try {
        await pipeline(data.file, createWriteStream(filePath));

        return {
          url: `/uploads/audio/${fileName}`,
          fileName,
          mimeType: data.mimetype,
        };
      } catch (err) {
        fastify.log.error(err);
        return reply.status(500).send({ error: "Failed to upload file" });
      }
    },
  );

  // DELETE /uploads - Delete file
  fastify.delete("/", { preHandler: authenticate }, async (request, reply) => {
    const { url } = request.body as { url?: string };

    if (!url) {
      return reply.status(400).send({ error: "Yêu cầu URL" });
    }

    // Parse file path from URL
    const match = url.match(/\/uploads\/(images|audio)\/(.+)/);
    if (!match) {
      return reply.status(400).send({ error: "URL tệp không hợp lệ" });
    }

    const [, subDir, fileName] = match;
    const filePath = join(getUploadDir(subDir), fileName);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return { success: true, message: "Đã xóa tệp" };
      } else {
        return reply.status(404).send({ error: "Không tìm thấy tệp" });
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: "Xóa tệp thất bại" });
    }
  });
};

export default uploadsRoutes;
