import type React from 'react'
import { LoaderCircle, Wrench } from 'lucide-react'
import type { UIMessage } from 'ai'
import type { ChatMessagePart, ProjectChatMessage, ProjectChatMessageMetadata } from '../types'
import { Message, MessageContent, MessageResponse } from './ai-elements/message'

type ToolLikePart = {
  type: string
  state?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown> | unknown[]
  errorText?: string
}

type LegacyToolPart = Extract<ChatMessagePart, { type: 'tool' }>
type LegacyTextPart = Extract<ChatMessagePart, { type: 'text' }>

type ConversationMessage =
  | (UIMessage<ProjectChatMessageMetadata> & { pending?: boolean })
  | (ProjectChatMessage & { id?: string; pending?: boolean })

const TOOL_INPUT_LABELS: Record<string, (input: Record<string, unknown>) => string> = {
  'create-project': input => `准备新建项目 ${(input.name as string) || ''}`.trim(),
  'clone-project': input => `准备复制成 ${(input.name as string) || ''}`.trim(),
  'switch-project': input => `准备切换到 ${(input.projectId as string) || ''}`.trim(),
  'create-version': () => '准备保存一个新版本',
  'rename-project': input => `准备把项目改名为 ${(input.name as string) || ''}`.trim(),
  'get-current-project': () => '正在查看当前项目',
  'run-project': () => '正在检查这份 PPT 能否正常生成',
  'list-file': () => '正在查看项目文件列表',
  'read-file': input => `正在读取 ${(input.fileName as string) || ''}`.trim(),
  'read-range': input => `正在分段读取 ${(input.fileName as string) || ''}`.trim(),
  'create-file': input => `准备写入 ${(input.fileName as string) || ''}`.trim(),
  'rename-file': input => `准备把 ${(input.oldName as string) || ''} 改成 ${(input.newName as string) || ''}`.trim(),
  'delete-file': input => `准备删除 ${(input.fileName as string) || ''}`.trim(),
  grep: input => `正在查找 ${(input.pattern as string) || ''}`.trim(),
  'read-image-file': input => `正在查看图片 ${(input.fileName as string) || ''}`.trim(),
  'read-ppt-page': input => `正在查看第 ${(input.pageNumber as number) || ''} 页`.trim(),
  'apply-patch': input => input.fileName ? `准备修改 ${(input.fileName as string) || ''}`.trim() : '准备批量修改文件',
}

function appendTextPart(parts: ChatMessagePart[], text: string): ChatMessagePart[] {
  if (!text) return parts
  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), { ...lastPart, text: lastPart.text + text }]
  }
  return [...parts, { type: 'text', text }]
}

function getToolName(part: ToolLikePart) {
  return part.type.startsWith('tool-') ? part.type.slice(5) : part.type === 'dynamic-tool' ? String((part as any).toolName || '') : ''
}

function isLegacyToolPart(part: ToolLikePart | LegacyToolPart): part is LegacyToolPart {
  return part.type === 'tool'
}

function isToolLikePart(part: ToolLikePart | LegacyToolPart): part is ToolLikePart {
  return part.type !== 'tool'
}

function isTextPart(part: ChatMessagePart | ToolLikePart): part is LegacyTextPart {
  return part.type === 'text'
}

function summarizeToolOutput(toolName: string, output: ToolLikePart['output']) {
  if (Array.isArray(output)) {
    return output.length ? `已处理 ${output.length} 条结果` : '已处理完成'
  }
  if (!output || typeof output !== 'object') return '已处理完成'
  const value = output as Record<string, unknown>
  switch (toolName) {
    case 'create-project':
    case 'clone-project':
    case 'switch-project':
    case 'create-version':
    case 'rename-project':
      return typeof value.projectId === 'string' ? `已切换到 ${value.projectId}` : '已处理完成'
    case 'get-current-project':
      return typeof value.id === 'string' ? `当前项目是 ${value.id}` : '已处理完成'
    case 'run-project':
      return value.ok ? `运行成功，已生成 ${(value.slideCount as number) || 0} 页` : String(value.error || '运行失败')
    case 'list-file':
      return Array.isArray(value.files) ? `已列出 ${value.files.length} 个文件` : '已列出文件'
    case 'read-file':
    case 'read-range':
      return typeof value.fileName === 'string' ? `已读取 ${value.fileName}` : '已读取文件'
    case 'create-file':
      return typeof value.fileName === 'string' ? `已写入 ${value.fileName}` : '已写入文件'
    case 'rename-file':
      return value.oldName && value.newName ? `${value.oldName} → ${value.newName}` : '已完成改名'
    case 'delete-file':
      return typeof value.deleted === 'string' ? `已删除 ${value.deleted}` : '已删除文件'
    case 'grep':
      return Array.isArray(value.matches) ? `找到 ${value.matches.length} 个匹配` : '已完成查找'
    case 'read-image-file':
      return typeof value.fileName === 'string' ? `已查看 ${value.fileName}` : '已查看图片'
    case 'read-ppt-page':
      return typeof value.pageNumber === 'number' ? `已查看第 ${value.pageNumber} 页` : '已查看页面'
    case 'apply-patch':
      return Array.isArray(value.changed) && value.changed.length ? `已修改 ${value.changed.join('、')}` : '已完成修改'
    default:
      return '已处理完成'
  }
}

function normalizeMessageParts(message: ConversationMessage): Array<ChatMessagePart | ToolLikePart> {
  if ('parts' in message && Array.isArray(message.parts) && message.parts.length > 0) {
    const firstPart = message.parts[0]
    if (firstPart && typeof firstPart === 'object' && 'type' in firstPart && (String((firstPart as { type: string }).type).startsWith('tool-') || (firstPart as { type: string }).type === 'dynamic-tool' || (firstPart as { type: string }).type === 'step-start' || (firstPart as { type: string }).type === 'text')) {
      return (message.parts as Array<ChatMessagePart | ToolLikePart>).filter(part => (part as { type: string }).type !== 'step-start')
    }
  }

  const parts: ChatMessagePart[] = []
  if ('toolEvents' in message) {
    message.toolEvents?.forEach(event => {
      parts.push({ type: 'tool', ...event, state: 'done' })
    })
  }
  if ('content' in message && message.content) {
    return appendTextPart(parts, message.content)
  }
  return parts
}

function ToolCard({ part, labels }: { part: ToolLikePart | LegacyToolPart; labels: Record<string, string> }) {
  const toolName = isLegacyToolPart(part) ? part.toolName : getToolName(part)
  const running = isLegacyToolPart(part)
    ? part.state === 'running'
    : part.state === 'input-streaming' || part.state === 'input-available'
  const success = isLegacyToolPart(part)
    ? part.success
    : part.state !== 'output-error' && part.state !== 'output-denied'
  const toneClass = running
    ? 'border-blue-500/30 bg-blue-500/10 text-blue-100'
    : success
      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
      : 'border-red-500/20 bg-red-500/10 text-red-100'
  const summary = isLegacyToolPart(part)
    ? part.summary
    : running
      ? (TOOL_INPUT_LABELS[toolName]?.(part.input && typeof part.input === 'object' ? part.input as Record<string, unknown> : {}) || '正在处理中')
      : part.state === 'output-error'
        ? part.errorText || '处理失败'
        : summarizeToolOutput(toolName, part.output)

  return (
    <div className={`rounded-2xl border px-3 py-2 ${toneClass}`}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
          <span className="font-medium">{labels[toolName] || toolName}</span>
        </div>
        <span className="text-[11px] opacity-80">{running ? '处理中' : success ? '已完成' : '未完成'}</span>
      </div>
      <div className="mt-1 text-xs opacity-90">{summary}</div>
    </div>
  )
}

export default function ChatMessage({
  message,
  toolLabels,
}: {
  message: ConversationMessage
  toolLabels: Record<string, string>
}) {
  if (message.role === 'user') {
    const text = 'parts' in message && Array.isArray(message.parts)
      ? message.parts.filter(part => part.type === 'text').map(part => part.text).join('')
      : ('content' in message ? message.content : '')
    return (
      <Message from="user">
        <MessageContent className="max-w-xl rounded-2xl bg-blue-600 px-4 py-3 text-white">
          <div className="whitespace-pre-wrap text-sm">{text}</div>
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
    if (isTextPart(part)) {
      if (textGroup.length === 0) groupStartIndex = index
      textGroup.push(part.text)
      return
    }
    if (part.type === 'tool' || part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
      flushTextGroup(index)
      rendered.push(<ToolCard key={`tool-${index}`} part={part as ToolLikePart | LegacyToolPart} labels={toolLabels} />)
    }
  })
  flushTextGroup(parts.length)

  if (rendered.length === 0) {
    rendered.push(
      <div key="empty" className="rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-sm text-gray-400">
        {'pending' in message && message.pending ? '正在整理中…' : '这次没有补充文字说明。'}
      </div>,
    )
  }

  return (
    <Message from="assistant">
      <div className="max-w-3xl space-y-2">{rendered}</div>
    </Message>
  )
}

export { appendTextPart }
