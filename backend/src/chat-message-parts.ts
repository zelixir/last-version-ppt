import type { ProjectChatMessagePart } from './db.ts';

export function appendTextPart(parts: ProjectChatMessagePart[], text: string): ProjectChatMessagePart[] {
  if (!text) return parts;
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === 'text') {
    lastPart.text += text;
    return parts;
  }
  parts.push({ type: 'text', text });
  return parts;
}

export function mergeToolPart(
  parts: ProjectChatMessagePart[],
  next: { toolName: string; summary: string; success?: boolean; state?: 'running' | 'done' },
): ProjectChatMessagePart[] {
  if (next.state === 'running') {
    parts.push({
      type: 'tool',
      toolName: next.toolName,
      summary: next.summary,
      success: true,
      state: 'running',
    });
    return parts;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.type === 'tool' && part.toolName === next.toolName && part.state === 'running') {
      part.summary = next.summary;
      part.success = next.success !== false;
      part.state = 'done';
      return parts;
    }
  }

  parts.push({
    type: 'tool',
    toolName: next.toolName,
    summary: next.summary,
    success: next.success !== false,
    state: next.state ?? 'done',
  });
  return parts;
}
