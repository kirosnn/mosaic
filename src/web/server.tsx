import { serve } from "bun";
import { join } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { build } from "bun";
import { createCliRenderer, TextAttributes } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React from "react";
import { exec } from "child_process";
import type { ImagePart, TextPart, UserContent } from "ai";
import type { ImageAttachment } from "../utils/images";

const PORT = 8192;
const HOST = "127.0.0.1";

import { subscribeQuestion, answerQuestion } from "../utils/questionBridge";
import { subscribeApproval, respondApproval, getCurrentApproval } from "../utils/approvalBridge";

let currentAbortController: AbortController | null = null;

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

function buildUserContent(text: string, images?: ImageAttachment[]): UserContent {
    if (!images || images.length === 0) return text;
    const parts: Array<TextPart | ImagePart> = [];
    parts.push({ type: "text", text });
    for (const img of images) {
        parts.push({ type: "image", image: img.data, mimeType: img.mimeType });
    }
    return parts;
}

function buildConversationHistory(
    history: Array<{ role: string; content: string; images?: ImageAttachment[] }>,
    allowImages: boolean
) {
    return history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
            if (m.role === "user") {
                const content = allowImages ? buildUserContent(m.content, m.images) : m.content;
                return { role: "user" as const, content };
            }
            return { role: "assistant" as const, content: m.content };
        });
}

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


let currentPort = PORT;

async function startServer(port: number, maxRetries = 10) {
    try {
        const server = serve({
            port: port,
            hostname: HOST,
            idleTimeout: 0,
            async fetch(request) {
                const url = new URL(request.url);

                try {
                    const isApiRoute = url.pathname.startsWith('/api/');
                    const isStaticFile = url.pathname.match(/\.(js|css|svg|ico|png|jpg|jpeg|gif|webp|woff|woff2|ttf|eot)$/);

                    if (url.pathname === "/" || url.pathname === "/home" || url.pathname.startsWith("/chat")) {
                        addLog(`${request.method} ${url.pathname}`);
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

                    if (url.pathname === "/api/workspace" && request.method === "POST") {
                        const body = (await request.json()) as { path: string };
                        if (!body.path || typeof body.path !== "string") {
                            return new Response(JSON.stringify({ error: "Invalid path" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }

                        try {
                            process.chdir(body.path);
                            return new Response(JSON.stringify({ success: true, workspace: process.cwd() }), {
                                headers: { "Content-Type": "application/json" },
                            });
                        } catch (error) {
                            return new Response(JSON.stringify({ error: "Failed to change directory" }), {
                                status: 500,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                    }

                    if (url.pathname === "/api/files" && request.method === "GET") {
                        const urlObj = new URL(request.url);
                        const queryPath = urlObj.searchParams.get("path");
                        const currentPath = queryPath || process.cwd();

                        try {
                            if (!existsSync(currentPath)) {
                                return new Response(JSON.stringify({ error: "Path does not exist" }), {
                                    status: 404,
                                    headers: { "Content-Type": "application/json" },
                                });
                            }

                            const items = readdirSync(currentPath, { withFileTypes: true });
                            const files = items.map((item) => ({
                                name: item.name,
                                isDirectory: item.isDirectory(),
                                path: join(currentPath, item.name)
                            })).sort((a, b) => {
                                if (a.isDirectory === b.isDirectory) {
                                    return a.name.localeCompare(b.name);
                                }
                                return a.isDirectory ? -1 : 1;
                            });

                            return new Response(JSON.stringify({
                                path: currentPath,
                                files
                            }), {
                                headers: { "Content-Type": "application/json" },
                            });

                        } catch (error) {
                            return new Response(JSON.stringify({ error: "Failed to list files" }), {
                                status: 500,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                    }

                    if (url.pathname === "/api/recent-projects" && request.method === "GET") {
                        const { getRecentProjects } = await import("../utils/config");
                        const recentProjects = getRecentProjects();
                        return new Response(JSON.stringify(recentProjects), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/config" && request.method === "GET") {
                        const { readConfig } = await import("../utils/config");
                        const config = readConfig();
                        return new Response(JSON.stringify({
                            provider: config.provider,
                            model: config.model,
                            requireApprovals: config.requireApprovals !== false
                        }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/approvals" && request.method === "GET") {
                        const { readConfig } = await import("../utils/config");
                        const config = readConfig();
                        return new Response(JSON.stringify({
                            requireApprovals: config.requireApprovals !== false
                        }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/approvals" && request.method === "POST") {
                        const body = (await request.json()) as { requireApprovals?: boolean };
                        if (typeof body.requireApprovals !== "boolean") {
                            return new Response(JSON.stringify({ error: "Invalid requireApprovals value" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                        const { setRequireApprovals } = await import("../utils/config");
                        setRequireApprovals(body.requireApprovals);
                        if (!body.requireApprovals && getCurrentApproval()) {
                            respondApproval(true);
                        }
                        return new Response(JSON.stringify({ success: true, requireApprovals: body.requireApprovals }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/tui-conversations" && request.method === "GET") {
                        const { loadConversations } = await import("../utils/history");
                        const historyConversations = loadConversations();
                        const mapped = historyConversations.map((conv) => {
                            const steps = Array.isArray(conv.steps) ? conv.steps : [];
                            const baseTimestamp = typeof conv.timestamp === "number" ? conv.timestamp : Date.now();
                            const messages = steps.map((step, index) => ({
                                id: `${conv.id}_${index}`,
                                role: step.type === "tool" ? "tool" : step.type,
                                content: step.content,
                                images: step.images,
                                toolName: step.toolName,
                                toolArgs: step.toolArgs,
                                toolResult: step.toolResult,
                                timestamp: step.timestamp,
                                responseDuration: step.responseDuration,
                                blendWord: step.blendWord
                            }));

                            return {
                                id: `tui_${conv.id}`,
                                title: conv.title ?? null,
                                messages,
                                workspace: conv.workspace ?? null,
                                createdAt: baseTimestamp,
                                updatedAt: baseTimestamp
                            };
                        });

                        return new Response(JSON.stringify(mapped), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/tui-conversation/rename" && request.method === "POST") {
                        const body = (await request.json()) as { id: string; title: string | null };
                        if (!body?.id || typeof body.id !== "string") {
                            return new Response(JSON.stringify({ error: "Invalid id" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                        const historyId = body.id.startsWith("tui_") ? body.id.slice(4) : body.id;
                        const { updateConversationTitle } = await import("../utils/history");
                        const success = updateConversationTitle(historyId, body.title ?? null);
                        return new Response(JSON.stringify({ success }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/tui-conversation/delete" && request.method === "POST") {
                        const body = (await request.json()) as { id: string };
                        if (!body?.id || typeof body.id !== "string") {
                            return new Response(JSON.stringify({ error: "Invalid id" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                        const historyId = body.id.startsWith("tui_") ? body.id.slice(4) : body.id;
                        const { deleteConversation } = await import("../utils/history");
                        const success = deleteConversation(historyId);
                        return new Response(JSON.stringify({ success }), {
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

                    if (url.pathname === "/api/question/answer" && request.method === "POST") {
                        const body = (await request.json()) as { index: number; customText?: string };
                        answerQuestion(body.index, body.customText);
                        return new Response(JSON.stringify({ success: true }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/approval/respond" && request.method === "POST") {
                        const body = (await request.json()) as { approved: boolean; customResponse?: string };
                        respondApproval(body.approved, body.customResponse);
                        return new Response(JSON.stringify({ success: true }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/stop" && request.method === "POST") {
                        if (currentAbortController) {
                            currentAbortController.abort();
                            currentAbortController = null;
                            addLog("Agent stopped by user");
                            return new Response(JSON.stringify({ success: true, message: "Agent stopped" }), {
                                headers: { "Content-Type": "application/json" },
                            });
                        }
                        return new Response(JSON.stringify({ success: false, message: "No agent running" }), {
                            headers: { "Content-Type": "application/json" },
                        });
                    }

                    if (url.pathname === "/api/message" && request.method === "POST") {
                        const body = (await request.json()) as {
                            message?: string;
                            images?: ImageAttachment[];
                            history?: Array<{ role: string; content: string; images?: ImageAttachment[] }>;
                        };

                        if (typeof body.message !== "string") {
                            addLog("Invalid message format");
                            return new Response(JSON.stringify({ error: "Invalid message format" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }

                        const messageText = body.message ?? "";
                        const images = Array.isArray(body.images) ? body.images : [];

                        if (!messageText.trim() && images.length === 0) {
                            addLog("Empty message");
                            return new Response(JSON.stringify({ error: "Empty message" }), {
                                status: 400,
                                headers: { "Content-Type": "application/json" },
                            });
                        }

                        addLog("Message received");

                        currentAbortController = new AbortController();
                        const abortSignal = currentAbortController.signal;

                        const encoder = new TextEncoder();
                        const stream = new ReadableStream({
                            async start(controller) {
                                let keepAlive: ReturnType<typeof setInterval> | null = null;
                                let aborted = false;

                                const cleanup = () => {
                                    if (keepAlive) clearInterval(keepAlive);
                                    currentAbortController = null;
                                };

                                const safeEnqueue = (text: string) => {
                                    if (aborted) return false;
                                    try {
                                        controller.enqueue(encoder.encode(text));
                                        return true;
                                    } catch {
                                        return false;
                                    }
                                };

                                abortSignal.addEventListener('abort', () => {
                                    aborted = true;
                                    safeEnqueue(JSON.stringify({ type: 'stopped', message: 'Agent stopped by user' }) + "\n");
                                    cleanup();
                                    questionUnsub();
                                    approvalUnsub();
                                    exploreUnsub?.();
                                    try { controller.close(); } catch { }
                                });

                                const questionUnsub = subscribeQuestion((req) => {
                                    safeEnqueue(JSON.stringify({ type: 'question', request: req }) + "\n");
                                });


                                const approvalUnsub = subscribeApproval((req) => {
                                    safeEnqueue(JSON.stringify({ type: 'approval', request: req }) + "\n");
                                });

                                keepAlive = setInterval(() => {
                                    safeEnqueue(JSON.stringify({ type: 'ping' }) + "\n");
                                }, 5000);

                                let exploreUnsub: (() => void) | null = null;

                                try {
                                    const { Agent } = await import("../agent");
                                    const { subscribeExploreTool } = await import("../utils/exploreBridge");

                                    addLog("[EXPLORE] Subscribing...");
                                    exploreUnsub = subscribeExploreTool((event) => {
                                        addLog(`[EXPLORE] Tool: ${event.toolName}`);
                                        safeEnqueue(JSON.stringify({ type: 'explore-tool', ...event }) + "\n");
                                    });
                                    addLog("[EXPLORE] Subscribed");
                                    const providerStatus = await Agent.ensureProviderReady();

                                    if (!providerStatus.ready) {
                                        safeEnqueue(
                                            JSON.stringify({
                                                type: "error",
                                                error: providerStatus.error || "Provider not ready",
                                            }) + "\n"
                                        );
                                        cleanup();
                                        questionUnsub();
                                        approvalUnsub();
                                        exploreUnsub?.();
                                        controller.close();
                                        return;
                                    }

                                    const agent = new Agent();
                                    let allowImages = false;
                                    try {
                                        const { readConfig } = await import("../utils/config");
                                        const config = readConfig();
                                        if (config.model) {
                                            const { findModelsDevModelById, modelAcceptsImages } = await import("../utils/models");
                                            const result = await findModelsDevModelById(config.model);
                                            allowImages = Boolean(result && result.model && modelAcceptsImages(result.model));
                                        }
                                    } catch { }

                                    const conversationHistory = buildConversationHistory(body.history || [], allowImages);
                                    const userImages = allowImages ? images : [];
                                    conversationHistory.push({
                                        role: "user",
                                        content: allowImages ? buildUserContent(messageText, userImages) : messageText
                                    });


                                    for await (const event of agent.streamMessages(conversationHistory as any, {})) {
                                        if (aborted) break;
                                        if (!safeEnqueue(JSON.stringify(event) + "\n")) break;
                                    }

                                    cleanup();
                                    questionUnsub();
                                    approvalUnsub();
                                    exploreUnsub?.();
                                    if (!aborted) controller.close();
                                } catch (error) {
                                    if (!aborted) {
                                        safeEnqueue(
                                            JSON.stringify({
                                                type: "error",
                                                error: error instanceof Error ? error.message : "Unknown error",
                                            }) + "\n"
                                        );
                                    }
                                    cleanup();
                                    questionUnsub();
                                    approvalUnsub();
                                    exploreUnsub?.();
                                    try { controller.close(); } catch { }
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

        currentPort = port;
        const serverUrl = `http://${HOST}:${port}`;
        const openCommand = process.platform === "win32" ? `start ${serverUrl}` :
            process.platform === "darwin" ? `open ${serverUrl}` :
                `xdg-open ${serverUrl}`;

        exec(openCommand, (error) => {
            if (error) {
                console.error("Failed to open browser:", error);
            }
        });

        return server;
    } catch (err: any) {
        if (err.code === "EADDRINUSE") {
            if (maxRetries > 0) {
                console.log(`Port ${port} is in use, trying ${port + 1}...`);
                return startServer(port + 1, maxRetries - 1);
            } else {
                console.error(`Failed to find an available port after retries.`);
                throw err;
            }
        } else {
            throw err;
        }
    }
}

await startServer(PORT);

function ServerStatus() {
    const [logList, setLogList] = React.useState<LogEntry[]>(logs);
    const [scrollOffset, setScrollOffset] = React.useState(0);
    const [terminalHeight, setTerminalHeight] = React.useState(process.stdout.rows || 24);

    React.useEffect(() => {
        const listener = () => {
            setLogList([...logs]);
            setScrollOffset(Math.max(0, logs.length - (terminalHeight - 6)));
        };
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }, [terminalHeight]);

    React.useEffect(() => {
        const handleResize = () => {
            setTerminalHeight(process.stdout.rows || 24);
        };
        process.stdout.on('resize', handleResize);
        return () => {
            process.stdout.off('resize', handleResize);
        };
    }, []);

    React.useEffect(() => {
        const handleData = (data: Buffer) => {
            const str = data.toString();
            if (str.includes('\x03')) {
                process.exit(0);
            }

            if (str.match(/\x1b\[<64;\d+;\d+M/)) {
                setScrollOffset(prev => Math.max(0, prev - 1));
            } else if (str.match(/\x1b\[<65;\d+;\d+M/)) {
                setScrollOffset(prev => prev + 1);
            }
        };

        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
            process.stdout.write('\x1b[?1000h\x1b[?1006h\x1b[?1003h');
            process.stdin.on('data', handleData);
        }

        return () => {
            if (process.stdin.isTTY) {
                process.stdin.off('data', handleData);
                process.stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?1003l');
                process.stdin.setRawMode(false);
            }
        };
    }, []);

    const logsHeight = Math.max(5, terminalHeight - 6);
    const visibleLogs = logList.slice(scrollOffset, scrollOffset + logsHeight);

    return (
        <box flexDirection="column" width="100%" height="100%" justifyContent="flex-start" alignItems="center" paddingTop={1}>
            <box flexDirection="row" marginBottom={1}>
                <text fg="#ffca38" attributes={TextAttributes.BOLD}>
                    Web interface:{" "}
                </text>
                <text fg="gray">http://{HOST}:{currentPort}</text>
            </box>

            <box flexDirection="column" width={80} height={logsHeight} borderStyle="rounded" borderColor="gray" title={`Server Logs`}>
                {logList.length === 0 ? (
                    <text fg="gray" attributes={TextAttributes.DIM}>
                        No logs yet...
                    </text>
                ) : (
                    visibleLogs.map((log, i) => (
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
