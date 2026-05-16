import { createServer, type IncomingMessage } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { isValidRoomId, type Role } from "@cute/shared";
import { RoomRegistry } from "./room.js";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "127.0.0.1";
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MISSED_PINGS = 3;

const registry = new RoomRegistry();
const missedPings = new Map<WebSocket, number>();

function parseRequest(req: IncomingMessage): { roomId: string; role: Role } | null {
  if (!req.url) return null;
  const url = new URL(req.url, "http://localhost");
  const match = url.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!match) return null;
  const roomId = decodeURIComponent(match[1]!);
  const role = url.searchParams.get("role");
  if (role !== "app" && role !== "console") return null;
  return { roomId, role };
}

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, rooms: registry.count() }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const parsed = parseRequest(req);
  if (!parsed) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!isValidRoomId(parsed.roomId)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, parsed.roomId, parsed.role);
  });
});

function handleConnection(ws: WebSocket, roomId: string, role: Role): void {
  const room = registry.getOrCreate(roomId);
  const member = room.add(ws, role);
  missedPings.set(ws, 0);

  const shortId = roomId.slice(0, 8);
  console.log(`[${new Date().toISOString()}] connect room=${shortId}... role=${role} size=${room.size()}`);

  ws.on("message", (data, isBinary) => {
    const frame = isBinary ? (data as Buffer) : data.toString();
    room.broadcastFromRole(role, frame);
  });

  ws.on("pong", () => {
    missedPings.set(ws, 0);
  });

  ws.on("close", () => {
    room.remove(member);
    registry.cleanupIfEmpty(roomId);
    missedPings.delete(ws);
    console.log(`[${new Date().toISOString()}] close   room=${shortId}... role=${role} size=${room.size()}`);
  });

  ws.on("error", (err) => {
    console.error(`[${new Date().toISOString()}] error   room=${shortId}... role=${role} err=${err.message}`);
  });
}

setInterval(() => {
  wss.clients.forEach((ws) => {
    const missed = (missedPings.get(ws) ?? 0) + 1;
    if (missed > MAX_MISSED_PINGS) {
      ws.terminate();
      return;
    }
    missedPings.set(ws, missed);
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

httpServer.listen(PORT, HOST, () => {
  console.log(`relay listening on ${HOST}:${PORT}`);
});
