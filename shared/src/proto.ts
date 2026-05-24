// 占位类型 —— 待 cute_pixel proto/messages.ts 落定后,从那边导入或复用。
// 见 [requirements.md §5](../../../requirements.md) Commands/Events 定义。

export interface CharacterSetExternalControl {
  type: "CHARACTER_SET_EXTERNAL_CONTROL";
  payload: { enabled: boolean };
}

export interface CharacterSetVelocity {
  type: "CHARACTER_SET_VELOCITY";
  payload: { x: number; y: number };
}

export interface SceneLoad {
  type: "SCENE_LOAD";
  payload: { scene: SceneName };
}

export interface CharacterFeed {
  type: "CHARACTER_FEED";
  payload: Record<string, never>;
}

export interface CharacterStopFeed {
  type: "CHARACTER_STOP_FEED";
  payload: Record<string, never>;
}

export interface CharacterSleep {
  type: "CHARACTER_SLEEP";
  payload: Record<string, never>;
}

export interface CharacterWake {
  type: "CHARACTER_WAKE";
  payload: Record<string, never>;
}

export type GodotCommand =
  | CharacterSetExternalControl
  | CharacterSetVelocity
  | SceneLoad
  | CharacterFeed
  | CharacterStopFeed
  | CharacterSleep
  | CharacterWake;

export type SceneName = "interior_scene" | "outdoor_scene";

export interface CharacterState {
  type: "CHARACTER_STATE";
  payload: {
    position: { x: number; y: number };
    animation: string;
    control_mode: "autonomous" | "external";
  };
}

export interface SceneLoaded {
  type: "SCENE_LOADED";
  payload: { scene: SceneName };
}

export interface BridgeError {
  type: "BRIDGE_ERROR";
  payload: {
    code: "INVALID_MESSAGE" | "UNKNOWN_TYPE" | "HANDLER_ERROR";
    message: string;
    originalType?: string;
  };
}

export type GodotEvent = CharacterState | SceneLoaded | BridgeError;
