import fp from "fastify-plugin";
import { FastifyPluginAsync } from "fastify";
import jwt from "@fastify/jwt";
import { env } from "../config/env.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      id: string;
      email: string;
      roles: string[];
    };
    user: {
      id: string;
      email: string;
      roles: string[];
    };
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: {
      expiresIn: env.JWT_EXPIRES_IN,
    },
  });
};

export default fp(authPlugin, {
  name: "auth",
});
