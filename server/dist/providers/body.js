import { isRecord } from "../guards.js";
const text = (v) => (typeof v === "string" && v.length > 0 ? v : undefined);
// OpenAI-style { error: { message } }, or an RFC 9457 problem+json { title, detail } (NVIDIA).
export function errorMessage(body) {
    if (!isRecord(body))
        return undefined;
    if (isRecord(body.error))
        return text(body.error.message) ?? "error";
    return text(body.detail) ?? text(body.title);
}
