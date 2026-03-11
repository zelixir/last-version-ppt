import type { ProjectChatMessagePart } from './db.ts';

export function appendTextPart(parts: ProjectChatMessagePart[], text: string): ProjectChatMessagePart[] {
  if (!text) return parts;
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { ...lastPart, text: lastPart.text + text }];
  }
  return [...parts, { type: 'text', text }];
}

export function mergeToolPart(
  parts: ProjectChatMessagePart[],
  next: { toolName: string; summary: string; success?: boolean; state?: 'running' | 'done' },
): ProjectChatMessagePart[] {
  if (next.state === 'running') {
    return [...parts, {
      type: 'tool',
      toolName: next.toolName,
      summary: next.summary,
      success: true,
      state: 'running',
    }];
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.type === 'tool' && part.toolName === next.toolName && part.state === 'running') {
      return parts.map((item, itemIndex) => itemIndex === index
        ? { ...item, summary: next.summary, success: next.success !== false, state: 'done' }
        : item);
    }
  }

  return [...parts, {
    type: 'tool',
    toolName: next.toolName,
    summary: next.summary,
    success: next.success !== false,
    state: next.state ?? 'done',
  }];
}
