import React, { useState } from "react";
import type {
  CharacterSetExternalControl,
  CharacterSetVelocity,
} from "@cute/shared";

interface Props {
  disabled: boolean;
  onSend: <T>(msg: T) => void;
}

const SPEED = 120; // px/sec,§5.1

export function ControlPanel({ disabled, onSend }: Props): JSX.Element {
  const [external, setExternal] = useState(false);

  const toggleExternal = () => {
    const next = !external;
    setExternal(next);
    const msg: CharacterSetExternalControl = {
      type: "CHARACTER_SET_EXTERNAL_CONTROL",
      payload: { enabled: next },
    };
    onSend(msg);
  };

  const move = (x: number, y: number) => {
    const msg: CharacterSetVelocity = {
      type: "CHARACTER_SET_VELOCITY",
      payload: { x: x * SPEED, y: y * SPEED },
    };
    onSend(msg);
  };

  return (
    <section className="panel">
      <div className="panel__title">控制</div>
      <div className="row">
        <button onClick={toggleExternal} disabled={disabled}>
          {external ? "切回 autonomous" : "切到 external"}
        </button>
        <span style={{ color: "#888", fontSize: 12 }}>
          当前 console 视角: {external ? "external" : "autonomous"}
        </span>
      </div>

      <div className="dpad" style={{ opacity: external ? 1 : 0.5 }}>
        <span />
        <button disabled={disabled || !external} onClick={() => move(0, -1)}>↑</button>
        <span />
        <button disabled={disabled || !external} onClick={() => move(-1, 0)}>←</button>
        <button disabled={disabled || !external} onClick={() => move(0, 0)}>·</button>
        <button disabled={disabled || !external} onClick={() => move(1, 0)}>→</button>
        <span />
        <button disabled={disabled || !external} onClick={() => move(0, 1)}>↓</button>
        <span />
      </div>
    </section>
  );
}
