export interface ChatMessageEvent {
  payload: {
    message_id: string;
    content: string;
    sender: {
      id: number;
      username: string;
      slug: string;
    };
  };
  ts: string;
}

export interface VtuberConfig {
  apiKey: string;
  model: 'deepseek-v4-flash';
  temperature: number;
  maxHistoryTurns: number;
  systemPrompt: string;
  logDir: string;
}

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekResponse {
  text: string;
  usage: {
    prompt: number;
    completion: number;
    total: number;
    cacheHit: number;
  };
}

export interface ConversationLogEntry {
  username: string;
  role: 'user' | 'assistant';
  content: string;
}