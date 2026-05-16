import type { WebSocket } from "ws";
import type { Role } from "@cute/shared";

interface Member {
  socket: WebSocket;
  role: Role;
  missedPings: number;
}

export class Room {
  readonly id: string;
  private readonly members = new Set<Member>();

  constructor(id: string) {
    this.id = id;
  }

  add(socket: WebSocket, role: Role): Member {
    const member: Member = { socket, role, missedPings: 0 };
    this.members.add(member);
    return member;
  }

  remove(member: Member): void {
    this.members.delete(member);
  }

  isEmpty(): boolean {
    return this.members.size === 0;
  }

  size(): number {
    return this.members.size;
  }

  // 广播到反向 role 的所有连接。不解 frame 内容(§6 要求)。
  broadcastFromRole(fromRole: Role, rawFrame: Buffer | string): void {
    const targetRole: Role = fromRole === "app" ? "console" : "app";
    for (const m of this.members) {
      if (m.role === targetRole && m.socket.readyState === m.socket.OPEN) {
        m.socket.send(rawFrame);
      }
    }
  }

  forEach(cb: (m: Member) => void): void {
    for (const m of this.members) cb(m);
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  getOrCreate(id: string): Room {
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  cleanupIfEmpty(id: string): void {
    const room = this.rooms.get(id);
    if (room && room.isEmpty()) {
      this.rooms.delete(id);
    }
  }

  count(): number {
    return this.rooms.size;
  }
}
