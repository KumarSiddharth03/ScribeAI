import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowRight, Mic, Pause, Play, Waves } from "lucide-react";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { RecorderPanel } from "@/components/recorder/recorder-panel";
import { SessionHistory } from "@/components/recordings/session-history";

const statusBadges = [
  { label: "Recording", color: "text-emerald-400", icon: <Mic className="h-4 w-4" /> },
  { label: "Paused", color: "text-amber-400", icon: <Pause className="h-4 w-4" /> },
  { label: "Processing", color: "text-sky-400", icon: <Waves className="h-4 w-4" /> },
  { label: "Completed", color: "text-purple-400", icon: <Play className="h-4 w-4" /> },
];

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const user = session.user;
  const recordings = await prisma.recordingSession.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      title: true,
      status: true,
      source: true,
      startedAt: true,
      completedAt: true,
      summary: true,
      transcript: true,
      events: {
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { startedAt: "desc" },
    take: 30,
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-4 border border-slate-800/60 bg-slate-900/40 px-6 py-5 shadow-2xl shadow-slate-900/50 backdrop-blur lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-slate-400">Welcome back</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">
            {user.name ?? "ScribeAI Operator"}
          </h1>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="#recorder"
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-5 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-400"
          >
            Launch Recorder
            <ArrowRight className="h-4 w-4" />
          </a>
          <SignOutButton />
        </div>
      </header>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="col-span-2 space-y-4 rounded-2xl border border-slate-800/60 bg-slate-900/30 p-6 shadow-inner shadow-slate-950" id="recorder">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Live pipeline</p>
          <h2 className="text-2xl font-semibold text-white">Real-time transcription stream</h2>
          <p className="text-sm text-slate-400">
            Capture microphone or meeting tab audio, auto-chunk every 30 seconds, and persist it with incremental
            Gemini transcripts. The queue + retry machine keeps uploads flowing even when the network hiccups.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-400">
            {statusBadges.map((badge) => (
              <span
                key={badge.label}
                className="inline-flex items-center gap-2 rounded-full border border-slate-800/80 px-4 py-1.5"
              >
                <span className={badge.color}>{badge.icon}</span>
                {badge.label}
              </span>
            ))}
          </div>
          <RecorderPanel />
        </div>
        <SessionHistory recordings={recordings} />
      </section>

      
    </main>
  );
}
