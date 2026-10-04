export type Mode = 'single' | 'debate';

export interface ChatRequest {
  question: string;
  mode?: Mode;
  max_rounds?: number; // 1..4
}

export interface Turn { agent: string; round: number; text: string; }

export type ChatEvent =
  | { type: 'trace'; data: { messages: string[] } }
  | { type: 'turn'; data: Turn }
  | { type: 'answer'; data: { answer: string; mode: Mode } }
  | { type: 'error'; data: { message: string; trace_id?: string } };

export interface UseCase { id: number; title: string; prompt: string; mode: Mode; }
