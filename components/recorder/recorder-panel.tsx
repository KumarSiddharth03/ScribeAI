/**
 * Presentation layer for the recorder experience: renders controls, live
 * transcript toast, network indicators, backlog modal, and wiring to the
 * useRecorder hook.
 */
"use client";

import { useEffect, useRef, useState, type JSX } from "react";

import { CheckCircle2, Loader2, Mic, MonitorCog, Pause, Play, SignalHigh, SignalLow, StopCircle } from "lucide-react";

import { RecorderSource } from "@/components/recorder/recorder-machine";
import { useRecorder } from "@/components/recorder/use-recorder";

const sourceOptions: { label: string; value: RecorderSource; description: string; icon: JSX.Element }[] = [
  {
    label: "Microphone",
    value: "mic",
    description: "Capture local mic input",
    icon: <Mic className="h-4 w-4" />,
  },
  {
    label: "Meeting tab",
    value: "tab",
    description: "Record Google Meet / Zoom tab",
    icon: <MonitorCog className="h-4 w-4" />,
  },
];

export function RecorderPanel() {
  const {
    selectedSource,
    setSelectedSource,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    isRecording,
    isPaused,
    queuedChunks,
    uploadedChunks,
    networkStatus,
    error,
    logs,
    liveTranscripts,
    sessionId,
    queueWarning,
    queueDepth,
    retryPending,
    discardPending,
    sessionStatus,
  } = useRecorder();

  const [toastEntry, setToastEntry] = useState<{ index: number; text: string } | null>(null);
  const lastToastKeyRef = useRef<string | null>(null);
  const [showQueueModal, setShowQueueModal] = useState(false);

  useEffect(() => {
    if (liveTranscripts.length === 0 || !sessionId) {
      setToastEntry(null);
      return;
    }

    const latest = liveTranscripts[0];
    const key = `${latest.index}-${latest.text}`;
    if (key === lastToastKeyRef.current) {
      return;
    }

    lastToastKeyRef.current = key;
    setToastEntry({ index: latest.index, text: latest.text });
    const timeout = window.setTimeout(() => setToastEntry(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [liveTranscripts, sessionId]);

  useEffect(() => {
    if (queueWarning) {
      setShowQueueModal(true);
    }
  }, [queueWarning]);

  const canStart = !isRecording && !isPaused;
  const canPause = isRecording;
  const canResume = isPaused;

  const sessionStatusMeta: Record<string, { label: string; color: string; icon: JSX.Element }> = {
    idle: { label: "Idle", color: "text-slate-400", icon: <StopCircle className="h-3.5 w-3.5 text-slate-500" /> },
    recording: { label: "Recording", color: "text-emerald-400", icon: <Mic className="h-3.5 w-3.5" /> },
    paused: { label: "Paused", color: "text-amber-400", icon: <Pause className="h-3.5 w-3.5" /> },
    processing: {
      label: "Processing",
      color: "text-sky-400",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    },
    completed: { label: "Completed", color: "text-purple-400", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
    failed: { label: "Failed", color: "text-rose-400", icon: <StopCircle className="h-3.5 w-3.5" /> },
  };
  const currentStatus = sessionStatusMeta[sessionStatus] ?? sessionStatusMeta.idle;

  return (
    <div className="relative space-y-6 rounded-2xl border border-slate-800/70 bg-slate-950/60 p-6 shadow-2xl shadow-black/40">
      {toastEntry && (
        <div className="absolute right-4 top-4 inline-flex max-w-xs animate-fade-in flex-col rounded-2xl border border-emerald-400/60 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
          <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">New caption</span>
          <p className="mt-1 whitespace-pre-wrap text-emerald-50">{toastEntry.text}</p>
        </div>
      )}
      {showQueueModal && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/80 p-6">
          <div className="w-full max-w-md space-y-4 rounded-2xl border border-amber-500/60 bg-slate-900/90 p-6 text-sm text-slate-100">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-amber-300">Upload backlog</p>
              <h4 className="mt-2 text-lg font-semibold text-white">Network hiccup detected</h4>
              <p className="mt-1 text-slate-400">
                {queueDepth} chunk{queueDepth === 1 ? "" : "s"} are waiting to upload. You can retry now once the
                connection stabilizes, or discard them and keep recording a shorter note.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => {
                  retryPending();
                  setShowQueueModal(false);
                }}
                className="inline-flex flex-1 items-center justify-center rounded-full bg-emerald-500/90 px-4 py-2 font-semibold text-white transition hover:bg-emerald-400"
              >
                Retry uploads
              </button>
              <button
                type="button"
                onClick={() => {
                  discardPending();
                  setShowQueueModal(false);
                }}
                className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-700 px-4 py-2 font-semibold text-slate-200 transition hover:border-slate-500"
              >
                Discard chunks
              </button>
            </div>
            <button
              type="button"
              onClick={() => setShowQueueModal(false)}
              className="w-full text-center text-xs uppercase tracking-[0.3em] text-slate-500 hover:text-slate-300"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-emerald-300">Recorder controls</p>
          <h3 className="text-xl font-semibold text-white">Chunked streaming pipeline</h3>
          <p className="text-sm text-slate-400">Select an input, stream 30s audio slices, and monitor queue + network state.</p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {networkStatus === "online" && (
            <>
              <SignalHigh className="h-4 w-4 text-emerald-400" />
              <span className="text-emerald-300">Online</span>
            </>
          )}
          {networkStatus === "offline" && (
            <>
              <SignalLow className="h-4 w-4 text-amber-400" />
              <span className="text-amber-300">Offline – buffering chunks</span>
            </>
          )}
          {networkStatus === "unknown" && (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
              <span className="text-slate-400">Detecting network…</span>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sourceOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setSelectedSource(option.value)}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
              selectedSource === option.value
                ? "border-emerald-400/60 bg-emerald-400/10"
                : "border-slate-800/70 hover:border-slate-600"
            }`}
            disabled={isRecording}
          >
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                {option.icon}
                {option.label}
              </p>
              <p className="text-xs text-slate-400">{option.description}</p>
            </div>
            {selectedSource === option.value && (
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Selected</span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <div className="rounded-xl border border-slate-800/60 px-4 py-2 text-slate-300">
          Queued chunks: <span className="font-semibold text-white">{queuedChunks}</span>
        </div>
        <div className="rounded-xl border border-slate-800/60 px-4 py-2 text-slate-300">
          Uploaded chunks: <span className="font-semibold text-white">{uploadedChunks}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-800/60 px-4 py-2">
          <span className={`${currentStatus.color} flex items-center gap-2 font-semibold`}>
            {currentStatus.icon}
            {currentStatus.label}
          </span>
        </div>
        {queueWarning && (
          <button
            type="button"
            onClick={() => window.alert("Network lag detected. Chunk uploads queued; keep the tab open or click resume once connectivity stabilizes.")}
            className="rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-2 text-amber-200"
          >
            Queue backlog ({queueDepth}) – tap to retry
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={startRecording}
          disabled={!canStart}
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500/90 px-5 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:opacity-50"
        >
          <Loader2 className={`h-4 w-4 ${canStart ? "hidden" : "animate-spin"}`} />
          Start session
        </button>
        <button
          onClick={pauseRecording}
          disabled={!canPause}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
        >
          <Pause className="h-4 w-4" />
          Pause
        </button>
        <button
          onClick={resumeRecording}
          disabled={!canResume}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
        >
          <Play className="h-4 w-4" />
          Resume
        </button>
        <button
          onClick={stopRecording}
          disabled={!isRecording && !isPaused}
          className="inline-flex items-center gap-2 rounded-full border border-rose-700/50 px-4 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-500 disabled:opacity-40"
        >
          <StopCircle className="h-4 w-4" />
          Stop
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-600/70 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          {error}
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Uploader log</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {logs.map((entry: string, index: number) => (
            <li key={`${index}-${entry}`} className="rounded border border-slate-800/70 px-3 py-1">
              {entry}
            </li>
          ))}
          {logs.length === 0 && <li className="text-slate-600">No activity yet.</li>}
        </ul>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Live transcript</p>
          {sessionId && (
            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">#{sessionId.slice(0, 6)}</span>
          )}
        </div>
        <div className="mt-2 space-y-1 text-xs text-slate-200">
          {liveTranscripts.length === 0 && (
            <p className="rounded border border-dashed border-slate-800/70 px-3 py-2 text-slate-500">
              {isRecording || isPaused
                ? "Waiting for Gemini to stream the first caption…"
                : "Start a session to see live captions here."}
            </p>
          )}
          {liveTranscripts.map((entry, idx) => (
            <div
              key={`${entry.index}-${idx}`}
              className="rounded-xl border border-slate-800/70 bg-slate-900/60 px-3 py-2 text-[11px] text-slate-100"
            >
              <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-300">Chunk {entry.index}</span>
              <p className="mt-1 whitespace-pre-wrap">{entry.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
