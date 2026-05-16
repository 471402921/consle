import React from "react";
import type { Envelope, CharacterState } from "@cute/shared";

interface Props {
  state: CharacterState["payload"] | null;
  lastEnvelope: Envelope | null;
}

export function CharacterView({ state, lastEnvelope }: Props): JSX.Element {
  return (
    <section className="panel">
      <div className="panel__title">角色状态</div>
      {state ? (
        <div className="row" style={{ gap: 16 }}>
          <span>位置: ({state.position.x.toFixed(0)}, {state.position.y.toFixed(0)})</span>
          <span>动画: {state.animation}</span>
          <span>模式: {state.control_mode}</span>
        </div>
      ) : (
        <div style={{ color: "#888", fontSize: 13 }}>暂未收到 CHARACTER_STATE</div>
      )}
      <div className="panel__title" style={{ marginTop: 8 }}>最近一帧 envelope (debug)</div>
      <pre>{lastEnvelope ? JSON.stringify(lastEnvelope, null, 2) : "—"}</pre>
    </section>
  );
}
