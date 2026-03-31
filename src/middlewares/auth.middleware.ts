import { FastifyRequest, FastifyReply } from "fastify";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify();
  } catch (err) {
    return reply
      .status(401)
      .send({ error: "Unauthorized", message: "Invalid or expired token" });
  }
}

export function requireRoles(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();

      const user = request.user as { roles?: string[] };
      const userRoles = Array.isArray(user?.roles) ? user.roles : [];
      const hasRole = userRoles.some((r: string) => roles.includes(r));

      if (!hasRole) {
        return reply.status(403).send({
          error: "Forbidden",
          message: `Required roles: ${roles.join(", ")}`,
        });
      }
    } catch (err) {
      return reply
        .status(401)
        .send({ error: "Unauthorized", message: "Invalid or expired token" });
    }
  };
}
