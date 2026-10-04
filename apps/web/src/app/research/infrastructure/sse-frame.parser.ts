import type { ChatEvent } from '../domain/chat.ts';

export function parseFrame(frame: string): ChatEvent | null {
  let type = 'message';
  const data: string[] = [];
  const normalized = frame.replace(/\r\n/g, '\n');
  for (const line of normalized.split('\n')) {
    if (line.startsWith('event: ')) type = line.slice(7);
    else if (line.startsWith('data: ')) data.push(line.slice(6));
  }
  return data.length ? ({ type, data: JSON.parse(data.join('\n')) } as ChatEvent) : null;
}
