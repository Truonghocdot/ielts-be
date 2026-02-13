import { FastifyPluginAsync } from "fastify";
import {
  loginSchema,
  registerSchema,
  googleLoginSchema,
  LoginInput,
  RegisterInput,
  GoogleLoginInput,
} from "../schemas/auth.schema.js";
import { OAuth2Client } from "google-auth-library";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { handleValidation } from "../utils/validation.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /auth/register
  fastify.post<{ Body: RegisterInput }>("/register", async (request, reply) => {
    const data = handleValidation(
      registerSchema.safeParse(request.body),
      request,
      reply,
    );
    if (!data) return;

    const { email, password, fullName } = data;

    // Check if email exists
    const existing = await fastify.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      return reply.status(409).send({ error: "Email đã được đăng ký" });
    }

    // Create user
    const hashedPassword = await hashPassword(password);

    const user = await fastify.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        roles: {
          create: { role: "student" },
        },
      },
      include: { roles: true },
    });

    // Generate token
    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        roles: user.roles.map((r) => r.role),
      },
    };
  });

  // POST /auth/login
  fastify.post<{ Body: LoginInput }>("/login", async (request, reply) => {
    const data = handleValidation(
      loginSchema.safeParse(request.body),
      request,
      reply,
    );
    if (!data) return;

    const { email, password } = data;

    // Find user
    const user = await fastify.prisma.user.findUnique({
      where: { email },
      include: { roles: true },
    });

    if (!user) {
      return reply
        .status(401)
        .send({ error: "Email hoặc mật khẩu không đúng" });
    }

    // Verify password
    const validPassword = await verifyPassword(password, user.password);

    if (!validPassword) {
      return reply
        .status(401)
        .send({ error: "Email hoặc mật khẩu không đúng" });
    }

    if (!user.isActive) {
      return reply.status(403).send({ error: "Tài khoản đã bị hủy kích hoạt" });
    }

    // Generate token
    const token = fastify.jwt.sign({
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
    });

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        roles: user.roles.map((r) => r.role),
      },
    };
  });

  // POST /auth/login/google
  fastify.post<{ Body: GoogleLoginInput }>(
    "/login/google",
    async (request, reply) => {
      const data = handleValidation(
        googleLoginSchema.safeParse(request.body),
        request,
        reply,
      );
      if (!data) return;

      const { credential } = data;
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

      let payload;
      try {
        const ticket = await client.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (error) {
        return reply.status(401).send({ error: "Token Google không hợp lệ" });
      }

      if (!payload || !payload.email) {
        return reply
          .status(400)
          .send({ error: "Payload Token Google không hợp lệ" });
      }

      const { email, name, picture, sub: googleId } = payload;

      // Find user by googleId or email
      let user = await fastify.prisma.user.findFirst({
        where: {
          OR: [{ googleId }, { email }],
        },
        include: { roles: true },
      });

      if (user) {
        // Update googleId if missing
        if (!user.googleId) {
          user = await fastify.prisma.user.update({
            where: { id: user.id },
            data: { googleId, avatarUrl: user.avatarUrl || picture },
            include: { roles: true },
          });
        }
      } else {
        // Create new user
        // Generate random password
        const randomPassword =
          Math.random().toString(36).slice(-8) +
          Math.random().toString(36).slice(-8);
        const hashedPassword = await hashPassword(randomPassword);

        user = await fastify.prisma.user.create({
          data: {
            email,
            password: hashedPassword,
            fullName: name || "User",
            avatarUrl: picture,
            googleId,
            roles: {
              create: { role: "student" },
            },
          },
          include: { roles: true },
        });
      }

      if (!user.isActive) {
        return reply
          .status(403)
          .send({ error: "Tài khoản đã bị hủy kích hoạt" });
      }

      // Generate token
      const token = fastify.jwt.sign({
        id: user.id,
        email: user.email,
        roles: user.roles.map((r) => r.role),
      });

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          roles: user.roles.map((r) => r.role),
        },
      };
    },
  );

  // GET /auth/me
  fastify.get("/me", { preHandler: authenticate }, async (request, reply) => {
    const { id } = request.user;

    const user = await fastify.prisma.user.findUnique({
      where: { id },
      include: { roles: true },
    });

    if (!user) {
      return reply.status(404).send({ error: "Không tìm thấy người dùng" });
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      roles: user.roles.map((r) => r.role),
    };
  });

  // PUT /auth/profile
  fastify.put(
    "/profile",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.user;
      const { fullName, bio, avatarUrl } = request.body as any;

      const user = await fastify.prisma.user.update({
        where: { id },
        data: {
          ...(fullName && { fullName }),
          ...(bio !== undefined && { bio }),
          ...(avatarUrl && { avatarUrl }),
        },
        include: { roles: true },
      });

      return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
        roles: user.roles.map((r) => r.role),
      };
    },
  );

  // POST /auth/change-password
  fastify.post(
    "/change-password",
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.user;
      const { currentPassword, newPassword } = request.body as any;

      if (!currentPassword || !newPassword) {
        return reply
          .status(400)
          .send({ error: "Yêu cầu mật khẩu hiện tại và mật khẩu mới" });
      }

      if (newPassword.length < 6) {
        return reply
          .status(400)
          .send({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return reply.status(404).send({ error: "Không tìm thấy người dùng" });
      }

      const validPassword = await verifyPassword(
        currentPassword,
        user.password,
      );

      if (!validPassword) {
        return reply
          .status(400)
          .send({ error: "Mật khẩu hiện tại không chính xác" });
      }

      const hashedPassword = await hashPassword(newPassword);

      await fastify.prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });

      return { message: "Mật khẩu đã được thay đổi thành công" };
    },
  );
};

export default authRoutes;
