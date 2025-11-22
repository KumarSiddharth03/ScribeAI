"use client";

import { createAuthClient } from "better-auth/react";

const baseURL = process.env.NEXT_PUBLIC_APP_URL;

export const authClient = createAuthClient({
  baseURL,
});

export const { useSession, signIn, signOut, signUp } = authClient;
