export interface User {
  id: string;
  name: string;
  rooms: Record<string, string>;
  last: number;
}

export const users = new Map<string, User>();

export function getUser(id: string): User | null {
  return users.get(id) ?? null;
}
