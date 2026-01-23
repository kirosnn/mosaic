import { serve } from "bun";
import { join } from "path";
import { existsSync } from "fs";
import { build } from "bun";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { exec } from "child_process";

const PORT = 8192;
const HOST = "127.0.0.1";

const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Mosaic</title>
    <link rel="icon" type="image/svg+xml" href="/logo_black.svg" media="(prefers-color-scheme: light)">
    <link rel="icon" type="image/svg+xml" href="/logo_white.svg" media="(prefers-color-scheme: dark)">
    <link rel="stylesheet" href="/app.css">
</head>
<body>
    <div id="root"></div>
    <script type="module" src="/app.js"></script>
</body>
</html>`;

type LogEntry = { message: string; timestamp: string };

const logs: LogEntry[] = [];
const listeners: Set<() => void> = new Set();

function addLog(message: string) {
    const timestamp = new Date().toLocaleTimeString();
    const clean = String(message ?? "").replace(/\r/g, "").trimEnd();
    if (!clean) return;

    const lines = clean.split("\n");
    for (const line of lines) {
        if (!line) continue;
        logs.push({ message: line, timestamp });

    }
    while (logs.length > 50) logs.shift();
    listeners.forEach((l) => l());
}

function installExternalLogCapture() {
    const originalLog = console.log.bind(console);
    const originalInfo = console.info.bind(console);
    const originalWarn = console.warn.bind(console);
    const originalError = console.error.bind(console);

    console.log = (...args: any[]) => {
        addLog(args.map(String).join(" "));
        originalLog(...args);
    };
    console.info = (...args: any[]) => {
        addLog(args.map(String).join(" "));
        originalInfo(...args);
    };
    console.warn = (...args: any[]) => {
        addLog(args.map(String).join(" "));
        originalWarn(...args);
    };
    console.error = (...args: any[]) => {
        addLog(args.map(String).join(" "));
        originalError(...args);
    };

    if (typeof process !== "undefined" && process?.stdout?.write) {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout) as (
            chunk: any,
            encoding?: any,
            cb?: any
        ) => boolean;

        process.stdout.write = ((chunk: any, encoding?: any, cb?: any) => {
            try {
                const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
                addLog(text);
            } catch { }
            return originalStdoutWrite(chunk, encoding as any, cb as any);
        }) as any;
    }

    if (typeof process !== "undefined" && process?.stderr?.write) {
        const originalStderrWrite = process.stderr.write.bind(process.stderr) as (
            chunk: any,
            encoding?: any,
            cb?: any
        ) => boolean;

        process.stderr.write = ((chunk: any, encoding?: any, cb?: any) => {
            try {
                const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
                addLog(text);
            } catch { }
            return originalStderrWrite(chunk, encoding as any, cb as any);
        }) as any;
    }
}

installExternalLogCapture();

let appJsContent: string | null = null;
let appCssContent: string | null = null;

async function buildApp() {
    const appPath = join(__dirname, "app.tsx");

    if (!existsSync(appPath)) {
        throw new Error(`App file not found at: ${appPath}`);
    }

    const buildResult = await build({
        entrypoints: [appPath],
        target: "browser",
        format: "esm",
        minify: false,
        splitting: false,
        sourcemap: "none",
    });


    if (!buildResult.success) {
        throw new Error("Build failed");
    }

    const outputs = buildResult.outputs;
    if (outputs.length === 0) {
        throw new Error("No build output generated");
    }

    for (const output of outputs) {
        if (output.path.endsWith('.js') || output.kind === 'entry-point') {
            appJsContent = await output.text();
        } else if (output.path.endsWith('.css') || output.type === 'text/css') {
            appCssContent = await output.text();
        }
    }
}

try {
    await buildApp();
    addLog("App built");

    const projectPath = process.env.MOSAIC_PROJECT_PATH;
    if (projectPath) {
        const { addRecentProject } = await import("../utils/config");
        addRecentProject(projectPath);
        addLog(`Project added to recents: ${projectPath}`);
    }
} catch (error) {
    console.error("Failed to build app:", error);
    throw error;
}

serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: 0,
    async fetch(request) {
        const url = new URL(request.url);

        try {
            if (url.pathname === "/") {
                addLog(`${request.method} /`);
                return new Response(HTML_TEMPLATE, {
                    headers: { "Content-Type": "text/html" },
                });

            }

            if (url.pathname === "/app.js") {
                if (!appJsContent) {
                    addLog("App not built");
                    return new Response("App not built", { status: 500 });

                }
                addLog(`${request.method} /app.js`);
                return new Response(appJsContent, {
                    headers: {
                        "Content-Type": "application/javascript",
                        "Cache-Control": "no-cache",
                    },
                });

            }

            if (url.pathname === "/app.css") {
                if (!appCssContent) {
                    return new Response("", { headers: { "Content-Type": "text/css" } });

                }
                addLog(`${request.method} /app.css`);
                return new Response(appCssContent, {
                    headers: {
                        "Content-Type": "text/css",
                        "Cache-Control": "no-cache",
                    },
                });

            }

            if (url.pathname === "/logo_black.svg") {
                const logoPath = join(__dirname, "logo_black.svg");
                if (existsSync(logoPath)) {
                    return new Response(Bun.file(logoPath), {
                        headers: { "Content-Type": "image/svg+xml" }
                    });

                }
                return new Response("Not Found", { status: 404 });

            }

            if (url.pathname === "/logo_white.svg") {
                const logoPath = join(__dirname, "logo_white.svg");
                if (existsSync(logoPath)) {
                    return new Response(Bun.file(logoPath), {
                        headers: { "Content-Type": "image/svg+xml" }
                    });

                }
                return new Response("Not Found", { status: 404 });

            }

            if (url.pathname === "/favicon.ico") {
                const faviconPath = join(__dirname, "favicon.ico");
                if (existsSync(faviconPath)) {
                    return new Response(Bun.file(faviconPath));
                }
                return new Response("Not Found", { status: 404 });

            }

            if (url.pathname === "/favicon.png") {
                const faviconPath = join(__dirname, "favicon.png");
                if (existsSync(faviconPath)) {
                    return new Response(Bun.file(faviconPath));
                }
                return new Response("Not Found", { status: 404 });

            }

            if (url.pathname === "/api/workspace" && request.method === "GET") {
                const workspace = process.cwd();
                return new Response(JSON.stringify({ workspace }), {
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (url.pathname === "/api/recent-projects" && request.method === "GET") {
                const { getRecentProjects } = await import("../utils/config");
                const recentProjects = getRecentProjects();
                return new Response(JSON.stringify(recentProjects), {
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (url.pathname === "/api/add-recent-project" && request.method === "POST") {
                const body = (await request.json()) as { path: string };
                if (!body.path || typeof body.path !== "string") {
                    return new Response(JSON.stringify({ error: "Invalid path" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    });
                }
                const { addRecentProject } = await import("../utils/config");
                addRecentProject(body.path);
                addLog(`Added recent project: ${body.path}`);
                return new Response(JSON.stringify({ success: true }), {
                    headers: { "Content-Type": "application/json" },
                });
            }

            if (url.pathname === "/api/message" && request.method === "POST") {
                const body = (await request.json()) as {
                    message: string;
                    history: Array<{ role: string; content: string }>;
                };

                if (!body.message || typeof body.message !== "string") {
                    addLog("Invalid message format");
                    return new Response(JSON.stringify({ error: "Invalid message format" }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" },
                    });

                }

                addLog("Message received");

                const encoder = new TextEncoder();
                const stream = new ReadableStream({
                    async start(controller) {
                        let keepAlive: ReturnType<typeof setInterval> | null = null;

                        const safeEnqueue = (text: string) => {
                            try {
                                controller.enqueue(encoder.encode(text));
                                return true;
                            } catch {
                                return false;
                            }
                        };

                        keepAlive = setInterval(() => {
                            safeEnqueue(JSON.stringify({ type: "ping" }) + "\n");
                        }, 5000);

                        try {
                            const { Agent } = await import("../agent");
                            const providerStatus = await Agent.ensureProviderReady();

                            if (!providerStatus.ready) {
                                safeEnqueue(
                                    JSON.stringify({
                                        type: "error",
                                        error: providerStatus.error || "Provider not ready",
                                    }) + "\n"
                                );
                                if (keepAlive) clearInterval(keepAlive);
                                controller.close();
                                return;
                            }

                            const agent = new Agent();
                            const conversationHistory = body.history || [];
                            conversationHistory.push({ role: "user", content: body.message });


                            for await (const event of agent.streamMessages(conversationHistory as any, {})) {
                                if (!safeEnqueue(JSON.stringify(event) + "\n")) break;
                            }

                            if (keepAlive) clearInterval(keepAlive);
                            controller.close();
                        } catch (error) {
                            safeEnqueue(
                                JSON.stringify({
                                    type: "error",
                                    error: error instanceof Error ? error.message : "Unknown error",
                                }) + "\n"
                            );
                            if (keepAlive) clearInterval(keepAlive);
                            controller.close();
                        }
                    },
                });


                return new Response(stream, {
                    headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        Connection: "keep-alive",
                    },
                });

            }

            addLog(`${request.method} ${url.pathname} (404)`);
            return new Response("Not Found", { status: 404 });

        } catch (error) {
            console.error("Request error:", error);
            addLog(`Server error: ${error instanceof Error ? error.message : "Unknown"}`);
            return new Response("Internal Server Error", { status: 500 });

        }
    },
    error(error) {
        console.error("Server error:", error);
        return new Response("Internal Server Error", { status: 500 });

    },
});

const serverUrl = `http://${HOST}:${PORT}`;
const openCommand = process.platform === "win32" ? `start ${serverUrl}` :
    process.platform === "darwin" ? `open ${serverUrl}` :
        `xdg-open ${serverUrl}`;

exec(openCommand, (error) => {
    if (error) {
        console.error("Failed to open browser:", error);
    }
});

function ServerStatus() {
    const [logList, setLogList] = React.useState<LogEntry[]>(logs);

    React.useEffect(() => {
        const listener = () => setLogList([...logs]);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return (
        <box flexDirection="column" width="100%" height="100%" justifyContent="center" alignItems="center">
            <box flexDirection="column" alignItems="center" marginBottom={2}>
                <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╗   ███╗</text>
                <text fg="#ffca38" attributes={TextAttributes.BOLD}>████╗ ████║</text>
                <text fg="#ffca38" attributes={TextAttributes.BOLD}>███╔████╔███║</text>
            </box>
            <box flexDirection="row" marginBottom={1}>
                <text fg="#ffca38" attributes={TextAttributes.BOLD}>
                    Web interface:{" "}
                </text>
                <text fg="gray">http://{HOST}:{PORT}</text>
            </box>

            <box flexDirection="column" width={80} borderStyle="rounded" borderColor="gray" title="Server Logs">
                {logList.length === 0 ? (
                    <text fg="gray" attributes={TextAttributes.DIM}>
                        No logs yet...
                    </text>
                ) : (
                    logList.map((log, i) => (
                        <text key={i} fg="gray">
                            [{log.timestamp}] {log.message}
                        </text>
                    ))
                )}
            </box>
        </box>
    );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<ServerStatus />);