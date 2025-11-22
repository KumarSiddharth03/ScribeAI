"use client";

/**
 * Session history list that loads recent recordings, displays diarization
 * badges/status filters, and exposes export helpers (JSON/TXT/Markdown/CSV/PDF).
 */

import { useMemo, useState } from "react";
import type { JSX } from "react";

import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PDFFont } from "pdf-lib";

import { ArrowUpRight, FileText, Mic, Waves } from "lucide-react";

type RecordingStatus = "idle" | "recording" | "paused" | "processing" | "completed" | "failed";

interface StatusEventSummary {
  id: string;
  status: RecordingStatus;
  detail: string | null;
  createdAt: Date;
}

interface RecordingCard {
  id: string;
  title: string;
  status: RecordingStatus;
  source: string;
  startedAt: Date;
  completedAt: Date | null;
  summary: string | null;
  transcript: string | null;
  events: StatusEventSummary[];
}

const statusLabel: Record<RecordingStatus, { label: string; color: string }> = {
  idle: { label: "Idle", color: "text-slate-400" },
  recording: { label: "Recording", color: "text-emerald-400" },
  paused: { label: "Paused", color: "text-amber-400" },
  processing: { label: "Processing", color: "text-sky-400" },
  completed: { label: "Completed", color: "text-purple-400" },
  failed: { label: "Failed", color: "text-rose-400" },
};

const diarizationColors = [
  "bg-emerald-500/20 text-emerald-200",
  "bg-sky-500/20 text-sky-200",
  "bg-amber-500/20 text-amber-200",
  "bg-purple-500/20 text-purple-200",
  "bg-rose-500/20 text-rose-200",
];

function sanitizePdfText(input: string) {
  return input
    .split("")
    .map((char) => {
      return char.charCodeAt(0) <= 0xff ? char : "?";
    })
    .join("");
}

function wrapText(font: PDFFont, text: string, maxWidth: number, fontSize: number) {
  const safeText = sanitizePdfText(text);
  const words = safeText.split(/\s+/);
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(candidate, fontSize);
    if (width <= maxWidth) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(title: string) {
  return title.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "").toLowerCase();
}

function buildSnippet(text: string, maxLength = 240) {
  const normalized = text.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const truncated = normalized.slice(0, maxLength);
  return `${truncated.replace(/\s+\S*$/, "").trim()}…`;
}

function buildPlainText(recording: RecordingCard) {
  return `Title: ${recording.title}\nStatus: ${recording.status}\nStarted: ${formatDate(recording.startedAt)}\nCompleted: ${formatDate(recording.completedAt)}\nSource: ${recording.source}\n\nSummary\n-------\n${recording.summary ?? "(pending)"}\n\nTranscript\n---------\n${recording.transcript ?? "(pending)"}`;
}

function buildMarkdown(recording: RecordingCard) {
  return `# ${recording.title}\n\n- **Status:** ${recording.status}\n- **Started:** ${formatDate(recording.startedAt)}\n- **Completed:** ${formatDate(recording.completedAt)}\n- **Source:** ${recording.source}\n\n## Summary\n${recording.summary ?? "_Pending summary_"}\n\n## Transcript\n${recording.transcript ?? "_Pending transcript_"}`;
}

function buildCsv(recording: RecordingCard) {
  const rows = [
    ["Title", recording.title],
    ["Status", recording.status],
    ["Started", formatDate(recording.startedAt)],
    ["Completed", formatDate(recording.completedAt)],
    ["Source", recording.source],
    ["Summary", (recording.summary ?? "").replace(/"/g, '""')],
    ["Transcript", (recording.transcript ?? "").replace(/"/g, '""')],
  ];
  return rows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");
}

async function buildPdf(recording: RecordingCard) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const { width, height } = page.getSize();
  let cursorY = height - 40;

  const writeLine = (text: string, bold = false) => {
    const lines = wrapText(font, sanitizePdfText(text), width - 80, fontSize);
    const usedFont = font;
    lines.forEach((line: string) => {
      if (cursorY < 40) {
        page.drawLine({ start: { x: 40, y: cursorY }, end: { x: width - 40, y: cursorY } });
        cursorY = height - 40;
      }
      page.drawText(line, {
        x: 40,
        y: cursorY,
        size: bold ? fontSize + 1 : fontSize,
        font: usedFont,
      });
      cursorY -= fontSize + 4;
    });
    cursorY -= 6;
  };

  writeLine(recording.title, true);
  writeLine(`Status: ${recording.status}`);
  writeLine(`Started: ${formatDate(recording.startedAt)}`);
  writeLine(`Completed: ${formatDate(recording.completedAt)}`);
  writeLine(`Source: ${recording.source}`);
  writeLine("Summary", true);
  writeLine(recording.summary ?? "Pending summary");
  writeLine("Transcript", true);
  writeLine(recording.transcript ?? "Pending transcript");

  const pdfBytes = await doc.save();
  const pdfCopy = new Uint8Array(pdfBytes);
  return new Blob([pdfCopy.buffer], { type: "application/pdf" });
}

const sourceIcon: Record<string, JSX.Element> = {
  mic: <Mic className="h-4 w-4" />,
  microphone: <Mic className="h-4 w-4" />,
  tab: <Waves className="h-4 w-4" />,
};

function formatDate(date: Date | null) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date);
}

export function SessionHistory({ recordings }: { recordings: RecordingCard[] }) {
  const [statusFilter, setStatusFilter] = useState<RecordingStatus | "all">("all");
  const [visibleCount, setVisibleCount] = useState(6);

  const filteredRecordings = useMemo(() => {
    if (statusFilter === "all") {
      return recordings;
    }
    return recordings.filter((recording) => recording.status === statusFilter);
  }, [recordings, statusFilter]);

  const visibleRecordings = filteredRecordings.slice(0, visibleCount);
  const canLoadMore = visibleCount < filteredRecordings.length;

  const handleExportAllJson = () => {
    const payload = JSON.stringify(recordings, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    downloadBlob("scribeai-sessions.json", blob);
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-800/60 bg-slate-900/30 p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Session history</p>
          <h3 className="text-xl font-semibold text-white">Recent activity</h3>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
          <button
            type="button"
            onClick={handleExportAllJson}
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1.5 text-slate-200 transition hover:border-slate-500"
          >
            Export all (JSON)
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(["all", ...Object.keys(statusLabel)] as (RecordingStatus | "all")[]).map((statusKey) => {
          const meta =
            statusKey === "all" ? { label: "All", color: "text-slate-300" } : statusLabel[statusKey as RecordingStatus];
          const count =
            statusKey === "all"
              ? recordings.length
              : recordings.filter((rec) => rec.status === statusKey).length;
          return (
            <button
              key={statusKey}
              type="button"
              onClick={() => setStatusFilter(statusKey)}
              className={`rounded-full border px-3 py-1.5 transition ${
                statusFilter === statusKey
                  ? "border-emerald-400 bg-emerald-400/10"
                  : "border-slate-800/70 hover:border-slate-600"
              }`}
            >
              <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
              <span className="ml-1 text-slate-500">({count})</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {visibleRecordings.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-800/70 px-4 py-3 text-sm text-slate-500">
            {recordings.length === 0
              ? "No sessions yet. Start a recording to see transcripts and summaries appear here."
              : "No sessions match the current filter."}
          </p>
        )}

        {visibleRecordings.map((recording) => {
          const latestEvent = recording.events?.[0];
          const statusMeta = statusLabel[recording.status];
          const icon = sourceIcon[recording.source] ?? <Mic className="h-4 w-4" />;
          const exportTxt = () => {
            const content = buildPlainText(recording);
            downloadBlob(`${sanitizeFilename(recording.title)}-transcript.txt`, new Blob([content], { type: "text/plain" }));
          };

          const exportMarkdown = () => {
            const content = buildMarkdown(recording);
            downloadBlob(`${sanitizeFilename(recording.title)}.md`, new Blob([content], { type: "text/markdown" }));
          };

          const exportCsv = () => {
            const content = buildCsv(recording);
            downloadBlob(`${sanitizeFilename(recording.title)}.csv`, new Blob([content], { type: "text/csv" }));
          };

          const exportPdf = async () => {
            const pdfBlob = await buildPdf(recording);
            downloadBlob(`${sanitizeFilename(recording.title)}.pdf`, pdfBlob);
          };

          return (
            <div key={recording.id} className="space-y-3 rounded-2xl border border-slate-800/60 bg-slate-950/40 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    {icon}
                    {recording.title}
                  </p>
                  <p className="text-xs text-slate-500">Started {formatDate(recording.startedAt)}</p>
                </div>
                <span className={`text-xs font-semibold uppercase tracking-[0.2em] ${statusMeta.color}`}>
                  {statusMeta.label}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={exportTxt}
                  className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-slate-500"
                >
                  TXT
                </button>
                <button
                  type="button"
                  onClick={exportMarkdown}
                  className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-slate-500"
                >
                  MD
                </button>
                <button
                  type="button"
                  onClick={exportCsv}
                  className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-slate-500"
                >
                  CSV
                </button>
                <button
                  type="button"
                  onClick={exportPdf}
                  className="rounded-full border border-slate-700 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-200 transition hover:border-slate-500"
                >
                  PDF
                </button>
              </div>

              {recording.summary ? (
                <div className="rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-3 text-sm text-slate-300">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-slate-500">
                    <FileText className="h-3.5 w-3.5" /> Summary
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{buildSnippet(recording.summary)}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-500">Summary pending…</p>
              )}

              {latestEvent && (
                <div className="text-xs text-slate-500">
                  Last update {formatDate(latestEvent.createdAt)} — {latestEvent.detail ?? latestEvent.status}
                </div>
              )}
            </div>
          );
        })}

        {(canLoadMore || visibleCount > 6) && (
          <div className="flex flex-wrap justify-center gap-3">
            {canLoadMore && (
              <button
                type="button"
                onClick={() => setVisibleCount((count) => Math.min(count + 6, filteredRecordings.length))}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
              >
                Load more sessions
              </button>
            )}
            {visibleCount > 6 && (
              <button
                type="button"
                onClick={() => setVisibleCount(6)}
                className="rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
              >
                Show fewer
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
