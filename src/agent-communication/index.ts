export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: "chat" | "game-state" | "command" | "query" | "other";
  timestamp: number;
  payload: unknown;
}

export type AgentMessageType = AgentMessage["type"];

export interface AgentConfig {
  id: string;
  name: string;
  capabilities: string[];
}

interface HandlerEntry {
  handler: (msg: AgentMessage) => void;
  topics: Set<string>;
}

interface BusState {
  subscribers: Map<string, Set<HandlerEntry>>;
  messages: AgentMessage[];
  agentConfigs: Map<string, AgentConfig>;
}

const MAX_HISTORY = 500;

class AgentBus {
  private state: BusState = {
    subscribers: new Map(),
    messages: [],
    agentConfigs: new Map(),
  };

  registerAgent(config: AgentConfig): void {
    this.state.agentConfigs.set(config.id, config);
    if (!this.state.subscribers.has(config.id))
      this.state.subscribers.set(config.id, new Set());
  }

  unregisterAgent(agentId: string): void {
    this.state.subscribers.delete(agentId);
    this.state.agentConfigs.delete(agentId);
  }

  getAgentConfigs(): Map<string, AgentConfig> {
    return this.state.agentConfigs;
  }

  subscribe(
    agentId: string,
    topics: string[],
    handler: (msg: AgentMessage) => void,
  ): () => void {
    if (!this.state.agentConfigs.has(agentId)) return () => {};
    if (!this.state.subscribers.has(agentId))
      this.state.subscribers.set(agentId, new Set());
    const entry: HandlerEntry = { handler, topics: new Set(topics) };
    this.state.subscribers.get(agentId)!.add(entry);
    return () => {
      this.state.subscribers.get(agentId)?.delete(entry);
    };
  }

  publish(message: AgentMessage): AgentMessage[] {
    this.state.messages.push(message);
    if (this.state.messages.length > MAX_HISTORY) {
      this.state.messages = this.state.messages.slice(-MAX_HISTORY);
    }

    if (message.to && !this.state.agentConfigs.has(message.to)) {
      return [];
    }

    const recipients: string[] = message.to
      ? [message.to]
      : Array.from(this.state.agentConfigs.keys());

    const delivered: AgentMessage[] = [];
    for (const recipientId of recipients) {
      const handlers = this.state.subscribers.get(recipientId);
      if (!handlers) continue;
      for (const entry of handlers) {
        const matches =
          entry.topics.has(message.type) ||
          entry.topics.has(message.to) ||
          message.to === "" ||
          message.to === recipientId;
        if (!matches) continue;
        try {
          entry.handler(message);
          delivered.push(message);
        } catch (e) {
          console.error(`Error delivering message to ${recipientId}:`, e);
        }
      }
    }
    return delivered;
  }

  getRecentMessages(limit = 50): AgentMessage[] {
    return this.state.messages.slice(-limit);
  }
}

export const agentBus = new AgentBus();

export let AGENT_ID = "local-agent";

export const Topic = {
  GAME_STATE: "game-state",
  CHAT: "chat",
  COMMAND: "command",
  QUERY: "query",
  SYSTEM: "system",
} as const;

export function sendMessage(
  msg: Omit<AgentMessage, "id" | "timestamp"> &
    Partial<Pick<AgentMessage, "id" | "timestamp">>,
): AgentMessage[] {
  const full: AgentMessage = {
    id: msg.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: msg.timestamp ?? Date.now(),
    from: msg.from,
    to: msg.to ?? "",
    type: msg.type,
    payload: msg.payload,
  };
  return agentBus.publish(full);
}

export function onTopic(
  topics: string | string[],
  handler: (msg: AgentMessage) => void,
): () => void {
  const list = Array.isArray(topics) ? topics : [topics];
  const unsub = agentBus.subscribe(AGENT_ID, list, handler);
  const recent = agentBus
    .getRecentMessages()
    .filter(
      (msg) =>
        list.includes(msg.type) ||
        list.includes(msg.to) ||
        msg.to === "" ||
        msg.to === AGENT_ID,
    );
  recent.forEach(handler);
  return unsub;
}
