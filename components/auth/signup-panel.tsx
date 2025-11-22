"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Loader2, Mail, Shield } from "lucide-react";

import { signIn, signUp } from "@/lib/auth-client";

export function SignupPanel() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    if (!passwordPolicy.test(password)) {
      setMessage("Password must be at least 8 characters and include one number and one symbol.");
      return;
    }
    setIsSubmitting(true);
    setMessage(null);

    try {
      await signUp.email({ email, password, name });
      await signIn.email({ email, password });
      setMessage("Account created. Redirecting…");
      router.push("/");
    } catch (error) {
      console.error(error);
      setMessage("Unable to create account. Try again or sign in if you already registered.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-3xl border border-slate-800/60 bg-slate-900/40 p-8 shadow-2xl shadow-slate-950">
      <div className="mb-8 space-y-2 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-slate-800/60 bg-slate-900">
          <Shield className="h-6 w-6 text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold text-white">Create your ScribeAI account</h1>
        <p className="text-sm text-slate-400">Sign up with email/password so you can start recording and summarizing meetings.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm text-slate-300">
          Full name
          <input
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Alex Doe"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
        </label>
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
          Password <span className="text-xs text-slate-500">(≥8 chars, include a number & symbol)</span>
          <input
            type="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            minLength={8}
          />
        </label>
        <label className="block text-sm text-slate-300">
          Confirm password
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="••••••••"
            className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            minLength={8}
          />
        </label>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500/90 px-4 py-3 text-sm font-semibold text-emerald-50 transition disabled:opacity-60"
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Create account
        </button>
      </form>

      {message && <p className="mt-4 text-center text-sm text-slate-400">{message}</p>}
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?&nbsp;
        <Link href="/login" className="font-semibold text-emerald-300 hover:text-emerald-200">
          Sign in
        </Link>
      </p>
    </div>
  );
}
