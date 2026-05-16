import type { Envelope } from "@cute/shared";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

export interface RelayClientOptions {
  url: string; // 例: ws://localhost:8080
  roomId: string;
  maxReconnectAttempts?: number; // 默认 5,§4 必须做
}

type StatusListener = (s: ConnectionStatus) => void;
type MessageListener = (envelope: Envelope) => void;

export class RelayClient {
  private readonly url: string;
  private readonly roomId: string;
  private readonly maxReconnectAttempts: number;

  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualDisconnect = false;

  private readonly statusListeners = new Set<StatusListener>();
  private readonly messageListeners = new Set<MessageListener>();

  constructor(opts: RelayClientOptions) {
    this.url = opts.url;
    this.roomId = opts.roomId;
    this.maxReconnectAttempts = opts.maxReconnectAttempts ?? 5;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  onStatus(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  onMessage(cb: MessageListener): () => void {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  connect(): void {
    this.manualDisconnect = false;
    this.openSocket();
  }

  disconnect(): void {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.setStatus("disconnected");
  }

  send<Msg>(msg: Msg): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn("[RelayClient] send while not connected, dropping");
      return;
    }
    const envelope: Envelope<Msg> = {
      room_id: this.roomId,
      from: "console",
      ts: Date.now(),
      msg,
    };
    this.socket.send(JSON.stringify(envelope));
  }

  private openSocket(): void {
    this.setStatus(this.reconnectAttempts === 0 ? "connecting" : "reconnecting");
    const wsUrl = `${this.url}/room/${encodeURIComponent(this.roomId)}?role=console`;
    const socket = new WebSocket(wsUrl);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempts = 0;
      this.setStatus("connected");
    });

    socket.addEventListener("message", (e: MessageEvent<string | Blob>) => {
      if (typeof e.data !== "string") return; // 暂不支持 binary
      try {
        const env = JSON.parse(e.data) as Envelope;
        this.messageListeners.forEach((cb) => cb(env));
      } catch (err) {
        console.warn("[RelayClient] invalid envelope JSON", err);
      }
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.manualDisconnect) return;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // close 事件会跟进,这里不重复处理
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus("failed");
      return;
    }
    const delayMs = Math.pow(2, this.reconnectAttempts) * 1000; // 1s,2s,4s,8s,16s
    this.reconnectAttempts += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }
}
