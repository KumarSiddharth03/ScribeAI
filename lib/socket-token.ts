/**
 * Utility for HMAC-signing socket tokens so the relay can authenticate clients
 * without sharing Better Auth secrets directly with browsers.
 */
import crypto from "crypto";

import { env } from "@/lib/env";

const SOCKET_TOKEN_TTL_MS = 1000 * 60 * 60; // 1 hour

interface SocketTokenPayload {
  sessionId: string;
  userId: string;
  exp: number;
}

const SECRET = env.BETTER_AUTH_SECRET;

function encode(payload: SocketTokenPayload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decode(token: string): SocketTokenPayload {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

export function signSocketToken(params: { sessionId: string; userId: string }) {
  const payload: SocketTokenPayload = {
    sessionId: params.sessionId,
    userId: params.userId,
    exp: Date.now() + SOCKET_TOKEN_TTL_MS,
  };

  const body = encode(payload);
  const signature = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifySocketToken(token: string) {
  if (!token?.includes(".")) {
    throw new Error("Invalid token format");
  }

  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new Error("Invalid token signature");
  }

  const payload = decode(body);
  if (payload.exp < Date.now()) {
    throw new Error("Token expired");
  }

  return payload;
}
