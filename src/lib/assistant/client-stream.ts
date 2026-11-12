import type { AssistantStreamEvent } from "@/lib/assistant/conversation";

/** Reads the answer's server-sent events as they arrive. A truncated last event is dropped: the stream was cut. */
export async function readAssistantStream(response: Response, onEvent: (event: AssistantStreamEvent) => void) {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let end: number;
      while ((end = pending.indexOf("\n\n")) !== -1) {
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) onEvent(JSON.parse(data) as AssistantStreamEvent);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export type AssistantTextPart = { type: "text"; value: string } | { type: "line"; versionId: string; id: string; label: string };

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CITATION = new RegExp(`\\[\\[ligne:(${UUID})/(${UUID})\\|([^\\]\\n]{1,160})\\]\\]`, "gi");

/**
 * An answer as text and line citations (`[[ligne:<versionId>/<lineId>|<label>]]`:
 * the line is opened in the estimate it belongs to, not in the one on screen).
 * While the answer streams, a citation whose end has not arrived yet is held back.
 */
export function splitAssistantText(text: string, streaming: boolean): AssistantTextPart[] {
  let visible = text;
  if (streaming) {
    const open = visible.lastIndexOf("[[");
    if (open !== -1 && !visible.slice(open).includes("]]")) visible = visible.slice(0, open);
    else if (visible.endsWith("[")) visible = visible.slice(0, -1);
  }
  const parts: AssistantTextPart[] = [];
  let cursor = 0;
  for (const match of visible.matchAll(CITATION)) {
    if (match.index > cursor) parts.push({ type: "text", value: visible.slice(cursor, match.index) });
    parts.push({ type: "line", versionId: match[1]!, id: match[2]!, label: match[3]!.trim() });
    cursor = match.index + match[0].length;
  }
  if (cursor < visible.length) parts.push({ type: "text", value: visible.slice(cursor) });
  return parts;
}
