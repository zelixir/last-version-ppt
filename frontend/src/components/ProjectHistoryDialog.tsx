import { History, LoaderCircle, MessageSquare } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import type { ProjectConversationSummary } from '../types'

interface ProjectHistoryDialogProps {
  open: boolean
  loading: boolean
  conversations: ProjectConversationSummary[]
  onOpenChange: (open: boolean) => void
  onSelect: (conversationId: string) => void
}

function formatTime(value: string) {
  const date = new Date(value.includes('T') || value.includes('Z') ? value : `${value}Z`)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

export default function ProjectHistoryDialog({
  open,
  loading,
  conversations,
  onOpenChange,
  onSelect,
}: ProjectHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border-gray-800 bg-gray-950 text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-4 w-4" />历史记录</DialogTitle>
          <DialogDescription className="text-gray-400">选择一段你想继续查看或接着聊的对话。</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-gray-800 bg-gray-900/70">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-gray-400">
              <LoaderCircle className="h-4 w-4 animate-spin" />正在读取历史记录…
            </div>
          ) : conversations.length ? (
            <div className="divide-y divide-gray-800">
              {conversations.map(conversation => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => onSelect(conversation.id)}
                  className="flex w-full flex-col gap-2 px-4 py-4 text-left transition-colors hover:bg-gray-800/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-sm font-medium text-white">{conversation.title || '未命名对话'}</div>
                    <div className="shrink-0 text-xs text-gray-500">{formatTime(conversation.updatedAt)}</div>
                  </div>
                  <div className="line-clamp-2 text-sm text-gray-400">{conversation.preview || '这段对话里暂时没有文字内容。'}</div>
                  <div className="text-xs text-gray-500">共 {conversation.messageCount} 条消息</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-sm text-gray-500">
              <MessageSquare className="h-8 w-8 opacity-60" />
              <div>还没有保存过历史记录。</div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
