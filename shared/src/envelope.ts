import type { GodotCommand, GodotEvent } from "./proto.js";

export type Role = "app" | "console";

export interface Envelope<Msg = GodotCommand | GodotEvent | unknown> {
  room_id: string;
  from: Role;
  ts: number;
  msg: Msg;
}

export const MIN_ROOM_ID_LENGTH = 32;

export function isValidRoomId(id: string): boolean {
  return typeof id === "string" && id.length >= MIN_ROOM_ID_LENGTH;
}
