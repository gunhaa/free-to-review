import { isRecord } from "../guards.js";
import { errorMessage } from "./body.js";
// Splits complete lines off the buffer and returns the payloads of their data: fields.
export function parseSseLines(buffer) {
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";
    const events = [];
    for (let line of lines) {
        if (line.endsWith("\r"))
            line = line.slice(0, -1);
        if (!line.startsWith("data:"))
            continue;
        const payload = line.slice(5);
        events.push(payload.startsWith(" ") ? payload.slice(1) : payload);
    }
    return { events, rest };
}
// Reads an OpenAI-compatible chat completions stream. The text is returned untrimmed.
export async function readChatStream(body, onFirst) {
    const reader = body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let text = "";
    let finished = false;
    let seen = false;
    // Returns an outcome once the stream has said its last word.
    const handle = (events) => {
        for (const payload of events) {
            if (!seen) {
                seen = true;
                onFirst();
            }
            if (payload === "[DONE]")
                return { kind: "done", text };
            let event;
            try {
                event = JSON.parse(payload);
            }
            catch {
                continue;
            }
            const error = errorMessage(event);
            if (error !== undefined)
                return { kind: "error", message: error };
            if (!isRecord(event) || !Array.isArray(event.choices))
                continue;
            const choice = event.choices[0];
            if (!isRecord(choice))
                continue;
            // Reasoning models stream reasoning_content first; only content is the answer.
            if (isRecord(choice.delta) && typeof choice.delta.content === "string")
                text += choice.delta.content;
            if (choice.finish_reason !== null && choice.finish_reason !== undefined)
                finished = true;
        }
        return undefined;
    };
    for (;;) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const parsed = done ? parseSseLines(`${buffer}\n`) : parseSseLines(buffer);
        buffer = parsed.rest;
        const outcome = handle(parsed.events);
        if (outcome !== undefined) {
            if (!done)
                await reader.cancel().catch(() => { });
            return outcome;
        }
        if (done)
            return finished ? { kind: "done", text } : { kind: "truncated" };
    }
}
