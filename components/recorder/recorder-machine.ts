/**
 * Recorder state machine that tracks source selection, queued/uploaded chunks,
 * and guards transitions between recording, paused, and idle states. Actions
 * update counters so the UI and hook stay in sync with MediaRecorder events.
 */
import { assign, setup } from "xstate";

export type RecorderSource = "mic" | "tab";

export interface RecorderContext {
  source: RecorderSource;
  queuedChunks: number;
  uploadedChunks: number;
  error: string | null;
}

export type RecorderEvent =
  | { type: "START"; source: RecorderSource }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "STOP" }
  | { type: "RESET" }
  | { type: "CHUNK_QUEUED" }
  | { type: "CHUNK_UPLOADED" }
  | { type: "ERROR"; message: string };

const initialContext: RecorderContext = {
  source: "mic",
  queuedChunks: 0,
  uploadedChunks: 0,
  error: null,
};

export const recorderMachine = setup({
  types: {
    context: {} as RecorderContext,
    events: {} as RecorderEvent,
  },
  actions: {
    setSource: assign(({ event, context }) => {
      if (event.type !== "START") {
        return context;
      }

      return {
        ...context,
        source: event.source,
        queuedChunks: 0,
        uploadedChunks: 0,
        error: null,
      } satisfies RecorderContext;
    }),
    resetContext: assign(() => initialContext),
    incrementQueued: assign(({ context }) => ({
      ...context,
      queuedChunks: context.queuedChunks + 1,
    })),
    chunkUploaded: assign(({ context }) => ({
      ...context,
      queuedChunks: Math.max(context.queuedChunks - 1, 0),
      uploadedChunks: context.uploadedChunks + 1,
    })),
    captureError: assign(({ context, event }) => ({
      ...context,
      error: event.type === "ERROR" ? event.message : context.error,
    })),
  },
}).createMachine({
  id: "recorder",
  context: initialContext,
  initial: "idle",
  states: {
    idle: {
      on: {
        START: { target: "recording", actions: "setSource" },
        RESET: { target: "idle", actions: "resetContext" },
      },
    },
    recording: {
      on: {
        PAUSE: "paused",
        STOP: "idle",
        CHUNK_QUEUED: { actions: "incrementQueued" },
        CHUNK_UPLOADED: { actions: "chunkUploaded" },
        ERROR: { target: "error", actions: "captureError" },
      },
    },
    paused: {
      on: {
        RESUME: "recording",
        STOP: "idle",
        ERROR: { target: "error", actions: "captureError" },
      },
    },
    error: {
      on: {
        RESET: { target: "idle", actions: "resetContext" },
      },
    },
  },
});
