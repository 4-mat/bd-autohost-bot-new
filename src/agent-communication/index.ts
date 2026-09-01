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

interface BusState {
  subscribers: Map<string, Set<(msg: AgentMessage) => void>>;
  messages: AgentMessage[];
  agentConfigs: Map<string, AgentConfig>;
  topics: Map<string, Set<string>>;
}

class AgentBus {
  private state: BusState = {
    subscribers: new Map(),
    messages: [],
    agentConfigs: new Map(),
    topics: new Map(),
  };

  registerAgent(config: AgentConfig): void {
    this.state.agentConfigs.set(config.id, config);
    if (!this.state.subscribers.has(config.id))
      this.state.subscribers.set(config.id, new Set());
    if (!this.state.topics.has(config.id))
      this.state.topics.set(config.id, new Set());
  }

  unregisterAgent(agentId: string): void {
    this.state.subscribers.delete(agentId);
    this.state.agentConfigs.delete(agentId);
    this.state.topics.delete(agentId);
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
    if (!this.state.topics.has(agentId))
      this.state.topics.set(agentId, new Set());
    const set = this.state.topics.get(agentId)!;
    topics.forEach((t) => set.add(t));
    const handlers = this.state.subscribers.get(agentId)!;
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      topics.forEach((t) => set.delete(t));
    };
  }

  publish(message: AgentMessage): AgentMessage[] {
    this.state.messages.push(message);
    const recipients: string[] = [];
    if (message.to && this.state.agentConfigs.has(message.to))
      recipients.push(message.to);
    else if (!message.to)
      this.state.agentConfigs.forEach((_, id) => recipients.push(id));
    else this.state.agentConfigs.forEach((_, id) => recipients.push(id));

    const delivered: AgentMessage[] = [];
    for (const recipientId of recipients) {
      const topics = this.state.topics.get(recipientId);
      if (topics && topics.size > 0) {
        const matches =
          topics.has(message.type) ||
          topics.has(message.to) ||
          message.to === "" ||
          message.to === recipientId;
        if (!matches) continue;
      }
      const handlers = this.state.subscribers.get(recipientId) || new Set();
      for (const h of handlers) {
        try {
          h(message);
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
