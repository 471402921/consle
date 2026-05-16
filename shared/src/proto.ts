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

export type GodotCommand = CharacterSetExternalControl | CharacterSetVelocity;

export interface CharacterState {
  type: "CHARACTER_STATE";
  payload: {
    position: { x: number; y: number };
    animation: string;
    control_mode: "autonomous" | "external";
  };
}

export type GodotEvent = CharacterState;
