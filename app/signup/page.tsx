import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignupPanel } from "@/components/auth/signup-panel";
import { auth } from "@/lib/auth";

export default async function SignupPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-10 text-white">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-900/80 bg-slate-900/40 p-8 shadow-2xl shadow-slate-950">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">ScribeAI</p>
            <h1 className="text-4xl font-semibold leading-tight text-white">
              Create an account and<br />start capturing every decision.
            </h1>
            <p className="text-sm text-slate-400">
              Signing up unlocks microphone + tab capture, low-latency Gemini transcripts, Socket.io uploads, and session
              history exports driven by Better Auth.
            </p>
            <ul className="space-y-3 text-sm text-slate-400">
              <li>• Mix mic + tab audio so remote and local voices are stored together.</li>
              <li>• Auto-reconnect safeguards recordings through network hiccups.</li>
              <li>• Summaries highlight key points, action items, and decisions after each session.</li>
            </ul>
            <Link
              href="/login"
              className="inline-flex items-center text-sm font-semibold text-emerald-300 transition hover:text-emerald-200"
            >
              Already registered? Sign in →
            </Link>
          </div>
          <div className="flex justify-center">
            <SignupPanel />
          </div>
        </div>
      </div>
    </main>
  );
}
