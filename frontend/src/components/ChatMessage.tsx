import type React from 'react'
import { LoaderCircle, Wrench } from 'lucide-react'
import type { AgentRunEvent, ChatMessagePart, ChatToolPart, ProjectChatMessage } from '../types'
import { Message, MessageContent, MessageResponse } from './ai-elements/message'

export function appendTextPart(parts: ChatMessagePart[], text: string): ChatMessagePart[] {
  if (!text) return parts
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { ...lastPart, text: lastPart.text + text }]
  }
  return [...parts, { type: 'text', text }]
}

export function mergeMessageToolPart(parts: ChatMessagePart[], nextEvent: AgentRunEvent): ChatMessagePart[] {
  if (nextEvent.type !== 'tool' || !nextEvent.toolName || !nextEvent.summary) return parts
  if (nextEvent.state === 'running') {
    return [...parts, { type: 'tool', toolName: nextEvent.toolName, summary: nextEvent.summary, success: true, state: 'running' }]
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part.type === 'tool' && part.toolName === nextEvent.toolName && part.state === 'running') {
      return parts.map((item, itemIndex) => itemIndex === index
        ? { ...item, summary: nextEvent.summary!, success: nextEvent.success !== false, state: 'done' }
        : item)
    }
  }

  return [...parts, {
    type: 'tool',
    toolName: nextEvent.toolName,
    summary: nextEvent.summary,
    success: nextEvent.success !== false,
    state: nextEvent.state ?? 'done',
  }]
}

export function normalizeMessageParts(message: ProjectChatMessage & { pending?: boolean }): ChatMessagePart[] {
  if (message.parts?.length) return message.parts
  const parts: ChatMessagePart[] = []
  message.toolEvents?.forEach(event => {
    parts.push({ type: 'tool', ...event, state: 'done' })
  })
  if (message.content) {
    return appendTextPart(parts, message.content)
  }
  return parts
}

function ToolCard({ part, labels }: { part: ChatToolPart; labels: Record<string, string> }) {
  const toneClass = part.state === 'running'
    ? 'border-blue-500/30 bg-blue-500/10 text-blue-100'
    : part.success
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
      : 'border-red-500/20 bg-red-500/10 text-red-100'

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          {part.state === 'running' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
          <span className="font-medium">{labels[part.toolName] || part.toolName}</span>
        </div>
        <span className="text-[11px] opacity-80">{part.state === 'running' ? '处理中' : part.success ? '已完成' : '未完成'}</span>
      </div>
      <div className="mt-1 text-xs opacity-90">{part.summary}</div>
    </div>
  )
}

export default function ChatMessage({
  message,
  toolLabels,
}: {
  message: ProjectChatMessage & { id?: string; pending?: boolean }
  toolLabels: Record<string, string>
}) {
  if (message.role === 'user') {
    return (
      <Message from="user">
        <MessageContent className="max-w-xl rounded-2xl bg-blue-600 px-4 py-3 text-white">
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        </MessageContent>
      </Message>
    )
  }

  const parts = normalizeMessageParts(message)
  const rendered: React.ReactNode[] = []
  let textGroup: string[] = []
  let groupStartIndex = 0

  const flushTextGroup = (endIndex: number) => {
    if (textGroup.length === 0) return
    rendered.push(
      <div key={`text-${groupStartIndex}`} className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-gray-100">
        <MessageResponse>{textGroup.join('')}</MessageResponse>
      </div>,
    )
    textGroup = []
    groupStartIndex = endIndex
  }

  parts.forEach((part, index) => {
    if (part.type === 'text') {
      if (textGroup.length === 0) groupStartIndex = index
      textGroup.push(part.text)
      return
    }
    flushTextGroup(index)
    rendered.push(<ToolCard key={`tool-${index}`} part={part} labels={toolLabels} />)
  })
  flushTextGroup(parts.length)

  if (rendered.length === 0) {
    rendered.push(
      <div key="empty" className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
        {message.pending ? '正在整理中…' : '这次没有补充文字说明。'}
      </div>,
    )
  }

  return (
    <Message from="assistant">
      <div className="max-w-3xl space-y-2">{rendered}</div>
    </Message>
  )
}
