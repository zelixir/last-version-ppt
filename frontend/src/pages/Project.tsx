import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import Editor from '@monaco-editor/react'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, BrainCircuit, Download, Eye, FileCode2, FolderOpen, History, ImageUp, LoaderCircle, Plus, RefreshCcw, Save, Send, Trash2 } from 'lucide-react'
import type { AiModel, PreviewPresentation, PreviewSlide, ProjectChatMessageMetadata, ProjectConversationDetail, ProjectConversationSummary, ProjectFile, ProjectSummary } from '../types'
import { PromptInput } from '../components/ai-elements/prompt-input'
import { Button } from '../components/ui/button'
import { Select } from '../components/ui/select'
import ChatMessage from '../components/ChatMessage'
import ProjectHistoryDialog from '../components/ProjectHistoryDialog'
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
  'read-file': '读取文件',
  'read-range': '分段读取',
  'create-file': '写入文件',
  'rename-file': '文件改名',
  'delete-file': '删除文件',
  grep: '查找内容',
  'read-image-file': '查看图片',
  'read-ppt-page': '查看页面预览',
  'apply-patch': '应用补丁',
}

type ConversationMessage = UIMessage<ProjectChatMessageMetadata>
type NavigationState = { autoPrompt?: string; suggestedModelId?: number }

const SHOW_SCRIPT_STORAGE_KEY = 'last-version-ppt:show-script'
const CHAT_WIDTH_STORAGE_KEY = 'last-version-ppt:chat-width'
const SELECTED_MODEL_STORAGE_KEY = 'last-version-ppt:selected-model-id'
const PROJECT_TAB_STORAGE_KEY_PREFIX = 'last-version-ppt:project-tab:'
const PROMPT_HISTORY_STORAGE_KEY_PREFIX = 'last-version-ppt:prompt-history:'
const MIN_CHAT_PANEL_WIDTH = 320
const MAX_CHAT_PANEL_WIDTH = 760
const PREVIEW_WHEEL_DELTA_THRESHOLD = 8
const PREVIEW_WHEEL_THROTTLE_MS = 160

function buildMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function toSlideHeightUnit(value: number, presentation: PreviewPresentation) {
  return `${(value / presentation.height) * 100}cqh`
}

function toSlideWidthUnit(value: number, presentation: PreviewPresentation) {
  return `${(value / presentation.width) * 100}cqw`
}

function toPreviewFontSize(fontSize: number, presentation: PreviewPresentation) {
  return toSlideHeightUnit(fontSize / 72, presentation)
}

function getProjectTabStorageKey(projectKey: string) {
  return `${PROJECT_TAB_STORAGE_KEY_PREFIX}${projectKey}`
}

function getPromptHistoryStorageKey(projectKey: string) {
  return `${PROMPT_HISTORY_STORAGE_KEY_PREFIX}${projectKey}`
}

function readStoredProjectTab(projectKey: string): 'preview' | 'resources' {
  return window.localStorage.getItem(getProjectTabStorageKey(projectKey)) === 'resources' ? 'resources' : 'preview'
}

function readStoredPromptHistory(projectKey: string): string[] {
  try {
    const rawValue = window.localStorage.getItem(getPromptHistoryStorageKey(projectKey))
    if (!rawValue) return []
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string' && item.trim()) : []
  } catch {
    return []
  }
}

function readStoredSelectedModelId() {
  const rawValue = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)
  if (!rawValue) return null
  const value = Number(rawValue)
  return Number.isInteger(value) && value > 0 ? value : null
}

function readNavigationState(locationState: unknown): NavigationState | null {
  if (locationState && typeof locationState === 'object') {
    return locationState as NavigationState
  }
  const historyUserState = window.history.state?.usr
  return historyUserState && typeof historyUserState === 'object'
    ? historyUserState as NavigationState
    : null
}

function buildProjectPageTitle(project: ProjectSummary | null, projectId?: string) {
  const baseName = project?.name?.trim()
  const effectiveProjectId = project?.id ?? projectId ?? ''
  const versionSuffix = effectiveProjectId.match(/_v\d{2}$/i)?.[0]?.replace('_', ' ') ?? ''
  if (!baseName) return '最后一版PPT'
  return `${baseName}${versionSuffix} - 最后一版PPT`
}

function SlideCanvas({ slide, presentation, compact = false }: { slide: PreviewSlide; presentation: PreviewPresentation; compact?: boolean }) {
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-gray-700 bg-white shadow-lg" style={{ aspectRatio: `${presentation.width}/${presentation.height}`, containerType: 'size' }}>
      <div className="absolute inset-0" style={{ background: slide.backgroundColor ? `#${slide.backgroundColor}` : '#ffffff' }} />
      {slide.elements.map((element, index) => {
        const style = {
          left: `${(element.x / presentation.width) * 100}%`,
          top: `${(element.y / presentation.height) * 100}%`,
          width: `${(element.w / presentation.width) * 100}%`,
          height: `${(element.h / presentation.height) * 100}%`,
        }
        if (element.kind === 'text') {
          const effectiveFontSize = element.fontSize ?? 28
          return (
            <div key={index} className="absolute overflow-hidden rounded-sm text-slate-900" style={{ ...style, color: element.color ? `#${element.color}` : '#0f172a', background: element.fillColor ? `#${element.fillColor}` : 'transparent', border: element.borderColor ? `1px solid #${element.borderColor}` : undefined, fontWeight: element.bold ? 700 : 400, fontSize: toPreviewFontSize(effectiveFontSize, presentation), lineHeight: 1.25, padding: `${toSlideHeightUnit(compact ? 0.03 : 0.05, presentation)} ${toSlideWidthUnit(compact ? 0.03 : 0.05, presentation)}`, textAlign: (element.align as any) || 'left', display: 'flex', alignItems: 'center' } as React.CSSProperties}>
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
        const tableFontSize = toPreviewFontSize(element.fontSize ?? 32, presentation)
        return (
          <div key={index} className="absolute overflow-hidden rounded border border-slate-300 bg-white" style={style}>
            <table className="h-full w-full text-slate-700" style={{ fontSize: tableFontSize, lineHeight: 1.2 }}>
              <tbody>
                {element.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-200 align-top" style={{ padding: `${toSlideHeightUnit(compact ? 0.02 : 0.04, presentation)} ${toSlideWidthUnit(compact ? 0.02 : 0.04, presentation)}` }}>{cell}</td>)}
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
  const initialNavigationStateRef = useRef<NavigationState | null>(readNavigationState(location.state))
  const autoPromptRef = useRef<string | null>(initialNavigationStateRef.current?.autoPrompt ?? null)
  const autoModelRef = useRef<number | null>(initialNavigationStateRef.current?.suggestedModelId ?? null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const chatBottomRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatResizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const promptHistoryDraftRef = useRef('')
  const previewWheelAtRef = useRef(0)
  const [project, setProject] = useState<ProjectSummary | null>(null)
  const [models, setModels] = useState<AiModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'preview' | 'resources'>(() => readStoredProjectTab(projectKey))
  const [selectedSlideIndex, setSelectedSlideIndex] = useState(0)
  const [preview, setPreview] = useState<PreviewPresentation | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [showIndexSource, setShowIndexSource] = useState(() => window.localStorage.getItem(SHOW_SCRIPT_STORAGE_KEY) === 'true')
  const [editorValue, setEditorValue] = useState('')
  const [editorLoading, setEditorLoading] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [promptHistory, setPromptHistory] = useState<string[]>(() => readStoredPromptHistory(projectKey))
  const [promptHistoryIndex, setPromptHistoryIndex] = useState<number | null>(null)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [conversationSummaries, setConversationSummaries] = useState<ProjectConversationSummary[]>([])
  const [chatSessionId, setChatSessionId] = useState(() => buildMessageId())
  const [chatSeedMessages, setChatSeedMessages] = useState<ConversationMessage[]>([])
  const [pageError, setPageError] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [chatPanelWidth, setChatPanelWidth] = useState(() => {
    const savedWidth = Number(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY) || '')
    return Number.isFinite(savedWidth) ? Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, savedWidth)) : 420
  })
  const selectedModelIdRef = useRef<number | null>(selectedModelId)
  const projectKeyRef = useRef(projectKey)
  const projectRef = useRef<ProjectSummary | null>(null)
  const selectedFileNameRef = useRef<string | null>(selectedFileName)
  const editorDirtyRef = useRef(editorDirty)

  useEffect(() => {
    selectedModelIdRef.current = selectedModelId
  }, [selectedModelId])

  useEffect(() => {
    projectKeyRef.current = projectKey
  }, [projectKey])

  useEffect(() => {
    projectRef.current = project
  }, [project])

  useEffect(() => {
    selectedFileNameRef.current = selectedFileName
  }, [selectedFileName])

  useEffect(() => {
    editorDirtyRef.current = editorDirty
  }, [editorDirty])

  useEffect(() => {
    const initialNavigationState = initialNavigationStateRef.current
    if (!initialNavigationState?.autoPrompt && !initialNavigationState?.suggestedModelId) return
    initialNavigationStateRef.current = null
    window.history.replaceState({ ...(window.history.state ?? {}), usr: null }, '', `${location.pathname}${location.search}${location.hash}`)
  }, [location.hash, location.pathname, location.search])

  const visibleFiles = useMemo(() => {
    if (!project) return []
    return project.files.filter(file => showIndexSource || file.name !== 'index.js')
  }, [project, showIndexSource])

  const selectedFile = useMemo(() => visibleFiles.find(file => file.name === selectedFileName) ?? null, [visibleFiles, selectedFileName])
  const chatTransport = useMemo(() => new DefaultChatTransport<ConversationMessage>({
    api: `/api/projects/${encodeURIComponent(projectKey)}/chat`,
    prepareSendMessagesRequest: ({ id, messages, api }) => ({
      api: `/api/projects/${encodeURIComponent(projectKeyRef.current)}/chat`,
      body: {
        id,
        messages,
        modelId: selectedModelIdRef.current,
      },
    }),
  }), [])
  const {
    messages: displayedMessages,
    sendMessage,
    setMessages: setChatMessages,
    status: chatStatus,
  } = useChat<ConversationMessage>({
    id: chatSessionId,
    messages: chatSeedMessages,
    transport: chatTransport,
    onError: error => {
      setPageError(error.message)
    },
    onFinish: ({ messages }) => {
      setChatSeedMessages(messages)
      const nextProjectId = [...messages].reverse().find(message => message.role === 'assistant')?.metadata?.projectId
      setChatInput('')
      fetch(`/api/projects/${encodeURIComponent(projectKeyRef.current)}/chat`)
        .then(async response => {
          if (!response.ok) return
          const data = await response.json() as { conversations?: ProjectConversationSummary[] }
          setConversationSummaries(data.conversations ?? [])
        })
        .catch(() => undefined)
      if (nextProjectId && nextProjectId !== projectKeyRef.current) {
        navigate(`/projects/${nextProjectId}`, { replace: true })
        return
      }
      fetchProject().catch(err => setPageError(err instanceof Error ? err.message : String(err)))
      refreshPreview().catch(err => setPageError(err instanceof Error ? err.message : String(err)))
    },
  })
  const chatLoading = chatStatus === 'submitted' || chatStatus === 'streaming'

  const fetchProject = async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}`)
    if (!response.ok) throw new Error('加载项目失败')
    const data = await response.json() as ProjectSummary
    setProject(data)
    setSelectedFileName(current => current && data.files.some(file => file.name === current) ? current : data.files.find(file => file.name !== 'index.js')?.name ?? data.files[0]?.name ?? null)
    await fetch(`/api/projects/${encodeURIComponent(projectKey)}/current`, { method: 'POST' })
    return data
  }

  const fetchModels = async () => {
    const response = await fetch('/api/ai-models?enabled=true&usable=true')
    if (!response.ok) throw new Error('加载模型失败')
    const data = await response.json() as AiModel[]
    setModels(data)
    setSelectedModelId(current => {
      if (current !== null && data.some(model => model.id === current)) return current
      const preferredIds = [current, autoModelRef.current, readStoredSelectedModelId()]
      const rememberedModelId = preferredIds.find(id => id !== null && data.some(model => model.id === id))
      return rememberedModelId ?? data[0]?.id ?? null
    })
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
    } catch (err) {
      setPreview(null)
      setPreviewError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  const loadTextFileByName = async (fileName: string) => {
    setEditorLoading(true)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/files/content?fileName=${encodeURIComponent(fileName)}`)
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

  const loadTextFile = async (file: ProjectFile) => {
    if (file.kind !== 'text') return
    await loadTextFileByName(file.name)
  }

  const fetchConversationSummaries = async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/chat`)
    if (!response.ok) throw new Error('加载历史记录失败')
    const data = await response.json() as { conversations?: ProjectConversationSummary[] }
    setConversationSummaries(data.conversations ?? [])
  }

  const loadConversation = async (conversationId: string) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectKey)}/chat?chatId=${encodeURIComponent(conversationId)}`)
    if (!response.ok) throw new Error('加载历史对话失败')
    const data = await response.json() as ProjectConversationDetail
    const nextMessages = Array.isArray(data.messages) ? data.messages as ConversationMessage[] : []
    setChatSessionId(data.id)
    setChatSeedMessages(nextMessages)
    setChatMessages(nextMessages)
    setHistoryDialogOpen(false)
    setChatInput('')
    setPageError(null)
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
    if (!projectKey) return
    const eventSource = new EventSource(`/api/projects/${encodeURIComponent(projectKey)}/files/watch`)
    const handleChange = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data || '{}') as { fileName?: string }
      fetchProject().catch(err => setPageError(err instanceof Error ? err.message : String(err)))
      refreshPreview().catch(err => setPageError(err instanceof Error ? err.message : String(err)))

      const currentFileName = selectedFileNameRef.current
      if (!currentFileName || editorDirtyRef.current) return
      const changedFileName = typeof payload.fileName === 'string' && payload.fileName.trim() ? payload.fileName : null
      if (changedFileName && changedFileName !== currentFileName) return
      const currentFile = projectRef.current?.files.find(file => file.name === currentFileName)
      if (currentFile?.kind === 'text') {
        loadTextFileByName(currentFileName).catch(err => setPageError(err instanceof Error ? err.message : String(err)))
      }
    }
    const handleError = () => {
      setPageError(current => current ?? '项目文件变更监听已断开，请刷新页面后重试。')
    }

    eventSource.addEventListener('change', handleChange as EventListener)
    eventSource.onerror = handleError

    return () => {
      eventSource.removeEventListener('change', handleChange as EventListener)
      eventSource.close()
    }
  }, [projectKey])

  useEffect(() => {
    setActiveTab(readStoredProjectTab(projectKey))
    setPromptHistory(readStoredPromptHistory(projectKey))
    setPromptHistoryIndex(null)
    promptHistoryDraftRef.current = ''
    setChatSessionId(buildMessageId())
    setChatSeedMessages([])
    setChatMessages([])
    setConversationSummaries([])
    setHistoryDialogOpen(false)
  }, [projectKey])

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
    document.title = buildProjectPageTitle(project, projectId)
    return () => {
      document.title = '最后一版PPT'
    }
  }, [project, projectId])

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
    if (selectedModelId === null) return
    window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, String(selectedModelId))
  }, [selectedModelId])

  useEffect(() => {
    window.localStorage.setItem(getProjectTabStorageKey(projectKey), activeTab)
  }, [activeTab, projectKey])

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
    const data = await response.json() as { uploaded?: string[] }
    const projectData = await fetchProject()
    setActiveTab('resources')
    const nextSelectedFile = data.uploaded?.find(fileName => projectData.files.some(file => file.name === fileName))
    setSelectedFileName(nextSelectedFile ?? null)
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
      const widthDelta = resizeState.startX - event.clientX
      setChatPanelWidth(Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, resizeState.startWidth + widthDelta)))
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

  const rememberPrompt = (value: string) => {
    const nextPrompt = value.trim()
    if (!nextPrompt) return
    setPromptHistory(current => {
      const nextHistory = current[current.length - 1] === nextPrompt
        ? current
        : [...current, nextPrompt].slice(-100)
      window.localStorage.setItem(getPromptHistoryStorageKey(projectKey), JSON.stringify(nextHistory))
      return nextHistory
    })
    setPromptHistoryIndex(null)
    promptHistoryDraftRef.current = ''
  }

  const handleChatInputChange = (value: string) => {
    setChatInput(value)
    if (promptHistoryIndex !== null) {
      setPromptHistoryIndex(null)
    }
    promptHistoryDraftRef.current = value
  }

  const handlePromptHistoryKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.currentTarget
    if (target.selectionStart !== target.selectionEnd) return

    const textBeforeCursor = target.value.slice(0, target.selectionStart)
    const textAfterCursor = target.value.slice(target.selectionEnd)
    const canGoBackward = event.key === 'ArrowUp' && !textBeforeCursor.includes('\n')
    const canGoForward = event.key === 'ArrowDown' && !textAfterCursor.includes('\n')
    if (!canGoBackward && !canGoForward) return

    if (event.key === 'ArrowUp') {
      if (!promptHistory.length) return
      event.preventDefault()
      const nextIndex = promptHistoryIndex === null ? promptHistory.length - 1 : Math.max(0, promptHistoryIndex - 1)
      if (promptHistoryIndex === null) {
        promptHistoryDraftRef.current = chatInput
      }
      setPromptHistoryIndex(nextIndex)
      setChatInput(promptHistory[nextIndex] ?? '')
      return
    }

    if (promptHistoryIndex === null) return
    event.preventDefault()
    const nextIndex = promptHistoryIndex + 1
    if (nextIndex >= promptHistory.length) {
      setPromptHistoryIndex(null)
      setChatInput(promptHistoryDraftRef.current)
      return
    }
    setPromptHistoryIndex(nextIndex)
    setChatInput(promptHistory[nextIndex] ?? '')
  }

  const sendChat = async (content?: string, modelIdOverride?: number) => {
    const text = (content ?? chatInput).trim()
    const modelId = modelIdOverride ?? selectedModelId
    if (!text || !modelId || chatLoading) return
    rememberPrompt(text)
    setPageError(null)
    await sendMessage({ text })
  }

  const exportPpt = () => {
    window.open(`/api/projects/${encodeURIComponent(projectKey)}/export`, '_blank')
  }

  const handlePreviewWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!preview?.slides.length || Math.abs(event.deltaY) < PREVIEW_WHEEL_DELTA_THRESHOLD) return
    const now = Date.now()
    if (now - previewWheelAtRef.current < PREVIEW_WHEEL_THROTTLE_MS) {
      event.preventDefault()
      return
    }
    previewWheelAtRef.current = now
    event.preventDefault()
    setSelectedSlideIndex(current => {
      const nextIndex = current + (event.deltaY > 0 ? 1 : -1)
      return Math.min(preview.slides.length - 1, Math.max(0, nextIndex))
    })
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

              <div className={`${activeTab === 'preview' ? 'grid' : 'hidden'} min-h-0 flex-1 grid-cols-[170px_minmax(0,1fr)] gap-4 p-4`} aria-hidden={activeTab !== 'preview'}>
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
                        <div onWheel={handlePreviewWheel}>
                          <SlideCanvas slide={currentSlide} presentation={preview} />
                        </div>
                        <div className="text-xs text-gray-500">把鼠标放在预览页上，向上或向下滑动鼠标中间的小轮子，就能切换上一页或下一页。</div>
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
              <div
                  className={`${activeTab === 'resources' ? 'grid' : 'hidden'} min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)] gap-4 p-4 ${isDraggingFiles ? 'rounded-2xl border-2 border-dashed border-blue-500/70 bg-blue-500/5' : ''}`}
                  aria-hidden={activeTab !== 'resources'}
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
                            {selectedFile.name !== 'index.js' && <Button size="sm" variant="destructive" onClick={deleteSelectedFile}><Trash2 className="h-4 w-4" />删除</Button>}
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
                <div className="flex flex-wrap items-center gap-2">
                  <Select className="min-w-44 flex-1 sm:max-w-52" value={selectedModelId?.toString() || ''} onChange={event => setSelectedModelId(Number(event.target.value))}>
                    {models.map(model => <option key={model.id} value={model.id}>{model.display_name || model.model_name}</option>)}
                  </Select>
                  <Button size="sm" onClick={() => {
                    setChatSessionId(buildMessageId())
                    setChatSeedMessages([])
                    setChatMessages([])
                    setChatInput('')
                    setPageError(null)
                  }} disabled={chatLoading}>
                    <Plus className="h-4 w-4" />新对话
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setHistoryDialogOpen(true)
                    setHistoryLoading(true)
                    fetchConversationSummaries()
                      .catch(err => setPageError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setHistoryLoading(false))
                  }}>
                    <History className="h-4 w-4" />历史记录
                  </Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="space-y-4">
                  {displayedMessages.length ? displayedMessages.map(message => (
                    <ChatMessage key={message.id} message={message} toolLabels={TOOL_LABELS} />
                  )) : <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/60 p-5 text-sm text-gray-400">先告诉助手你想做什么样的演示稿，或让它继续完善当前内容。</div>}
                  <div ref={chatBottomRef} />
                </div>
              </div>
              <div className="border-t border-gray-800 px-4 py-4">
                <PromptInput
                  ref={chatInputRef}
                  value={chatInput}
                  onChange={handleChatInputChange}
                  onSubmit={() => sendChat()}
                  onKeyDown={handlePromptHistoryKeyDown}
                  disabled={chatLoading || !selectedModelId}
                  placeholder={selectedModelId ? '例如：做一个三页的产品发布会 PPT，强调问题、方案和优势。也可以先问我：你可以帮我做什么？' : '请先在模型配置中启用模型'}
                  className="min-h-28 items-stretch bg-gray-900"
                >
                  <Button onClick={() => sendChat()} disabled={chatLoading || !selectedModelId || !chatInput.trim()} className="self-end">
                    <Send className="h-4 w-4" />发送
                  </Button>
                </PromptInput>
              </div>
            </div>
          </aside>
        </div>
      </div>
      <ProjectHistoryDialog
        open={historyDialogOpen}
        loading={historyLoading}
        conversations={conversationSummaries}
        onOpenChange={setHistoryDialogOpen}
        onSelect={conversationId => {
          setHistoryLoading(true)
          loadConversation(conversationId)
            .catch(err => setPageError(err instanceof Error ? err.message : String(err)))
            .finally(() => setHistoryLoading(false))
        }}
      />
    </div>
  )
}
