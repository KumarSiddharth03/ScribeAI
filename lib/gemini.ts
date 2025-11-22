/**
 * Gemini helper utilities for streaming diarized transcripts and generating
 * meeting summaries from stored chunk context.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

import { env } from "@/lib/env";

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY ?? "");
const MODEL_ID = env.GEMINI_MODEL ?? "gemini-1.5-flash";

type TranscribeOptions = {
  context?: string;
};

export async function transcribeChunk(base64Audio: string, options?: TranscribeOptions) {
  if (!env.GEMINI_API_KEY) {
    return {
      text: "",
      confidence: 0,
    };
  }

  const model = genAI.getGenerativeModel({ model: MODEL_ID });
  const trimmedContext = options?.context ? options.context.slice(-2000) : "";
  const prompt = `You are a meticulous meeting scribe handling accents, crosstalk, and background noise.
Continue the transcript using diarized speaker tags like "Speaker A:" or "Speaker B:".
Guidelines:
- Treat each new line as a single speaker turn: "Speaker X: sentence…". Never mix two speakers on one line.
- Use the trimmed context below to keep speaker letters consistent. Only introduce a new letter when a clearly new voice appears.
- If you are unsure which speaker is talking, reuse the most recent confident speaker label or mark the line as "Speaker ?:".
- ONLY output words you are confident were spoken. If audio is unclear, emit "[inaudible]" instead of guessing.
- Do not hallucinate names, metrics, or jargon that are not clearly heard.
- Keep profanity exactly as spoken; do not censor.
- Limit output to one or two sentences for this chunk.
Context (may be empty): ${trimmedContext || "<none>"}`;

  const response = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "audio/webm",
              data: base64Audio,
            },
          },
        ],
      },
    ],
  });

  const text = response.response.text();
  return {
    text,
    confidence: 0.92,
  };
}

export async function summarizeTranscript(transcript: string) {
  if (!env.GEMINI_API_KEY) {
    return "";
  }

  const model = genAI.getGenerativeModel({ model: MODEL_ID });
  const prompt = `You are an expert meeting scribe. The transcript may include background noise, accents, or partial phrases—ignore any uncertain fragments.
Produce exactly three Markdown sections with concise bullet lists.

### Key points
- Capture factual highlights only.

### Action items
- List each follow-up task with the owner and due date (use "TBD" if absent).

### Decisions
- Note any confirmed decisions and who approved them.

Rules: Never invent content, never speculate, and omit anything marked [inaudible].
Transcript:
${transcript}`;
  const result = await model.generateContent(prompt);
  return result.response.text();
}
