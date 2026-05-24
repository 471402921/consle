import React from "react";
import type { Envelope, CharacterState, BridgeError } from "@cute/shared";

interface Props {
  state: CharacterState["payload"] | null;
  lastEnvelope: Envelope | null;
  lastError: BridgeError["payload"] | null;
}

// cute_pixel interior_scene 的假设 viewport 大小。
// TODO: 真值应该跟着 CHARACTER_STATE 一起上报(proto 加 viewport 字段),
// 在那之前先 hardcode 一个 4:3 假设,让点位置至少能可视化。
const VIEWPORT_W = 270;
const VIEWPORT_H = 480;

const SVG_W = 180;
const SVG_H = (SVG_W * VIEWPORT_H) / VIEWPORT_W;

const ANIM_LABELS: Record<string, string> = {
  idle_south: "站立",
  walk_south: "走路(南)",
  "walk-north": "走路(北)",
  walk_east: "走路(东)",
  "walk-west": "走路(西)",
  "lie-down": "趴下",
  yawn: "打哈欠",
  sleeping: "睡觉中",
  eating: "吃东西",
  "happy-jumping": "开心跳",
};

function animLabel(anim: string): string {
  return ANIM_LABELS[anim] ?? anim;
}

function scaleX(x: number): number {
  return (x / VIEWPORT_W) * SVG_W;
}
function scaleY(y: number): number {
  return (y / VIEWPORT_H) * SVG_H;
}

export function CharacterView({ state, lastEnvelope, lastError }: Props): JSX.Element {
  const cx = state ? scaleX(state.position.x) : null;
  const cy = state ? scaleY(state.position.y) : null;
  const inBounds =
    state &&
    state.position.x >= 0 &&
    state.position.x <= VIEWPORT_W &&
    state.position.y >= 0 &&
    state.position.y <= VIEWPORT_H;

  return (
    <section className="panel">
      <div className="panel__title">角色状态</div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <svg
          width={SVG_W}
          height={SVG_H}
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid #555", borderRadius: 4 }}
        >
          {/* viewport border (虚线提示是假设值) */}
          <rect
            x="0.5"
            y="0.5"
            width={SVG_W - 1}
            height={SVG_H - 1}
            stroke="#555"
            strokeDasharray="3 3"
            fill="none"
          />
          {state && cx !== null && cy !== null && (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={5}
                fill={inBounds ? "#2ecc71" : "#e74c3c"}
                stroke="#fff"
                strokeWidth={1}
              />
              <text
                x={cx + 8}
                y={cy - 6}
                fill="#ddd"
                fontSize={10}
                fontFamily="ui-monospace, monospace"
              >
                {state.animation}
              </text>
            </>
          )}
          {/* 缩放标记 */}
          <text x={4} y={SVG_H - 4} fill="#666" fontSize={9} fontFamily="ui-monospace, monospace">
            {VIEWPORT_W}×{VIEWPORT_H} (假设)
          </text>
        </svg>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, flex: 1 }}>
          {state ? (
            <>
              <div>位置: ({state.position.x.toFixed(0)}, {state.position.y.toFixed(0)})</div>
              <div>动画: {animLabel(state.animation)}<span style={{ color: "#666", fontSize: 11 }}> ({state.animation})</span></div>
              <div>模式: {state.control_mode}</div>
              {!inBounds && (
                <div style={{ color: "#e74c3c", fontSize: 11 }}>
                  ⚠ 位置超出假设 viewport({VIEWPORT_W}×{VIEWPORT_H})
                </div>
              )}
            </>
          ) : (
            <div style={{ color: "#888" }}>暂未收到 CHARACTER_STATE</div>
          )}
        </div>
      </div>

      {lastError && (
        <div style={{ background: "rgba(231,76,60,0.15)", border: "1px solid #e74c3c", borderRadius: 4, padding: 8, fontSize: 12 }}>
          <strong>BRIDGE_ERROR</strong> [{lastError.code}]{lastError.originalType ? ` (${lastError.originalType})` : ""}: {lastError.message}
        </div>
      )}

      <div className="panel__title" style={{ marginTop: 8 }}>最近一帧 envelope (debug)</div>
      <pre>{lastEnvelope ? JSON.stringify(lastEnvelope, null, 2) : "—"}</pre>
    </section>
  );
}
