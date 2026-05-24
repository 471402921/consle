import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  CharacterSetExternalControl,
  CharacterSetVelocity,
  SceneLoad,
  SceneName,
} from "@cute/shared";

interface Props {
  disabled: boolean;
  onSend: <T>(msg: T) => void;
  currentScene: SceneName;
  sceneLoading: boolean;
  onSceneLoadStart: () => void;
}

const SPEED = 120;

const KEY_DIR: Record<string, [number, number]> = {
  w: [0, -1], arrowup: [0, -1],
  s: [0, 1],  arrowdown: [0, 1],
  a: [-1, 0], arrowleft: [-1, 0],
  d: [1, 0],  arrowright: [1, 0],
};

export function ControlPanel({
  disabled,
  onSend,
  currentScene,
  sceneLoading,
  onSceneLoadStart,
}: Props): JSX.Element {
  const [external, setExternal] = useState(false);
  const keysDown = useRef(new Set<string>());

  const move = useCallback((x: number, y: number) => {
    const msg: CharacterSetVelocity = {
      type: "CHARACTER_SET_VELOCITY",
      payload: { x: x * SPEED, y: y * SPEED },
    };
    onSend(msg);
  }, [onSend]);

  const syncKeysToVelocity = useCallback(() => {
    let x = 0, y = 0;
    for (const k of keysDown.current) {
      const dir = KEY_DIR[k];
      if (dir) { x += dir[0]; y += dir[1]; }
    }
    move(Math.sign(x), Math.sign(y));
  }, [move]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (disabled || !external) return;
      const k = e.key.toLowerCase();
      if (!(k in KEY_DIR) || keysDown.current.has(k)) return;
      e.preventDefault();
      keysDown.current.add(k);
      syncKeysToVelocity();
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!keysDown.current.delete(k)) return;
      e.preventDefault();
      syncKeysToVelocity();
    };
    const onBlur = () => {
      if (keysDown.current.size > 0) {
        keysDown.current.clear();
        move(0, 0);
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [disabled, external, move, syncKeysToVelocity]);

  const toggleExternal = () => {
    const next = !external;
    setExternal(next);
    if (!next) {
      keysDown.current.clear();
    }
    const msg: CharacterSetExternalControl = {
      type: "CHARACTER_SET_EXTERNAL_CONTROL",
      payload: { enabled: next },
    };
    onSend(msg);
  };

  const dpadDown = (x: number, y: number) => move(x, y);
  const dpadUp = () => move(0, 0);

  const loadScene = (scene: SceneName) => {
    if (scene === currentScene || sceneLoading) return;
    onSceneLoadStart();
    const msg: SceneLoad = { type: "SCENE_LOAD", payload: { scene } };
    onSend(msg);
  };

  const sendSimple = (type: string) => {
    if (external) {
      onSend<CharacterSetExternalControl>({
        type: "CHARACTER_SET_EXTERNAL_CONTROL",
        payload: { enabled: false },
      });
      setExternal(false);
      keysDown.current.clear();
    }
    onSend({ type, payload: {} });
  };

  const dirBtn = (label: string, x: number, y: number) => (
    <button
      disabled={disabled || !external}
      onPointerDown={() => dpadDown(x, y)}
      onPointerUp={dpadUp}
      onPointerLeave={dpadUp}
    >
      {label}
    </button>
  );

  return (
    <>
      <section className="panel">
        <div className="panel__title">场景</div>
        <div className="row">
          <button
            className={currentScene === "interior_scene" ? "btn--active" : ""}
            disabled={disabled || (currentScene === "interior_scene" && !sceneLoading)}
            onClick={() => loadScene("interior_scene")}
          >
            室内
          </button>
          <button
            className={currentScene === "outdoor_scene" ? "btn--active" : ""}
            disabled={disabled || (currentScene === "outdoor_scene" && !sceneLoading)}
            onClick={() => loadScene("outdoor_scene")}
          >
            室外
          </button>
          {sceneLoading && (
            <span style={{ color: "#f5a623", fontSize: 12 }}>切换中...</span>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__title">行为控制</div>
        <div className="row">
          <button disabled={disabled} onClick={() => sendSimple("CHARACTER_FEED")}>
            喂食
          </button>
          <button disabled={disabled} onClick={() => onSend({ type: "CHARACTER_STOP_FEED", payload: {} })}>
            停止喂食
          </button>
          <span className="separator" />
          <button disabled={disabled} onClick={() => sendSimple("CHARACTER_SLEEP")}>
            睡觉
          </button>
          <button disabled={disabled} onClick={() => onSend({ type: "CHARACTER_WAKE", payload: {} })}>
            叫醒
          </button>
        </div>
        {external && (
          <span style={{ color: "#f5a623", fontSize: 12 }}>
            喂食/睡觉会自动关闭 external control
          </span>
        )}
      </section>

      <section className="panel">
        <div className="panel__title">遥控</div>
        <div className="row">
          <button onClick={toggleExternal} disabled={disabled}>
            {external ? "切回 autonomous" : "切到 external"}
          </button>
          <span style={{ color: "#888", fontSize: 12 }}>
            当前: {external ? "external" : "autonomous"}
            {external && " · WASD / 方向键可用"}
          </span>
        </div>

        <div className="dpad" style={{ opacity: external ? 1 : 0.5 }}>
          <span />
          {dirBtn("↑", 0, -1)}
          <span />
          {dirBtn("←", -1, 0)}
          <button disabled={disabled || !external} onClick={() => move(0, 0)}>·</button>
          {dirBtn("→", 1, 0)}
          <span />
          {dirBtn("↓", 0, 1)}
          <span />
        </div>
      </section>
    </>
  );
}
