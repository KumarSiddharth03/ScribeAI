/**
 * Recording session collection route: authenticated users can create a new
 * session (returning socket token + ids) or list their recent sessions for the
 * dashboard.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signSocketToken } from "@/lib/socket-token";
import type { RecordingSource } from "@prisma/client";

function mapSourceToApi(source: RecordingSource) {
  return source === "tab" ? "tab" : "mic";
}

async function requireSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return session;
}

export async function GET(request: Request) {
  const session = await requireSession(request);
  const recordings = await prisma.recordingSession.findMany({
    where: { userId: session.user.id },
    orderBy: { startedAt: "desc" },
    take: 20,
  });

  const mapped = recordings.map((recording) => ({
    ...recording,
    source: mapSourceToApi(recording.source),
  }));

  return NextResponse.json(mapped);
}

export async function POST(request: Request) {
  const session = await requireSession(request);
  const body = await request.json();

  const title: string = body?.title || `Session ${new Date().toLocaleString()}`;
  const description: string | undefined = body?.description;
  const sourceInput: string = body?.source ?? "mic";
  const normalizedSource = sourceInput === "tab" ? "tab" : "mic";
  const prismaSource: RecordingSource = normalizedSource === "tab" ? "tab" : "microphone";

  const recording = await prisma.recordingSession.create({
    data: {
      title,
      description,
      source: prismaSource,
      status: "idle",
      userId: session.user.id,
    },
  });

  await prisma.statusEvent.create({
    data: {
      sessionId: recording.id,
      status: "idle",
      detail: "Session created",
    },
  });

  const token = signSocketToken({ sessionId: recording.id, userId: session.user.id });

  return NextResponse.json(
    {
      recording: {
        ...recording,
        source: normalizedSource,
      },
      token,
    },
    { status: 201 }
  );
}
