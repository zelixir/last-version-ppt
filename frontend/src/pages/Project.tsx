import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BrainCircuit, Download, Eye, FileCode2, FolderOpen, History, ImageUp, LoaderCircle, Plus, RefreshCcw, Save, Send, Trash2 } from 'lucide-react'
import type { AgentRunEvent, AiModel, ChatMessagePart, PreviewPresentation, PreviewSlide, ProjectChatMessage, ProjectFile, ProjectSummary, ToolEvent } from '../types'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import ChatMessage, { appendTextPart, mergeMessageToolPart } from '../components/ChatMessage'
import { runProjectPreview } from '../lib/project-preview'

const FILE_KIND_LABELS: Record<ProjectFile['kind'], string> = {
  text: '文本',
  image: '图片',
  media: '音视频',
  binary: '其他文件',
}

const TOOL_LABELS: Record<string, string> = {
  'create-project': '新建项目',
  'clone-project': '复制项目',
  'switch-project': '切换项目',
  'create-version': '保存版本',
  'rename-project': '项目改名',
  'get-current-project': '查看项目',
  'run-project': '检查预览',
  'list-file': '查看文件',
  'create-file': '写入文件',
  'rename-file': '文件改名',
  'delete-file': '删除文件',
  grep: '查找内容',
  'apply-patch': '批量修改',
}

type LiveToolEvent = ToolEvent & { state?: 'running' | 'done' }
type ConversationMessage = ProjectChatMessage & { id: string; toolEvents?: LiveToolEvent[]; parts?: ChatMessagePart[]; pending?: boolean }

const SHOW_SCRIPT_STORAGE_KEY = 'last-version-ppt:show-script'
const CHAT_WIDTH_STORAGE_KEY = 'last-version-ppt:chat-width'
const MIN_CHAT_PANEL_WIDTH = 320
const MAX_CHAT_PANEL_WIDTH = 760

function buildMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function mergeLiveToolEvents(events: LiveToolEvent[], nextEvent: AgentRunEvent): LiveToolEvent[] {
  if (nextEvent.type !== 'tool' || !nextEvent.toolName || !nextEvent.summary) return events
  if (nextEvent.state === 'running') {
    return [...events, { toolName: nextEvent.toolName, summary: nextEvent.summary, success: true, state: 'running' }]
  }

  let runningIndex = -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].toolName === nextEvent.toolName && events[index].state === 'running') {
      runningIndex = index
      break
    }
  }

  if (runningIndex === -1) {
    return [...events, { toolName: nextEvent.toolName, summary: nextEvent.summary, success: nextEvent.success !== false, state: 'done' }]
  }

  return events.map((event, eventIndex) => eventIndex === runningIndex
    ? { ...event, summary: nextEvent.summary!, success: nextEvent.success !== false, state: 'done' }
    : event)
}

function SlideCanvas({ slide, presentation, compact = false }: { slide: PreviewSlide; presentation: PreviewPresentation; compact?: boolean }) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-white shadow-lg" style={{ aspectRatio: `${presentation.width}/${presentation.height}` }}>
      <div className="absolute inset-0" style={{ background: slide.backgroundColor ? `#${slide.backgroundColor}` : '#ffffff' }} />
      {slide.elements.map((element, index) => {
        const style = {
          left: `${(element.x / presentation.width) * 100}%`,
          top: `${(element.y / presentation.height) * 100}%`,
          width: `${(element.w / presentation.width) * 100}%`,
          height: `${(element.h / presentation.height) * 100}%`,
        }
        if (element.kind === 'text') {
          return (
            <div key={index} className="absolute overflow-hidden rounded-sm px-1 text-slate-900" style={{ ...style, color: element.color ? `#${element.color}` : '#0f172a', background: element.fillColor ? `#${element.fillColor}` : 'transparent', border: element.borderColor ? `1px solid #${element.borderColor}` : undefined, fontWeight: element.bold ? 700 : 400, fontSize: `${Math.max((element.fontSize ?? (compact ? 8 : 14)) * (compact ? 0.4 : 0.7), compact ? 6 : 10)}px`, textAlign: (element.align as any) || 'left', display: 'flex', alignItems: 'center' } as React.CSSProperties}>
              <span className="line-clamp-6 whitespace-pre-wrap">{element.text}</span>
            </div>
          )
        }
        if (element.kind === 'shape') {
          return <div key={index} className="absolute rounded-sm" style={{ ...style, background: element.fillColor ? `#${element.fillColor}` : 'transparent', border: element.borderColor ? `1px solid #${element.borderColor}` : '1px solid rgba(15,23,42,0.15)' }} />
        }
        if (element.kind === 'image') {
          return <img key={index} src={element.src} alt="slide" className="absolute rounded-sm object-cover" style={style} />
        }
        return (
          <div key={index} className="absolute overflow-hidden rounded border border-slate-300 bg-white" style={style}>
            <table className="h-full w-full text-[8px] text-slate-700 md:text-[10px]">
              <tbody>
                {element.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-200 px-1 align-top">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export default function Project() {
  const params = useParams()
  const projectId = params.projectId
  const projectKey = projectId ?? ''
  const navigate = useNavigate()
  const location = useLocation()
  const autoPromptRef = useRef<string | null>((location.state as { autoPrompt?: string } | null)?.autoPrompt ?? null)
  const autoModelRef = useRef<number | null>((location.state as { suggestedModelId?: number } | null)?.suggestedModelId ?? null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)
  const chatResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [models, setModels] = useState<AiModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'preview' | 'resources'>('preview')
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0)
  const [preview, setPreview] = useState<PreviewPresentation | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [showIndexSource, setShowIndexSource] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(SHOW_SCRIPT_STORAGE_KEY) === 'true'
  })
  const [editorValue, setEditorValue] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [sessionMessages, setSessionMessages] = useState<ConversationMessage[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return 420
    const savedWidth = Number(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY) || '')
    return Number.isFinite(savedWidth) ? Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, savedWidth)) : 420
  })

  const visibleFiles = useMemo(() => {
    if (!project) return []
    return project.files.filter(file => showIndexSource || file.name !== 'index.js')
  }, [project, showIndexSource])

  const selectedFile = useMemo(() => visibleFiles.find(file => file.name === selectedFileName) ?? null, [visibleFiles, selectedFileName])
  const historyMessages = useMemo<ConversationMessage[]>(
    () => (project?.chatHistory ?? []).map((message, index) => ({ ...message, id: `history-${message.createdAt}-${index}` })),
    [project?.chatHistory],
  )
  const displayedMessages = showHistory ? historyMessages : sessionMessages

  const fetchProject = async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}`)
    if (!response.ok) throw new Error('加载项目失败')
    const data = await response.json() as ProjectSummary
    setProject(data)
    setSelectedFileName(current => current && data.files.some(file => file.name === current) ? current : data.files.find(file => file.name !== 'index.js')?.name ?? data.files[0]?.name ?? null)
    await fetch(`/api/projects/${encodeURIComponent(projectKey)}/current`, { method: 'POST' })
  }

  const fetchModels = async () => {
    const response = await fetch('/api/ai-models?enabled=true')
    if (!response.ok) throw new Error('加载模型失败')
    const data = await response.json() as AiModel[]
    setModels(data)
    setSelectedModelId(current => current ?? autoModelRef.current ?? data[0]?.id ?? null)
  }

  const refreshPreview = async () => {
    try {
      setPreviewLoading(true)
      setPreviewError(null)
      const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files/content?fileName=${encodeURIComponent('index.js')}`)
      if (!response.ok) throw new Error('加载 PPT 脚本失败')
      const data = await response.json() as { content: string }
      const rendered = await runProjectPreview(projectKey, data.content)
      setPreview(rendered)
      setSelectedSlideIndex(0)
      setActiveTab('preview')
    } catch (err) {
      setPreview(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  const loadTextFile = async (file: ProjectFile) => {
    if (file.kind !== 'text') return
    setEditorLoading(true)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files/content?fileName=${encodeURIComponent(file.name)}`)
      if (!response.ok) throw new Error('读取文件失败')
      const data = await response.json() as { content: string }
      setEditorValue(data.content)
      setEditorDirty(false)
    } catch (err) {
      setPageError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditorLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([fetchProject(), fetchModels()])
      .then(() => refreshPreview())
      .catch(err => {
        console.error(err)
        setPageError(err instanceof Error ? err.message : String(err))
      })
  }, [projectId])

  useEffect(() => {
    if (selectedFile?.kind === 'text') loadTextFile(selectedFile)
  }, [selectedFile])

  useEffect(() => {
    if (!autoPromptRef.current || !selectedModelId || chatLoading) return
    const prompt = autoPromptRef.current
    autoPromptRef.current = null
    const timeoutId = window.setTimeout(() => {
      sendChat(prompt, selectedModelId)
    }, 200)
    return () => window.clearTimeout(timeoutId)
  }, [selectedModelId, projectId, chatLoading])

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayedMessages, chatLoading])

  useEffect(() => {
    window.localStorage.setItem(SHOW_SCRIPT_STORAGE_KEY, String(showIndexSource))
  }, [showIndexSource])

  useEffect(() => {
    window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(chatPanelWidth))
  }, [chatPanelWidth])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' || !selectedFileName || selectedFileName === 'index.js') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      deleteSelectedFile()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedFileName, project])

  const saveCurrentTextFile = async () => {
    if (!selectedFile || selectedFile.kind !== 'text') return
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: selectedFile.name, content: editorValue }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || '保存文件失败')
    }
    setEditorDirty(false)
    await fetchProject()
    if (selectedFile.name === 'index.js') await refreshPreview()
  }

  const deleteSelectedFile = async () => {
    if (!selectedFile || selectedFile.name === 'index.js') return
    const confirmed = window.confirm(`确定删除文件 ${selectedFile.name} 吗？`)
    if (!confirmed) return
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files?fileName=${encodeURIComponent(selectedFile.name)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setPageError(data?.error || '删除文件失败')
      return
    }
    await fetchProject()
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const formData = new FormData()
    Array.from(files).forEach(file => formData.append('files', file))
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files/upload`, { method: 'POST', body: formData })
    if (!response.ok) throw new Error('上传文件失败')
    await fetchProject()
    await refreshPreview()
  }

  const handleChatResizeStart = (event: React.MouseEvent<HTMLDivElement>) => {
    chatResizeStateRef.current = { startX: event.clientX, startWidth: chatPanelWidth }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const handlePointerMove = (event: MouseEvent) => {
      const resizeState = chatResizeStateRef.current
      if (!resizeState) return
      const delta = resizeState.startX - event.clientX
      setChatPanelWidth(Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, resizeState.startWidth + delta)))
    }

    const handlePointerUp = () => {
      chatResizeStateRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
    }
  }, [])

  const updateSessionMessage = (messageId: string, updater: (message: ConversationMessage) => ConversationMessage) => {
    setSessionMessages(current => current.map(message => message.id === messageId ? updater(message) : message))
  }

  const sendChat = async (content?: string, modelIdOverride?: number) => {
    const text = (content ?? chatInput).trim()
    const modelId = modelIdOverride ?? selectedModelId
    if (!text || !modelId || chatLoading) return

    const userMessage: ConversationMessage = {
      id: buildMessageId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    const assistantMessageId = buildMessageId()

    setShowHistory(false)
    setSessionMessages(current => [
      ...current,
      userMessage,
      { id: assistantMessageId, role: 'assistant', content: '', createdAt: new Date().toISOString(), toolEvents: [], parts: [], pending: true },
    ])
    setChatLoading(true)
    setPageError(null)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, modelId, includeHistory: false }),
      })

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || '发送消息失败')
      }

      let buffer = ''
      let nextProjectId = projectKey
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const handleEvent = (rawEvent: string) => {
        const lines = rawEvent.split('\n')
        const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message'
        const dataText = lines
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trim())
          .join('\n')
        if (!dataText) return
        const data = JSON.parse(dataText) as AgentRunEvent & { error?: string; projectId?: string }
        if (eventName === 'message') {
          if (data.type === 'text-delta' && data.text) {
            updateSessionMessage(assistantMessageId, message => ({
              ...message,
              content: `${message.content}${data.text}`,
              parts: appendTextPart([...(message.parts ?? [])], data.text!),
            }))
          }
          if (data.type === 'tool') {
            updateSessionMessage(assistantMessageId, message => ({
              ...message,
              toolEvents: mergeLiveToolEvents(message.toolEvents ?? [], data),
              parts: mergeMessageToolPart([...(message.parts ?? [])], data),
            }))
          }
          return
        }
        if (eventName === 'done' && data.projectId) {
          nextProjectId = data.projectId
          return
        }
        if (eventName === 'error') {
          throw new Error(data.error || '发送消息失败')
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        parts.forEach(handleEvent)
      }
      if (buffer.trim()) handleEvent(buffer)

      setChatInput('')
      updateSessionMessage(assistantMessageId, message => ({
        ...message,
        pending: false,
        content: message.content.trim() ? message.content : '这次已经处理完成，你可以继续补充要求。',
        parts: message.content.trim() || message.parts?.some(part => part.type === 'text' && part.text.trim())
          ? message.parts
          : appendTextPart([...(message.parts ?? [])], '这次已经处理完成，你可以继续补充要求。'),
      }))

      if (nextProjectId !== projectKey) {
        navigate(`/projects/${nextProjectId}`, { replace: true })
        return
      }

      await fetchProject()
      await refreshPreview()
    } catch (err) {
      updateSessionMessage(assistantMessageId, message => ({ ...message, pending: false }))
      setPageError(err instanceof Error ? err.message : String(err))
    } finally {
      setChatLoading(false)
    }
  }

  const exportPpt = () => {
    window.open(`/api/projects/${encodeURIComponent(projectKey)}/export`, '_blank')
  }

  const currentSlide = preview?.slides[selectedSlideIndex] ?? preview?.slides[0] ?? null

  if (!projectId) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-sm text-gray-400">
        项目不存在。
      </div>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-gray-950">
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 bg-gray-950/95 px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <div className="text-sm font-semibold text-white">{project?.name || '项目工作区'}</div>
              <div className="text-xs text-gray-500">{project?.id || projectId}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fetch(`/api/projects/${encodeURIComponent(projectId)}/open-folder`, { method: 'POST' })}><FolderOpen className="h-4 w-4" />打开资源管理器</Button>
            <Button variant="outline" size="sm" onClick={() => navigate('/models', { state: { returnTo: location.pathname } })}><BrainCircuit className="h-4 w-4" />模型配置</Button>
          </div>
        </header>

        {pageError && <div className="border-b border-red-900/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">{pageError}</div>}

        <div
          className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_8px_var(--chat-panel-width)]"
          style={{ '--chat-panel-width': `${chatPanelWidth}px` } as React.CSSProperties}
        >
          <section className="min-h-0 border-b border-gray-800 xl:border-b-0 xl:border-r">
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                <div className="flex gap-2">
                  <button onClick={() => setActiveTab('preview')} className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'preview' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}><Eye className="mr-1 inline h-4 w-4" />PPT 预览</button>
                  <button onClick={() => setActiveTab('resources')} className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'resources' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-white'}`}><FileCode2 className="mr-1 inline h-4 w-4" />资源管理</button>
                </div>
                {activeTab === 'preview' ? (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={refreshPreview} disabled={previewLoading}><RefreshCcw className={`h-4 w-4 ${previewLoading ? 'animate-spin' : ''}`} />刷新</Button>
                    <Button size="sm" onClick={exportPpt}><Download className="h-4 w-4" />导出 PPT</Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={showIndexSource} onChange={e => setShowIndexSource(e.target.checked)} />显示 PPT 脚本</label>
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}><ImageUp className="h-4 w-4" />上传文件</Button>
                    <input ref={fileInputRef} className="hidden" type="file" multiple onChange={event => event.target.files && uploadFiles(event.target.files).catch(err => setPageError(err instanceof Error ? err.message : String(err)))} />
                  </div>
                )}
              </div>

              {activeTab === 'preview' ? (
                <div className="grid min-h-0 flex-1 grid-cols-[170px_minmax(0,1fr)] gap-4 p-4">
                  <div className="space-y-3 overflow-y-auto pr-1">
                    {preview?.slides.map((slide, index) => (
                      <button key={slide.id} onClick={() => setSelectedSlideIndex(index)} className={`block w-full rounded-2xl border p-2 ${selectedSlideIndex === index ? 'border-blue-500 bg-blue-500/10' : 'border-gray-800 bg-gray-900/60'}`}>
                        <div className="mb-2 text-left text-xs text-gray-400">第 {index + 1} 页</div>
                        <SlideCanvas slide={slide} presentation={preview} compact />
                      </button>
                    ))}
                    {!previewLoading && !previewError && preview?.slides.length === 0 && <div className="rounded-xl border border-dashed border-gray-700 p-4 text-sm text-gray-500">当前没有生成任何幻灯片。</div>}
                  </div>
                  <div className="min-h-0 overflow-y-auto rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
                    {previewLoading && <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />正在生成预览…</div>}
                    {!previewLoading && previewError && (
                      <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-red-900/40 bg-red-950/20 p-6 text-center">
                        <div className="text-3xl font-bold text-red-200">出错啦</div>
                        <pre className="mt-4 max-w-full overflow-auto whitespace-pre-wrap text-left text-sm text-red-100">{previewError}</pre>
                      </div>
                    )}
                    {!previewLoading && !previewError && currentSlide && preview && (
                      <div className="space-y-4">
                        <SlideCanvas slide={currentSlide} presentation={preview} />
                        {preview.logs.length > 0 && (
                          <div className="rounded-xl border border-gray-800 bg-gray-950/70 p-4">
                            <div className="mb-2 text-sm font-medium text-white">生成记录</div>
                            <div className="space-y-1 text-xs text-gray-400">{preview.logs.map((log, index) => <div key={index}>{log}</div>)}</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className={`grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 p-4 ${isDraggingFiles ? 'rounded-2xl border-2 border-dashed border-blue-500/70 bg-blue-500/5' : ''}`}
                  onDragOver={event => {
                    event.preventDefault()
                    setIsDraggingFiles(true)
                  }}
                  onDragLeave={event => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
                    setIsDraggingFiles(false)
                  }}
                  onDrop={event => {
                    event.preventDefault()
                    setIsDraggingFiles(false)
                    if (event.dataTransfer.files?.length) {
                      uploadFiles(event.dataTransfer.files).catch(err => setPageError(err instanceof Error ? err.message : String(err)))
                    }
                  }}
                >
                  <div className="space-y-2 overflow-y-auto rounded-2xl border border-gray-800 bg-gray-900/60 p-3">
                    {visibleFiles.map(file => (
                      <button key={file.name} onClick={() => setSelectedFileName(file.name)} className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${selectedFileName === file.name ? 'border-blue-500 bg-blue-500/10 text-white' : 'border-gray-800 bg-gray-950/70 text-gray-300 hover:border-gray-700'}`}>
                        <div className="truncate font-medium">{file.name}</div>
                        <div className="mt-1 text-[11px] text-gray-500">{FILE_KIND_LABELS[file.kind]} · {Math.max(1, Math.round(file.size / 1024))} KB</div>
                      </button>
                    ))}
                    {visibleFiles.length === 0 && <div className="rounded-xl border border-dashed border-gray-700 p-4 text-sm text-gray-400">暂时还没有资源文件。你可以把文件直接拖到这里上传，也可以点上方按钮选择文件；如果想看脚本，也可以勾选“显示 PPT 脚本”。</div>}
                  </div>
                  <div className="min-h-0 overflow-hidden rounded-2xl border border-gray-800 bg-gray-900/60">
                    {selectedFile ? (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
                          <div>
                            <div className="text-sm font-medium text-white">{selectedFile.name}</div>
                            <div className="text-xs text-gray-500">按删除键可删除当前文件（PPT 脚本除外）</div>
                          </div>
                          <div className="flex gap-2">
                            {selectedFile.kind === 'text' && <Button size="sm" variant="outline" onClick={() => saveCurrentTextFile().catch(err => setPageError(err instanceof Error ? err.message : String(err)))} disabled={!editorDirty}><Save className="h-4 w-4" />保存</Button>}
                            {selectedFile.name !== 'index.js' && <Button size="sm" variant="ghost" onClick={deleteSelectedFile}><Trash2 className="h-4 w-4" />删除</Button>}
                          </div>
                        </div>
                        <div className="min-h-0 flex-1">
                          {selectedFile.kind === 'text' ? (
                            editorLoading ? <div className="flex h-full items-center justify-center gap-2 text-sm text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取文件…</div> : (
                              <Editor
                                value={editorValue}
                                onChange={value => { setEditorValue(value ?? ''); setEditorDirty(true) }}
                                language={selectedFile.name.endsWith('.json') ? 'json' : selectedFile.name.endsWith('.md') ? 'markdown' : selectedFile.name.endsWith('.css') ? 'css' : selectedFile.name.endsWith('.html') ? 'html' : 'javascript'}
                                theme="vs-dark"
                                options={{ minimap: { enabled: false }, fontSize: 14, wordWrap: 'on', automaticLayout: true }}
                              />
                            )
                          ) : selectedFile.kind === 'image' ? (
                            <div className="flex h-full items-center justify-center p-6"><img src={selectedFile.url} alt={selectedFile.name} className="max-h-full max-w-full rounded-xl object-contain" /></div>
                          ) : selectedFile.kind === 'media' ? (
                            <div className="flex h-full items-center justify-center p-6">{selectedFile.name.endsWith('.mp4') ? <video controls className="max-h-full max-w-full rounded-xl" src={selectedFile.url} /> : <audio controls src={selectedFile.url} className="w-full max-w-lg" />}</div>
                          ) : (
                            <div className="flex h-full items-center justify-center px-6 text-center text-sm text-gray-500">这种文件暂时不能直接预览，但仍然可以在 PPT 脚本里使用。</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-gray-500">从左侧选择一个文件以查看或编辑。</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          <div
            className="hidden cursor-col-resize bg-gray-900/80 transition-colors hover:bg-blue-500/50 xl:block"
            onMouseDown={handleChatResizeStart}
            role="separator"
            aria-label="调整聊天区域宽度"
            aria-orientation="vertical"
          />

          <aside className="min-h-0 bg-gray-950/90">
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-gray-800 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-white">智能助手</div>
                  </div>
                  <Select className="max-w-52" value={selectedModelId?.toString() || ''} onChange={event => setSelectedModelId(Number(event.target.value))}>
                    {models.map(model => <option key={model.id} value={model.id}>{model.display_name || model.model_name}</option>)}
                  </Select>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant={showHistory ? 'outline' : 'default'} onClick={() => { setShowHistory(false); setSessionMessages([]); setPageError(null) }} disabled={chatLoading}>
                    <Plus className="h-4 w-4" />新对话
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowHistory(current => !current)}>
                    <History className="h-4 w-4" />历史记录
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">
                  {displayedMessages.length ? displayedMessages.map(message => (
                    <ChatMessage key={message.id} message={message} toolLabels={TOOL_LABELS} />
                  )) : <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-5 text-sm text-gray-400">{showHistory ? '还没有保存过历史记录。你可以先开始一轮新对话。' : '先告诉助手你想做什么样的演示稿，或让它继续完善当前内容。'}</div>}
                  <div ref={chatBottomRef} />
                </div>
              </div>
              <div className="border-t border-gray-800 px-4 py-4">
                <Textarea value={chatInput} onChange={event => setChatInput(event.target.value)} placeholder={selectedModelId ? '例如：做一个三页的产品发布会 PPT，强调问题、方案和优势。也可以先问我：你可以帮我做什么？' : '请先在模型配置中启用模型'} className="min-h-28 bg-gray-900" />
                <div className="mt-3 flex justify-end">
                  <Button onClick={() => sendChat()} disabled={chatLoading || !selectedModelId || !chatInput.trim()}><Send className="h-4 w-4" />发送</Button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
