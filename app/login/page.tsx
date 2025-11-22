import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginPanel } from "@/components/auth/login-panel";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/");
  }

  const allowGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-6 py-10 text-white">
      <div className="w-full max-w-5xl rounded-3xl border border-slate-900/80 bg-slate-900/40 p-8 shadow-2xl shadow-slate-950">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="space-y-6">
            <p className="text-xs font-semibold uppercase tracking-[0.35em] text-emerald-400">
              ScribeAI
            </p>
            <h1 className="text-4xl font-semibold leading-tight text-white">
              Capture every decision,<br />without taking your hands off the meeting.
            </h1>
            <p className="text-sm text-slate-400">
              Seamlessly record microphone input or shared tab audio, stream 30-second chunks to Gemini via Socket.io,
              and store transcripts in Postgres with Better Auth-protected controls.
            </p>
            <ul className="space-y-3 text-sm text-slate-400">
              <li>• Toggle mic vs. tab capture with browser prompts just like Meet or Zoom.</li>
              <li>• Low-latency diarized transcripts with pause/resume powered by XState.</li>
              <li>• On stop, ScribeAI rolls up summaries with action items and download links.</li>
            </ul>
            <Link
              href="/"
              className="inline-flex items-center text-sm font-semibold text-emerald-300 transition hover:text-emerald-200"
            >
              Learn more on the roadmap →
            </Link>
          </div>
          <div className="flex justify-center">
            <LoginPanel allowGoogle={allowGoogle} />
          </div>
        </div>
      </div>
    </main>
  );
}
