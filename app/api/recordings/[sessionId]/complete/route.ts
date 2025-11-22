/**
 * Finalizes a recording session: marks status as processing, feeds Gemini the
 * aggregated transcript for summaries, and persists completion metadata.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { summarizeTranscript } from "@/lib/gemini";

async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}

export async function POST(request: Request, { params }: { params: { sessionId: string } }) {
  const { sessionId } = params;
  const session = await requireSession(request);

  const recording = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, transcript: true, status: true, summary: true, summaryVersion: true },
  });

  if (!recording || recording.userId !== session.user.id) {
    return NextResponse.json({ message: "Recording not found" }, { status: 404 });
  }

  await prisma.recordingSession.update({
    where: { id: sessionId },
    data: {
      status: "processing",
    },
  });

  await prisma.statusEvent.create({
    data: {
      sessionId,
      status: "processing",
      detail: "Generating summary",
    },
  });

  let summary = recording.summary ?? "";
  try {
    const transcript = recording.transcript ?? "";
    if (transcript.trim()) {
      summary = await summarizeTranscript(transcript);
    }
  } catch (error) {
    console.error("Summary generation failed", error);
  }

  if (!summary) {
    const transcript = (recording.transcript ?? "").trim();
    if (transcript) {
      const teaser = transcript.split(/\r?\n/).filter(Boolean).slice(0, 2).join(" ");
      summary = teaser || "Summary unavailable";
    } else {
      summary = "Summary unavailable";
    }
  }

  const updated = await prisma.recordingSession.update({
    where: { id: sessionId },
    data: {
      status: "completed",
      completedAt: new Date(),
      summary,
      summaryVersion: recording.summaryVersion + 1,
    },
  });

  await prisma.statusEvent.create({
    data: {
      sessionId,
      status: "completed",
      detail: "Summary ready",
    },
  });

  return NextResponse.json({
    sessionId,
    status: updated.status,
    summary: updated.summary,
    completedAt: updated.completedAt,
  });
}
