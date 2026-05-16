import React from "react";
import type { ConnectionStatus } from "../client/RelayClient";

interface Props {
  roomId: string;
  onRoomIdChange: (v: string) => void;
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  disconnected: "未连接",
  connecting: "连接中",
  reconnecting: "重连中",
  connected: "已连接",
  failed: "已失败(5 次重连用尽)",
};

export function ConnectionPanel({
  roomId,
  onRoomIdChange,
  status,
  onConnect,
  onDisconnect,
}: Props): JSX.Element {
  const busy = status === "connecting" || status === "reconnecting";
  return (
    <section className="panel">
      <div className="panel__title">连接</div>
      <div className="row">
        <input
          type="text"
          placeholder="room_id (≥ 32 字符)"
          value={roomId}
          onChange={(e) => onRoomIdChange(e.target.value)}
          disabled={status === "connected" || busy}
        />
        {status === "connected" || busy ? (
          <button onClick={onDisconnect}>断开</button>
        ) : (
          <button onClick={onConnect}>连接</button>
        )}
      </div>
      <div className="row">
        <span className={`status-dot status-dot--${status}`} />
        <span>{STATUS_LABEL[status]}</span>
      </div>
    </section>
  );
}
