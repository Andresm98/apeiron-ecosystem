import type { ChatEvent } from '../domain/chat.ts';

/** Número de evento (`id: N`) de un frame SSE; las sesiones de la Polis lo usan para reengancharse. */
export function frameId(frame: string): number | null {
  const match = /^id: (\d+)$/m.exec(frame.replace(/\r\n/g, '\n'));
  return match ? Number(match[1]) : null;
}

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
