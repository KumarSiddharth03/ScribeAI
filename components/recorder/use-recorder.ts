"use client";

/**
 * React hook that orchestrates MediaRecorder capture, chunk queueing, socket
 * streaming, reconnection, and UI-facing state for the Recorder panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMachine } from "@xstate/react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation";

import { recorderMachine, RecorderSource } from "@/components/recorder/recorder-machine";

const CHUNK_MS = 30_000;
const MUTE_RECOVERY_DELAY_MS = 5_000;

type QueuedChunk = {
  blob: Blob;
  durationMs: number;
};

type LiveTranscript = {
  index: number;
  text: string;
};

type SessionStatus = "idle" | "recording" | "paused" | "processing" | "completed" | "failed";

const SOCKET_ENDPOINT = process.env.NEXT_PUBLIC_SOCKET_URL ?? "";

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unable to parse audio chunk"));
        return;
      }
      const base64 = reader.result.split(",")[1] ?? "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });

export function useRecorder() {
  const router = useRouter();
  const [state, send] = useMachine(recorderMachine);
  const [selectedSource, setSelectedSource] = useState<RecorderSource>("mic");
  const previousSourceRef = useRef<RecorderSource>("mic");
  const [networkStatus, setNetworkStatus] = useState<"online" | "offline" | "unknown">("unknown");
  useEffect(() => {
    setNetworkStatus(window.navigator.onLine ? "online" : "offline");
  }, []);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [liveTranscripts, setLiveTranscripts] = useState<LiveTranscript[]>([]);
  const [queueDepth, setQueueDepth] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("idle");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkQueueRef = useRef<QueuedChunk[]>([]);
  const uploadingRef = useRef(false);
  const flushPromiseRef = useRef<Promise<void> | null>(null);
  const chunkCounterRef = useRef(0);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const finalChunkPromiseRef = useRef<Promise<void> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const socketTokenRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const joinedSessionRef = useRef<string | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const sessionStatusRef = useRef<SessionStatus>("idle");
  const trackCleanupRef = useRef<(() => void) | null>(null);
  const streamRestartPromiseRef = useRef<Promise<void> | null>(null);
  const autoRecoverRef = useRef<((reason: string) => void) | null>(null);

  const postJson = useCallback(async <T,>(url: string, body?: Record<string, unknown>) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `Request failed for ${url}`);
    }

    return (await response.json()) as T;
  }, []);

  const log = useCallback((message: string) => {
    setLogs((prev) => [message, ...prev].slice(0, 25));
  }, []);

  const addTranscript = useCallback((entry: LiveTranscript) => {
    setLiveTranscripts((prev) => {
      const next = [entry, ...prev];
      return next.slice(0, 20);
    });
  }, []);

  const resetMedia = useCallback(() => {
    trackCleanupRef.current?.();
    trackCleanupRef.current = null;
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
    streamRef.current = null;
    chunkQueueRef.current = [];
    uploadingRef.current = false;
    chunkCounterRef.current = 0;
  }, []);

  const disconnectSocket = useCallback(() => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
    joinedSessionRef.current = null;
  }, []);

  const flushRecorderBuffer = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder) return;
    const state = recorder.state;
    if (state === "recording" || state === "paused") {
      try {
        recorder.requestData();
      } catch (error) {
        console.warn("Unable to flush recorder buffer", error);
      }
    }
  }, []);

  const clearSessionState = useCallback(
    ({ resetMachine = false }: { resetMachine?: boolean } = {}) => {
      resetMedia();
      sessionIdRef.current = null;
      setSessionId(null);
      socketTokenRef.current = null;
      joinedSessionRef.current = null;
      disconnectSocket();
      setQueueDepth(0);
      chunkQueueRef.current = [];
      chunkCounterRef.current = 0;
      setLiveTranscripts([]);
      setLogs([]);
      if (resetMachine) {
        send({ type: "RESET" });
      }
    },
    [disconnectSocket, resetMedia, send]
  );

  const canUseSocket = typeof window !== "undefined" && Boolean(SOCKET_ENDPOINT);
  const socketUrl = SOCKET_ENDPOINT || (typeof window !== "undefined" ? window.location.origin : "");

  useEffect(() => {
    if (
      previousSourceRef.current !== selectedSource &&
      !state.matches("recording") &&
      !state.matches("paused")
    ) {
      clearSessionState({ resetMachine: true });
    }
    previousSourceRef.current = selectedSource;
  }, [clearSessionState, selectedSource, state]);

  const ensureSocket = useCallback(
    async (recordingId: string) => {
      if (!canUseSocket) {
        throw new Error("Socket relay not configured");
      }

      if (socketRef.current && socketRef.current.connected) {
        if (joinedSessionRef.current !== recordingId) {
          socketRef.current.emit("join-session", { sessionId: recordingId });
          joinedSessionRef.current = recordingId;
        }
        return socketRef.current;
      }

      const socket = io(socketUrl, {
        transports: ["websocket"],
        withCredentials: true,
      });

      socketRef.current = socket;

      socket.on("chunk-transcribed", (payload: { sessionId: string; index: number; text: string }) => {
        if (payload.sessionId === sessionIdRef.current && payload.text) {
          addTranscript({ index: payload.index, text: payload.text });
          log(`Live text #${payload.index}`);
          if (sessionStatusRef.current !== "processing" && sessionStatusRef.current !== "completed") {
            setSessionStatus("recording");
          }
        }
      });

      socket.on("chunk-error", (payload: { sessionId: string; message?: string }) => {
        if (payload.sessionId === sessionIdRef.current) {
          const message = payload.message ?? "Socket chunk failed";
          setError(message);
          log(message);
          setSessionStatus("failed");
        }
      });

      socket.on("session-status", (payload: { sessionId: string; status: string; summary?: string }) => {
        if (payload.sessionId === sessionIdRef.current) {
          log(`Status: ${payload.status}`);
          if (payload.summary) {
            log("Summary updated via socket");
          }
          if (payload.status === "completed") {
            setSessionStatus("idle");
          } else if (["idle", "recording", "paused", "processing", "failed"].includes(payload.status)) {
            setSessionStatus(payload.status as SessionStatus);
          }
        }
      });

      socket.on("disconnect", () => {
        log("Socket disconnected");
        joinedSessionRef.current = null;
        if (sessionIdRef.current && reconnectTimeoutRef.current === null) {
          reconnectTimeoutRef.current = window.setTimeout(() => {
            reconnectTimeoutRef.current = null;
            void handleReconnect();
          }, 1500);
        }
      });

      const connectPromise = new Promise<Socket>((resolve, reject) => {
        const cleanup = () => {
          socket.off("session-joined", handleJoined);
          socket.off("session-error", handleError);
          socket.off("connect_error", handleConnectError);
        };

        const handleJoined = () => {
          cleanup();
          joinedSessionRef.current = recordingId;
          resolve(socket);
        };

        const handleError = (payload?: { message?: string }) => {
          cleanup();
          reject(new Error(payload?.message ?? "Unable to join session"));
        };

        const handleConnectError = (socketError: Error) => {
          cleanup();
          reject(socketError);
        };

        socket.on("session-joined", handleJoined);
        socket.on("session-error", handleError);
        socket.on("connect_error", handleConnectError);
      });

      const join = () => socket.emit("join-session", { sessionId: recordingId, token: socketTokenRef.current });
      if (socket.connected) {
        join();
      } else {
        socket.once("connect", join);
      }

      return connectPromise;
    },
    [addTranscript, canUseSocket, log, setError, socketUrl]
  );

  const emitWithAck = useCallback((socket: Socket, event: string, payload: unknown) => {
    return new Promise<void>((resolve, reject) => {
      socket.emit(event, payload, (response?: { ok: boolean; message?: string }) => {
        if (response?.ok === false) {
          reject(new Error(response.message ?? "Socket error"));
          return;
        }
        resolve();
      });
    });
  }, []);

  const uploadChunk = useCallback(
    async (chunk: QueuedChunk, index: number) => {
      if (!sessionIdRef.current) {
        throw new Error("No active session");
      }

      const base64Audio = await blobToBase64(chunk.blob);

      if (canUseSocket) {
        const socket = await ensureSocket(sessionIdRef.current);
        // Media depth: send over Socket.io first so we get live acks/transcripts, mirroring the README flow.
        await emitWithAck(socket, "audio-chunk", {
          sessionId: sessionIdRef.current,
          chunk: base64Audio,
          index,
          durationMs: chunk.durationMs,
          mimeType: chunk.blob.type || "audio/webm;codecs=opus",
          source: selectedSource,
          token: socketTokenRef.current,
        });
        return;
      }

      // Transport fallback — REST keeps recordings alive even if sockets are down.
      await postJson(`/api/recordings/${sessionIdRef.current}/chunks`, {
        chunk: base64Audio,
        index,
        durationMs: chunk.durationMs,
        mimeType: chunk.blob.type || "audio/webm;codecs=opus",
      });
    },
    [canUseSocket, emitWithAck, ensureSocket, postJson, selectedSource]
  );

  const flushQueue = useCallback(async () => {
    if (flushPromiseRef.current) {
      return flushPromiseRef.current;
    }

    if (!sessionIdRef.current || (!chunkQueueRef.current.length && !uploadingRef.current)) {
      return Promise.resolve();
    }

    const flushPromise = (async () => {
      uploadingRef.current = true;

      while (sessionIdRef.current && chunkQueueRef.current.length) {
        if (!navigator.onLine) {
          setNetworkStatus("offline");
          break;
        }

        setNetworkStatus("online");
        const chunk = chunkQueueRef.current.shift();
        if (!chunk) break;

        try {
          const index = chunkCounterRef.current + 1;
          chunkCounterRef.current = index;
          // Backpressure control: dequeue one chunk, upload it, and only then advance.
          await uploadChunk(chunk, index);
          send({ type: "CHUNK_UPLOADED" });
          log(`Uploaded chunk #${index}`);
          setQueueDepth(chunkQueueRef.current.length);
        } catch (err) {
          console.error(err);
          chunkQueueRef.current.unshift(chunk);
          send({ type: "ERROR", message: "Failed to upload chunk." });
          setError("Failed to upload chunk. Will retry on next attempt.");
          break;
        }
      }

      uploadingRef.current = false;
    })()
      .catch(() => {
        // Error already surfaced above; ensure refs reset.
      })
      .finally(() => {
        flushPromiseRef.current = null;
      });

    flushPromiseRef.current = flushPromise;
    return flushPromise;
  }, [log, send, uploadChunk]);

  const discardPending = useCallback(() => {
    // Edge case: give users a way to nuke stale chunks when backlog is unrecoverable.
    chunkQueueRef.current = [];
    setQueueDepth(0);
    send({ type: "RESET" });
    log("Cleared pending chunks");
  }, [log, send]);

  const handleData = useCallback(
    (event: BlobEvent) => {
      if (!event.data || event.data.size === 0) return;
      // Media handling depth: buffer every 30s blob so we can survive offline pauses and flush later.
      chunkQueueRef.current.push({
        blob: event.data,
        durationMs: CHUNK_MS,
      });
      setQueueDepth(chunkQueueRef.current.length);
      send({ type: "CHUNK_QUEUED" });
      void flushQueue();
    },
    [flushQueue, send]
  );

  const requestStream = useCallback(async () => {
    try {
      // Always clear any previous tracks to avoid "NotSupportedError" when restarting.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      trackCleanupRef.current?.();
      trackCleanupRef.current = null;

      let stream: MediaStream;
      const trackTargets: { stream: MediaStream; label: string; endBehavior?: "stop" | "recover" }[] = [];
      if (selectedSource === "mic") {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        trackTargets.push({ stream, label: "mic", endBehavior: "recover" });
      } else {
        // Tab mode: mix tab audio + mic inside WebAudio so remote + local voices survive Gemini processing.
        const tabStream = await navigator.mediaDevices.getDisplayMedia({
          audio: true,
          video: true,
          preferCurrentTab: true,
        } as DisplayMediaStreamOptions);

        if (!tabStream.getAudioTracks().length) {
          tabStream.getTracks().forEach((track) => track.stop());
          throw new Error(
            "The shared tab/window did not include audio. When sharing a tab, be sure to enable 'Share tab audio'."
          );
        }

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!micStream.getAudioTracks().length) {
          tabStream.getTracks().forEach((track) => track.stop());
          micStream.getTracks().forEach((track) => track.stop());
          throw new Error("Microphone access is required when recording a tab. Please enable mic permissions and try again.");
        }

        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        audioContext.createMediaStreamSource(tabStream).connect(destination);
        audioContext.createMediaStreamSource(micStream).connect(destination);

        const combinedStream = new MediaStream();
        destination.stream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));
        stream = combinedStream;
        trackTargets.push(
          { stream: combinedStream, label: "tab-mix", endBehavior: "recover" },
          { stream: tabStream, label: "tab-share", endBehavior: "stop" },
          { stream: micStream, label: "tab-mic", endBehavior: "recover" }
        );
      }

      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(
          selectedSource === "mic"
            ? "No microphone detected. Please plug in or enable a microphone and try again."
            : "The shared tab/window did not include audio. When sharing a tab, be sure to enable 'Share tab audio'."
        );
      }

      streamRef.current = stream;
      const cleanupFns: (() => void)[] = [];
      const monitorTrack = (track: MediaStreamTrack, label: string, endBehavior: "stop" | "recover" = "recover") => {
        // Edge-case guard: every track gets mute/ended listeners so auto-recovery knows which leg failed.
        let muteTimeout: number | null = null;
        const triggerRecovery = (reason: string) => autoRecoverRef.current?.(`${label} ${reason}`);
        const handleEnded = () => {
          if (endBehavior === "stop") {
            void stopRecordingRef.current?.();
            return;
          }
          triggerRecovery("ended");
        };
        const handleMute = () => {
          if (muteTimeout !== null) return;
          muteTimeout = window.setTimeout(() => {
            if (track.muted) {
              triggerRecovery("muted");
            }
          }, MUTE_RECOVERY_DELAY_MS);
        };
        const handleUnmute = () => {
          if (muteTimeout !== null) {
            window.clearTimeout(muteTimeout);
            muteTimeout = null;
          }
        };
        track.addEventListener("ended", handleEnded);
        track.addEventListener("mute", handleMute);
        track.addEventListener("unmute", handleUnmute);
        // Cleanup restores listeners and pending timers so repeated recoveries stay leak-free.
        cleanupFns.push(() => {
          track.removeEventListener("ended", handleEnded);
          track.removeEventListener("mute", handleMute);
          track.removeEventListener("unmute", handleUnmute);
          if (muteTimeout !== null) {
            window.clearTimeout(muteTimeout);
            muteTimeout = null;
          }
        });
      };

      const targets = trackTargets.length ? trackTargets : [{ stream, label: selectedSource, endBehavior: "recover" as const }];
      targets.forEach(({ stream: targetStream, label, endBehavior }) => {
        targetStream.getTracks().forEach((track, index) =>
          monitorTrack(track, `${label}:${track.kind}:${index}`, endBehavior ?? "recover")
        );
      });
      trackCleanupRef.current = () => {
        cleanupFns.forEach((fn) => fn());
        trackCleanupRef.current = null;
      };

      const preferredTypes: (string | undefined)[] = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
        undefined,
      ];

      let recorder: MediaRecorder | null = null;
      let startError: unknown = null;
      for (const type of preferredTypes) {
        try {
          const options: MediaRecorderOptions = { audioBitsPerSecond: 128000 };
          if (type && typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) {
            options.mimeType = type;
          } else if (type) {
            continue;
          }

          const candidate = new MediaRecorder(stream, options);
          candidate.ondataavailable = handleData;
          candidate.onerror = (event) => {
            console.error(event.error);
            const message = event.error?.message ?? "Recorder error";
            send({ type: "ERROR", message });
            setError(message);
          };

          try {
            candidate.start(CHUNK_MS);
            recorder = candidate;
            break;
          } catch (firstError) {
            startError = firstError;
          }

          candidate.stream.getTracks().forEach((track) => track.stop());
        } catch (error) {
          startError = error;
          continue;
        }
      }

      if (!recorder) {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        trackCleanupRef.current?.();
        trackCleanupRef.current = null;
        throw startError ?? new Error("Unable to start recorder");
      }

      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.error(err);
      trackCleanupRef.current?.();
      trackCleanupRef.current = null;
      let message = err instanceof Error ? err.message : "Unable to access media devices";
      if (err instanceof DOMException) {
        if (err.name === "NotAllowedError" || err.name === "SecurityError" || err.name === "PermissionDeniedError") {
          message =
            selectedSource === "mic"
              ? "Microphone permission was denied. Please allow access and try again."
              : "Screen/audio capture permission was denied. Please allow access and try again.";
        } else if (err.name === "NotFoundError") {
          message = "No usable audio input was found. Check your devices and try again.";
        } else if (err.name === "NotSupportedError") {
          message = "This browser cannot capture audio in the required format. Please use the latest Chrome or Edge.";
        }
      }
      send({ type: "ERROR", message });
      setError(message);
      throw new Error(message);
    }
  }, [handleData, selectedSource, send]);

  const createRecordingSession = useCallback(async () => {
    const response = await postJson<{ recording: { id: string }; token: string }>("/api/recordings", {
      source: selectedSource,
    });
    sessionIdRef.current = response.recording.id;
    socketTokenRef.current = response.token;
    setSessionId(response.recording.id);
    setLiveTranscripts([]);
    log(`Session ${response.recording.id} created.`);
    return response.recording.id;
  }, [log, postJson, selectedSource]);

  const completeSession = useCallback(async () => {
    if (!sessionIdRef.current) return;
    let completionSucceeded = false;
    try {
      if (canUseSocket) {
        try {
          const socket = await ensureSocket(sessionIdRef.current);
          await emitWithAck(socket, "complete-session", {
            sessionId: sessionIdRef.current,
            token: socketTokenRef.current,
          });
          log("Session completion requested via socket.");
          completionSucceeded = true;
        } catch (socketError) {
          console.error("Socket completion failed, falling back to REST", socketError);
        }
      }

      if (!completionSucceeded) {
        await postJson(`/api/recordings/${sessionIdRef.current}/complete`);
        log("Session completion requested via REST.");
        completionSucceeded = true;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete session";
      setError(message);
      log(message);
    } finally {
      if (completionSucceeded) {
        router.refresh();
        setSessionStatus("completed");
      }
      clearSessionState({ resetMachine: true });
      setSessionStatus("idle");
    }
  }, [canUseSocket, clearSessionState, emitWithAck, ensureSocket, log, postJson, router]);

  const stopRecording = useCallback(async () => {
    setSessionStatus("processing");
    const recorder = mediaRecorderRef.current;

    if (recorder && recorder.state !== "inactive") {
      finalChunkPromiseRef.current = new Promise<void>((resolve) => {
        const handleFinalChunk = () => {
          recorder.removeEventListener("dataavailable", handleFinalChunk as EventListener);
          resolve();
        };
        recorder.addEventListener("dataavailable", handleFinalChunk as EventListener, { once: true });
      });

      try {
        recorder.requestData();
      } catch (requestError) {
        console.warn("requestData failed", requestError);
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      recorder.stop();
    } else {
      flushRecorderBuffer();
    }

    if (finalChunkPromiseRef.current) {
      await finalChunkPromiseRef.current;
      finalChunkPromiseRef.current = null;
    }
    send({ type: "STOP" });
    log("Stopped recorder");
    await flushQueue();
    await completeSession();
  }, [completeSession, flushQueue, flushRecorderBuffer, log, send]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    sessionStatusRef.current = sessionStatus;
  }, [sessionStatus]);

  const ensureMediaRecorder = useCallback(async () => {
    if (!sessionIdRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      try {
        await requestStream();
        log("Recorder stream re-established");
      } catch (startError) {
        let errorMessage = (startError as Error).message ?? "Unable to start recorder";
        if (startError instanceof DOMException) {
          if (startError.name === "NotSupportedError") {
            errorMessage =
              "MediaRecorder could not encode audio. Please update Chrome/Edge, close other capture apps, or share a different source.";
          } else if (startError.name === "InvalidStateError") {
            errorMessage = "Recorder is already running. Stop other recordings and try again.";
          }
        }
        throw new Error(errorMessage);
      }
    } else if (recorder.state === "paused" && state.matches("recording")) {
      recorder.resume();
      log("Recorder resumed after pause");
    }
  }, [log, requestStream, setError, state]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setSessionStatus("recording");
      if (sessionIdRef.current) {
        log("Previous session detected — stopping before starting a new one.");
        await stopRecording();
      }
      const newSessionId = await createRecordingSession();
      send({ type: "START", source: selectedSource });
      if (canUseSocket) {
        try {
          await ensureSocket(newSessionId);
          log("Socket connected for live streaming");
        } catch (socketError) {
          const message = socketError instanceof Error ? socketError.message : "Socket connection failed";
          log(message);
        }
      }
      await requestStream();
      log(`Started ${selectedSource === "mic" ? "microphone" : "tab"} capture.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start session";
      setError(message);
      log(message);
      setSessionStatus("failed");
      clearSessionState({ resetMachine: true });
    }
  }, [
    canUseSocket,
    clearSessionState,
    createRecordingSession,
    ensureSocket,
    log,
    requestStream,
    selectedSource,
    send,
    stopRecording,
  ]);

  const pauseRecording = useCallback(() => {
    flushRecorderBuffer();
    mediaRecorderRef.current?.pause();
    send({ type: "PAUSE" });
    log("Paused recorder");
    setSessionStatus("paused");
    void flushQueue();
  }, [flushQueue, flushRecorderBuffer, log, send]);

  const resumeRecording = useCallback(() => {
    mediaRecorderRef.current?.resume();
    send({ type: "RESUME" });
    log("Resumed recorder");
    setSessionStatus("recording");
  }, [log, send]);

  useEffect(() => {
    // Auto-reconnect hook: when a track ends or Chrome mutes the stream, rebuild capture + recorder.
    autoRecoverRef.current = (reason: string) => {
      if (!sessionIdRef.current) return;
      if (
        sessionStatusRef.current === "processing" ||
        sessionStatusRef.current === "completed" ||
        sessionStatusRef.current === "failed"
      ) {
        return;
      }
      if (streamRestartPromiseRef.current) {
        return;
      }
      streamRestartPromiseRef.current = (async () => {
        log(`Media stream interrupted (${reason}). Attempting to recover…`);
        try {
          await ensureMediaRecorder();
          log("Media stream recovered.");
        } catch (recoverError) {
          const message =
            recoverError instanceof Error ? recoverError.message : "Unable to recover media stream. Stopping session.";
          setError(message);
          log(message);
          await stopRecordingRef.current?.();
        } finally {
          streamRestartPromiseRef.current = null;
        }
      })();
    };
    return () => {
      autoRecoverRef.current = null;
    };
  }, [ensureMediaRecorder, log, setError]);

  // Edge case: when laptop wakes up or network resumes, rebuild media stream and push backlog.
  const reconnectSession = useCallback(async () => {
    if (!sessionIdRef.current) return;
    if (canUseSocket) {
      try {
        await ensureSocket(sessionIdRef.current);
        log("Socket reconnected");
      } catch (error) {
        // Handle socket reconnect failure
        console.error("Socket reconnect failed", error);
      }
    }
    // Rebuild media stream and push backlog
    await ensureMediaRecorder();
    await flushQueue();
  }, [canUseSocket, ensureMediaRecorder, ensureSocket, flushQueue, log]);

  const handleReconnect = useCallback(async () => {
    // Handle reconnect logic
    await reconnectSession();
  }, [reconnectSession]);

  useEffect(() => {
    const goOnline = () => {
      setNetworkStatus("online");
      // Network edge case: if connectivity blipped, kick off full reconnect + queue flush.
      void handleReconnect();
    };
    const goOffline = () => setNetworkStatus("offline");

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [handleReconnect]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (sessionIdRef.current) {
        // Edge case: block accidental tab closes while recordings are active.
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    return () => {
      resetMedia();
      send({ type: "RESET" });
      sessionIdRef.current = null;
      setSessionId(null);
      disconnectSocket();
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      setSessionStatus("idle");
    };
  }, [disconnectSocket, resetMedia, send]);

  const value = useMemo(
    () => ({
      selectedSource,
      setSelectedSource,
      startRecording,
      pauseRecording,
      resumeRecording,
      stopRecording,
      isRecording: state.matches("recording"),
      isPaused: state.matches("paused"),
      queuedChunks: state.context.queuedChunks,
      uploadedChunks: state.context.uploadedChunks,
      networkStatus,
      error: error ?? state.context.error,
      logs,
      sessionId,
      liveTranscripts,
      queueWarning: queueDepth >= 5,
      queueDepth,
      discardPending,
      retryPending: () => void flushQueue(),
      sessionStatus,
    }),
    [
      error,
      logs,
      networkStatus,
      pauseRecording,
      resumeRecording,
      selectedSource,
      liveTranscripts,
      sessionId,
      queueDepth,
      flushQueue,
      startRecording,
      state,
      stopRecording,
      discardPending,
      sessionStatus,
    ]
  );

  return value;
}
