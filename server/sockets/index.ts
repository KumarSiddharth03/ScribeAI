/**
 * Socket.io relay that authenticates signed tokens, enforces rate limits, saves
 * audio chunks to Prisma, streams them to Gemini for live transcription, and
 * handles session completion events.
 */
import { createServer } from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";

import { prisma } from "../../lib/prisma";
import { transcribeChunk, summarizeTranscript } from "../../lib/gemini";
import { verifySocketToken } from "../../lib/socket-token";

dotenv.config();

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

type ChunkPayload = {
  sessionId: string;
  chunk: string;
  index: number;
  durationMs: number;
  source: "mic" | "tab";
  mimeType?: string;
  token?: string;
};

type CompletePayload = {
  sessionId: string;
  token?: string;
};

type Ack = (response: { ok: boolean; message?: string }) => void;

const sessionRoom = (sessionId: string) => `session:${sessionId}`;

const RATE_WINDOW_MS = 10_000;
const MAX_CHUNKS_PER_WINDOW = 40;

const rateState = new Map<string, { count: number; windowStart: number }>();

const GENERIC_MEETING_PHRASES = [
  "let's dive into today's agenda",
  "sales figures",
  "q3 financial",
  "quarterly projections",
  "align on the new targets",
  "board meeting next week",
  "welcome everyone to today's quarterly review",
];

function isSuspiciousTranscript(text: string) {
  const normalized = text.toLowerCase();
  return GENERIC_MEETING_PHRASES.some((phrase) => normalized.includes(phrase));
}

function checkRateLimit(socketId: string) {
  const now = Date.now();
  const state = rateState.get(socketId);
  if (!state || now - state.windowStart > RATE_WINDOW_MS) {
    rateState.set(socketId, { count: 1, windowStart: now });
    return true;
  }
  if (state.count >= MAX_CHUNKS_PER_WINDOW) {
    return false;
  }
  state.count += 1;
  return true;
}

io.on("connection", (socket) => {
  console.log(`Socket connected ${socket.id}`);

  socket.on("join-session", async ({ sessionId, token }: { sessionId: string; token?: string }) => {
    if (!sessionId || !token) {
      socket.emit("session-error", { message: "Missing sessionId or token" });
      return;
    }

    try {
      const payload = verifySocketToken(token);
      if (payload.sessionId !== sessionId) {
        throw new Error("Token mismatch");
      }
      socket.data.userId = payload.userId;
    } catch (error) {
      socket.emit("session-error", { sessionId, message: (error as Error).message });
      return;
    }

    const recording = await prisma.recordingSession.findUnique({
      where: { id: sessionId, userId: socket.data.userId },
      select: { id: true },
    });
    if (!recording) {
      socket.emit("session-error", { sessionId, message: "Recording not found" });
      return;
    }

    socket.join(sessionRoom(sessionId));
    socket.emit("session-joined", { sessionId });
  });

  socket.on("audio-chunk", async (payload: ChunkPayload, callback?: Ack) => {
    const { sessionId, chunk, index, durationMs, mimeType, token } = payload;

    if (!sessionId || !chunk || !token) {
      callback?.({ ok: false, message: "Missing sessionId, chunk, or token" });
      return;
    }

    if (!checkRateLimit(socket.id)) {
      callback?.({ ok: false, message: "Rate limit exceeded" });
      return;
    }

    if (Buffer.byteLength(chunk, "base64") > 2 * 1024 * 1024) {
      callback?.({ ok: false, message: "Chunk too large" });
      return;
    }

    try {
      const payloadData = verifySocketToken(token);
      if (payloadData.sessionId !== sessionId || payloadData.userId !== socket.data.userId) {
        throw new Error("Invalid token for chunk upload");
      }
    } catch (error) {
      callback?.({ ok: false, message: (error as Error).message });
      return;
    }

    try {
      const recording = await prisma.recordingSession.findUnique({
        where: { id: sessionId, userId: socket.data.userId },
        select: { id: true, transcript: true, status: true },
      });

      if (!recording) {
        throw new Error("Recording not found");
      }

      const createdChunk = await prisma.audioChunk.create({
        data: {
          sessionId,
          order: index,
          durationMs,
          mimeType: mimeType ?? "audio/webm;codecs=opus",
          bytes: Buffer.from(chunk, "base64"),
        },
      });

      let transcriptText = "";
      try {
        const transcription = await transcribeChunk(chunk);
        transcriptText = transcription.text?.trim() ?? "";
      } catch (error) {
        console.error("Transcription failed", error);
      }

      if (transcriptText && isSuspiciousTranscript(transcriptText)) {
        console.warn("Discarding suspicious transcript snippet", transcriptText);
        transcriptText = "";
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
      if (typeof updatedTranscript === "string" && updatedTranscript !== recording.transcript) {
        updateData.transcript = updatedTranscript;
      }
      if (recording.status !== "recording") {
        updateData.status = "recording";
        await prisma.statusEvent.create({
          data: {
            sessionId,
            status: "recording",
            detail: "Socket stream started",
          },
        });
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.recordingSession.update({ where: { id: sessionId }, data: updateData });
      }

      io.to(sessionRoom(sessionId)).emit("chunk-transcribed", {
        sessionId,
        index,
        text: transcriptText,
      });

      callback?.({ ok: true });
    } catch (error) {
      console.error("audio-chunk error", error);
      callback?.({ ok: false, message: (error as Error).message });
      socket.emit("chunk-error", { sessionId, index, message: "Failed to process chunk" });
    }
  });

  socket.on("complete-session", async (payload: CompletePayload, callback?: Ack) => {
    const { sessionId, token } = payload;
    if (!sessionId || !token) {
      callback?.({ ok: false, message: "Missing sessionId or token" });
      return;
    }

    try {
      const data = verifySocketToken(token);
      if (data.sessionId !== sessionId || data.userId !== socket.data.userId) {
        throw new Error("Invalid token for completion");
      }
    } catch (error) {
      callback?.({ ok: false, message: (error as Error).message });
      return;
    }

    try {
      const recording = await prisma.recordingSession.findUnique({
        where: { id: sessionId, userId: socket.data.userId },
        select: { transcript: true, summary: true, summaryVersion: true },
      });

      if (!recording) {
        throw new Error("Recording not found");
      }

      await prisma.recordingSession.update({
        where: { id: sessionId },
        data: { status: "processing" },
      });

      await prisma.statusEvent.create({
        data: {
          sessionId,
          status: "processing",
          detail: "Socket summary request",
        },
      });

      let summaryText = recording.summary ?? "";
      try {
        const transcript = recording.transcript ?? "";
        if (transcript.trim()) {
          summaryText = await summarizeTranscript(transcript);
        }
      } catch (error) {
        console.error("Summary generation failed", error);
      }

      const completed = await prisma.recordingSession.update({
        where: { id: sessionId },
        data: {
          status: "completed",
          completedAt: new Date(),
          summary: summaryText,
          summaryVersion: recording.summaryVersion + 1,
        },
      });

      await prisma.statusEvent.create({
        data: {
          sessionId,
          status: "completed",
          detail: "Socket summary ready",
        },
      });

      io.to(sessionRoom(sessionId)).emit("session-status", {
        sessionId,
        status: completed.status,
        summary: completed.summary,
      });

      callback?.({ ok: true });
    } catch (error) {
      console.error("complete-session error", error);
      callback?.({ ok: false, message: (error as Error).message });
      socket.emit("session-error", { sessionId, message: "Failed to finalize session" });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Socket disconnected ${socket.id}`);
  });
});

const PORT = Number(process.env.SOCKET_PORT ?? 4001);
httpServer.listen(PORT, () => {
  console.log(`Socket server listening on port ${PORT}`);
});
