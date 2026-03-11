import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BrainCircuit, LoaderCircle, MessageSquarePlus, Trash2 } from 'lucide-react'
import type { AiModel, ChatMessage, Conversation } from '../types'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/select'
import { Conversation as ConversationLayout, ConversationContent } from '../components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '../components/ai-elements/message'
import { PromptInput } from '../components/ai-elements/prompt-input'

function parseStoredMessages(value?: string): ChatMessage[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ChatMessage => item && typeof item === 'object' && typeof item.role === 'string' && typeof item.content === 'string')
  } catch {
    return []
  }
}

export default function Chat() {
  const navigate = useNavigate()
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [models, setModels] = useState<AiModel[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [conversationId, setConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedModel = useMemo(() => models.find(model => model.id === selectedModelId) ?? null, [models, selectedModelId])

  const fetchModels = () => {
    fetch('/api/ai-models?enabled=true').then(r => r.json()).then((data: AiModel[]) => {
      setModels(data)
      setSelectedModelId(current => current ?? data[0]?.id ?? null)
    }).catch(console.error)
  }

  const fetchConversations = () => {
    fetch('/api/conversations').then(r => r.json()).then(setConversations).catch(console.error)
  }

  useEffect(() => {
    fetchModels()
    fetchConversations()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const loadConversation = async (id: number) => {
    const response = await fetch(`/api/conversations/${id}`)
    if (!response.ok) return
    const conversation = await response.json() as Conversation
    setConversationId(id)
    setMessages(parseStoredMessages(conversation.messages))
    setError(null)
  }

  const handleNewConversation = () => {
    setConversationId(null)
    setMessages([])
    setInput('')
    setError(null)
  }

  const handleDeleteConversation = async (id: number) => {
    await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
    if (conversationId === id) handleNewConversation()
    fetchConversations()
  }

  const handleSubmit = async () => {
    if (!input.trim() || !selectedModelId || loading) return

    const previousMessages = messages
    const nextMessages = [...messages, { role: 'user' as const, content: input.trim() }]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages, modelId: selectedModelId, conversationId: conversationId ?? undefined }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '聊天请求失败')

      setMessages(prev => [...prev, { role: 'assistant', content: data.message || '' }])
      if (typeof data.conversationId === 'number') setConversationId(data.conversationId)
      fetchConversations()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setMessages(previousMessages)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen overflow-hidden bg-gray-950">
      <div className="grid h-full grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-gray-800 bg-gray-900/90 p-4 lg:border-b-0 lg:border-r">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-white">对话历史</div>
              <div className="text-xs text-gray-500">本地 SQLite 持久化</div>
            </div>
            <Button size="sm" onClick={handleNewConversation}><MessageSquarePlus className="h-4 w-4" />新建</Button>
          </div>

          <div className="space-y-2 overflow-y-auto lg:max-h-[calc(100vh-110px)]">
            {conversations.map(conversation => (
              <div key={conversation.id} className={`group rounded-xl border p-3 transition-colors ${conversation.id === conversationId ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-800 bg-gray-950/50 hover:border-gray-700'}`}>
                <button className="w-full text-left" onClick={() => loadConversation(conversation.id)}>
                  <div className="line-clamp-2 text-sm font-medium text-white">{conversation.title}</div>
                  <div className="mt-1 text-xs text-gray-500">{new Date(conversation.updated_at).toLocaleString()}</div>
                </button>
                <div className="mt-2 flex justify-end opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteConversation(conversation.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))}
            {conversations.length === 0 && <div className="rounded-xl border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">还没有对话，发送第一条消息即可自动创建。</div>}
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-950/90 px-4 py-3">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
              <div>
                <div className="text-sm font-semibold text-white">通用 AI 聊天</div>
                <div className="text-xs text-gray-500">不含终端/SSH 工具，仅保留模型调用框架</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-300">
                <BrainCircuit className="h-4 w-4 text-blue-400" />
                <Select className="min-w-56 border-0 bg-transparent px-0 py-0 focus:ring-0" value={selectedModelId?.toString() || ''} onChange={e => setSelectedModelId(Number(e.target.value))}>
                  {models.map(model => <option key={model.id} value={model.id}>{model.display_name || model.model_name}</option>)}
                </Select>
              </div>
              <Button variant="outline" asChild><Link to="/help">帮助</Link></Button>
            </div>
          </header>

          <ConversationLayout className="min-h-0 flex-1">
            <ConversationContent className="space-y-4 bg-gray-950">
              {messages.length === 0 && (
                <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-8 text-center">
                  <div className="text-lg font-semibold text-white">开始一段新的对话</div>
                  <div className="mt-2 text-sm text-gray-400">{selectedModel ? `当前模型：${selectedModel.display_name || selectedModel.model_name}` : '请先在首页配置并启用至少一个模型。'}</div>
                </div>
              )}

              {messages.map((message, index) => (
                <Message key={`${message.role}-${index}`} from={message.role === 'user' ? 'user' : 'assistant'}>
                  <MessageContent className={message.role === 'user' ? 'max-w-xl rounded-2xl bg-blue-600 px-4 py-3 text-white' : 'max-w-3xl rounded-2xl border border-gray-800 bg-gray-900 px-4 py-3 text-gray-100'}>
                    {message.role === 'user' ? <div className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</div> : <MessageResponse>{message.content}</MessageResponse>}
                  </MessageContent>
                </Message>
              ))}

              {loading && <div className="flex items-center gap-2 text-sm text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />正在生成回复…</div>}
              {error && <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}
              <div ref={bottomRef} />
            </ConversationContent>

            <div className="border-t border-gray-800 bg-gray-950 px-4 py-4">
              <PromptInput value={input} onChange={setInput} onSubmit={handleSubmit} disabled={loading || !selectedModelId} placeholder={selectedModelId ? '输入你的问题…' : '请先回到首页配置并启用模型'} />
            </div>
          </ConversationLayout>
        </main>
      </div>
    </div>
  )
}
