export function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
