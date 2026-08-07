export interface Room {
  id: string;
  type: string;
  users: string[];
}

export const rooms = new Map<string, Room>();

export function getRoom(id: string): Room | null {
  return rooms.get(id) ?? null;
}
