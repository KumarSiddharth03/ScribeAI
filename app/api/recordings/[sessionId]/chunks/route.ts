/**
 * Handles authenticated chunk uploads: stores audio bytes, calls Gemini for
 * diarized text, and appends transcript context to the recording session.
 */
import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { transcribeChunk } from "@/lib/gemini";

interface ChunkPayload {
  chunk: string;
  index: number;
  durationMs: number;
  mimeType?: string;
}

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
  const body: ChunkPayload = await request.json();

  if (!body?.chunk) {
    return NextResponse.json({ message: "Missing chunk data" }, { status: 400 });
  }

  const recording = await prisma.recordingSession.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, transcript: true, status: true },
  });

  if (!recording || recording.userId !== session.user.id) {
    return NextResponse.json({ message: "Recording not found" }, { status: 404 });
  }

  const order = Number(body.index ?? 0);
  const durationMs = Number(body.durationMs ?? 0);
  const mimeType = body.mimeType ?? "audio/webm;codecs=opus";

  const chunkBuffer = Buffer.from(body.chunk, "base64");

  const createdChunk = await prisma.audioChunk.create({
    data: {
      sessionId,
      order,
      durationMs,
      mimeType,
      bytes: chunkBuffer,
    },
  });

  let transcriptText = "";
  try {
    const transcription = await transcribeChunk(body.chunk, { context: recording.transcript ?? "" });
    transcriptText = transcription.text?.trim() ?? "";
  } catch (error) {
    console.error("Gemini transcription failed", error);
  }

  if (transcriptText) {
    await prisma.audioChunk.update({
      where: { id: createdChunk.id },
      data: { transcript: transcriptText },
    });
  }

  const updatedTranscript = transcriptText
    ? [recording.transcript ?? "", transcriptText].filter(Boolean).join("\n")
    : recording.transcript;

  const updateData: { transcript?: string; status?: "recording" } = {};
  if (updatedTranscript !== recording.transcript && updatedTranscript !== undefined) {
    updateData.transcript = updatedTranscript;
  }
  if (recording.status !== "recording") {
    updateData.status = "recording";
    await prisma.statusEvent.create({
      data: {
        sessionId,
        status: "recording",
        detail: "Chunk upload started",
      },
    });
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.recordingSession.update({
      where: { id: sessionId },
      data: updateData,
    });
  }

  return NextResponse.json({
    chunkId: createdChunk.id,
    transcript: transcriptText,
    order,
  });
}
