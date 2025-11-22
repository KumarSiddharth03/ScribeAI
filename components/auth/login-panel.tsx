"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Loader2, Mail, Shield } from "lucide-react";

import { signIn } from "@/lib/auth-client";

type LoginPanelProps = {
  allowGoogle: boolean;
  redirectTo?: string;
};

export function LoginPanel({ allowGoogle, redirectTo = "/" }: LoginPanelProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const result = await signIn.email({ email, password });
    if (result.error) {
      const rawMessage = result.error.message ?? "Account not found or password incorrect. Create an account or try again.";
      const errorMessage = rawMessage.replace(/^"|"$/g, "");
      console.error("Sign-in failed:", errorMessage);
      setMessage(errorMessage);
      setIsSubmitting(false);
      return;
    }
    setMessage("Signed in. Redirecting…");
    router.push(redirectTo);
  };

  const handleGoogle = async () => {
    setIsSubmitting(true);
    setMessage(null);
    const result = await signIn.social({ provider: "google" });
    if (result.error) {
      const rawMessage = result.error.message ?? "Google sign-in failed. Try email/password instead.";
      const errorMessage = rawMessage.replace(/^"|"$/g, "");
      console.error("Google sign-in failed:", errorMessage);
      setMessage(errorMessage);
      setIsSubmitting(false);
      return;
    }
    router.push(redirectTo);
  };

  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-800/60 bg-slate-900/40 p-8 shadow-2xl shadow-slate-950">
      <div className="mb-8 space-y-2 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800/60 bg-slate-900">
          <Shield className="h-6 w-6 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold text-white">Sign in to ScribeAI</h1>
        <p className="text-sm text-slate-400">Authenticate to start streaming and storing meeting transcripts.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm text-slate-300">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="alex@company.com"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <label className="block text-sm text-slate-300">
          Password
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-emerald-50 transition disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Continue with email
        </button>
      </form>

      {allowGoogle && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-[0.2em] text-slate-500">
            <span className="h-[1px] flex-1 bg-slate-800" />
            or
            <span className="h-[1px] flex-1 bg-slate-800" />
          </div>
          <button
            onClick={handleGoogle}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800/70 px-4 py-3 text-sm font-semibold text-white transition hover:border-emerald-400/70 disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
              <path
                fill="currentColor"
                d="M21.35 11.1h-9.18v2.92h5.3c-.23 1.48-1.6 4.3-5.3 4.3-3.18 0-5.78-2.64-5.78-5.9s2.6-5.9 5.78-5.9c1.81 0 3.02.77 3.72 1.44l2.54-2.46C16.63 4.06 14.46 3 12.17 3 6.99 3 2.78 7.2 2.78 12.42s4.21 9.42 9.39 9.42c5.42 0 9-3.81 9-9.18 0-.6-.07-1.06-.16-1.56Z"
              />
            </svg>
            Continue with Google
          </button>
        </>
      )}

      {message && <p className="mt-4 text-center text-sm text-slate-400">{message}</p>}
      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?&nbsp;
        <Link href="/signup" className="font-semibold text-emerald-300 hover:text-emerald-200">
          Create one
        </Link>
      </p>
    </div>
  );
}
