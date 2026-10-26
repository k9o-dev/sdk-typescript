/**
 * Minimal SSE (Server-Sent Events) stream parser — internal.
 *
 * Used by:
 *   - `client.compute.llms.invokeStream()` (`/invoke-stream`)
 *   - `client.realtime.subscribe()` SSE transport fallback
 *
 * Parses an SSE byte stream (a `ReadableStream<Uint8Array>` from a fetch
 * `Response.body`) into an async iterable of parsed `data:` payloads.
 * Each event's `data:` field is JSON-parsed; events whose data is the
 * sentinel `[DONE]` terminate the stream (OpenAI-compatible convention,
 * matched by the gateway's streaming surfaces).
 *
 * Per the SDK-abstracted-primitive discipline
 * (`feedback_sdk_abstracted_primitive_default_to_richer_interaction.md`),
 * transport mechanics stay internal; consumers see a clean async iterable.
 */

/**
 * Parse an SSE stream into an async iterable of JSON-decoded `data:`
 * payloads. Multi-line `data:` fields are concatenated with `\n` per the
 * SSE spec; the assembled payload is `JSON.parse`d. Non-JSON payloads
 * yield the raw string.
 */
export async function* parseSseStream<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line (\n\n). Process complete events.
      let sepIndex: number;
      while ((sepIndex = indexOfEventBoundary(buffer)) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex).replace(/^(\r?\n)+/, "");
        const payload = extractData(rawEvent);
        if (payload === null) continue;
        if (payload === "[DONE]") return;
        yield decodePayload<T>(payload);
      }
    }

    // Flush any trailing event without a terminating blank line.
    const tail = buffer.trim();
    if (tail.length > 0) {
      const payload = extractData(tail);
      if (payload !== null && payload !== "[DONE]") {
        yield decodePayload<T>(payload);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function indexOfEventBoundary(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/** Extract + concatenate `data:` lines from a single raw SSE event block. */
function extractData(rawEvent: string): string | null {
  const lines = rawEvent.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue; // comment / heartbeat
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^ /, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return dataLines.join("\n");
}

function decodePayload<T>(payload: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return payload as unknown as T;
  }
}

/** One SSE frame with its control fields. */
export type SseFrame = {
  /** The `id:` field, when the frame has one. */
  id?: string;
  /** The `event:` field, when the frame has one. */
  event?: string;
  /** The assembled `data:` text, or null for a frame that carries none (a comment, a `retry:` hint). */
  data: string | null;
  /** The `retry:` hint in milliseconds, when the frame carries a valid one. */
  retry?: number;
};

/**
 * Parse an SSE byte stream into frames, keeping `id:`, `event:` and `retry:` (which `parseSseStream` drops). Frames are
 * separated by a blank line; comment lines are ignored. A trailing frame without its blank line is still returned.
 */
export async function* parseSseFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = indexOfEventBoundary(buffer)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n)+/, "");
        const frame = frameFrom(raw);
        if (frame !== null) yield frame;
      }
    }
    const tail = buffer.trim();
    if (tail.length > 0) {
      const frame = frameFrom(tail);
      if (frame !== null) yield frame;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
    reader.releaseLock();
  }
}

function frameFrom(raw: string): SseFrame | null {
  const frame: SseFrame = { data: null };
  const data: string[] = [];
  let seen = false;
  for (const line of raw.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const val = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "data") data.push(val);
    else if (field === "id") frame.id = val;
    else if (field === "event") frame.event = val;
    else if (field === "retry" && /^[0-9]+$/.test(val)) frame.retry = Number(val);
    else continue;
    seen = true;
  }
  if (!seen) return null;
  if (data.length > 0) frame.data = data.join("\n");
  return frame;
}
