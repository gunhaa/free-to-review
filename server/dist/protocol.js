import { createInterface } from "node:readline";
import { isRecord } from "./guards.js";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const failure = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
export function createSession(spec, send) {
    const toolNames = new Set(spec.tools.map(t => t.name));
    let clientCapabilities = {};
    let closed = false;
    let lastId = 0;
    // Server request ids are strings with their own prefix, so they never collide with client ids.
    const pending = new Map();
    const request = (method, params, timeoutMs) => {
        if (closed)
            return Promise.reject(new Error("connection closed"));
        const id = `s-${++lastId}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error("timeout"));
            }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            send({ jsonrpc: "2.0", id, method, params });
        });
    };
    // A response to one of our requests; anything we are not waiting for is ignored.
    const settle = (message) => {
        if (typeof message.id !== "string")
            return;
        const p = pending.get(message.id);
        if (!p)
            return;
        pending.delete(message.id);
        clearTimeout(p.timer);
        if ("error" in message) {
            const e = message.error;
            p.reject(new Error(isRecord(e) && typeof e.message === "string" ? e.message : "error"));
        }
        else {
            p.resolve(message.result);
        }
    };
    const callTool = async (id, params) => {
        if (!isRecord(params) || typeof params.name !== "string" || !toolNames.has(params.name)) {
            return failure(id, INVALID_PARAMS, "Unknown tool");
        }
        const args = params.arguments ?? {};
        if (!isRecord(args))
            return failure(id, INVALID_PARAMS, "arguments must be an object");
        let r;
        try {
            r = await spec.callTool(params.name, args, { clientCapabilities, request });
        }
        catch (err) {
            r = { text: `Tool failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
        return result(id, { content: [{ type: "text", text: r.text }], isError: r.isError });
    };
    const handle = async (message) => {
        if (!isRecord(message))
            return failure(null, INVALID_REQUEST, "Invalid request");
        const hasId = "id" in message;
        const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
        if (typeof message.method !== "string") {
            if (hasId && ("result" in message || "error" in message)) {
                settle(message);
                return null;
            }
            return failure(id, INVALID_REQUEST, "Invalid request");
        }
        if (!hasId)
            return null;
        const params = message.params;
        switch (message.method) {
            case "initialize": {
                const requested = isRecord(params) ? params.protocolVersion : undefined;
                const protocolVersion = typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
                if (isRecord(params) && isRecord(params.capabilities))
                    clientCapabilities = params.capabilities;
                return result(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: spec.name, version: spec.version } });
            }
            case "ping":
                return result(id, {});
            case "tools/list":
                return result(id, { tools: spec.tools });
            case "tools/call":
                return callTool(id, params);
            default:
                return failure(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
        }
    };
    const close = () => {
        closed = true;
        for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error("connection closed"));
        }
        pending.clear();
    };
    return { handle, close };
}
export function serveStdio(makeSession, input, output) {
    const write = (m) => {
        output.write(`${JSON.stringify(m)}\n`);
    };
    const session = makeSession(write);
    const inFlight = new Set();
    const lines = createInterface({ input, crlfDelay: Infinity });
    lines.on("line", line => {
        if (line.trim().length === 0)
            return;
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            write(failure(null, PARSE_ERROR, "Parse error"));
            return;
        }
        const id = isRecord(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null;
        const p = session.handle(message)
            .then(reply => {
            if (reply)
                write(reply);
        })
            .catch(err => write(failure(id, INTERNAL_ERROR, err instanceof Error ? err.message : String(err))))
            .finally(() => inFlight.delete(p));
        inFlight.add(p);
    });
    return new Promise(resolve => {
        lines.on("close", () => {
            // Nobody can answer a pending request any more, so let the tools waiting on one finish.
            session.close();
            void Promise.all(inFlight).then(() => resolve());
        });
    });
}
