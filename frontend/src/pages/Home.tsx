import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BrainCircuit, CopyPlus, FolderOpen, LoaderCircle, Plus, Search, Settings2, Sparkles, Trash2 } from 'lucide-react'
import type { AiModel, ConfigStatus, ProjectSummary } from '../types'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { warmupPreviewEngine } from '../lib/preview-image-generator'

const PLACEHOLDERS = [
  '做一个 8 页的产品介绍 PPT，风格科技感强，包含时间线与功能亮点。',
  '把我的商业计划书整理成投资人演示稿，重点突出市场规模、商业模式和财务预测。',
  '生成一份培训课件，主题是团队沟通协作，要求有封面、目录、案例和总结页。',
  '做一个汇报型 PPT，总结本季度运营数据，包含图表、关键结论和下季度计划。',
]

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null)
  const [models, setModels] = useState<AiModel[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [placeholderSeed, setPlaceholderSeed] = useState(() => Math.floor(Math.random() * PLACEHOLDERS.length))
  const [requirement, setRequirement] = useState(() => PLACEHOLDERS[placeholderSeed % PLACEHOLDERS.length])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const filteredProjects = useMemo(() => {
    const keyword = searchText.trim().toLowerCase()
    if (!keyword) return projects
    return projects.filter(project =>
      [project.name, project.id, project.sourcePrompt || '']
        .some(value => value.toLowerCase().includes(keyword)),
    )
  }, [projects, searchText])

  const fetchProjects = () => {
    fetch('/api/projects')
      .then(async response => {
        if (!response.ok) throw new Error('加载项目失败')
        return response.json()
      })
      .then(data => setProjects(data.projects ?? []))
      .catch(err => {
        console.error(err)
        setError('加载项目失败，请刷新页面后重试。')
      })
  }

  const fetchStatus = () => {
    fetch('/api/config-status')
      .then(async response => {
        if (!response.ok) throw new Error('加载模型状态失败')
        return response.json()
      })
      .then((data: ConfigStatus) => setConfigStatus(data))
      .catch(err => {
        console.error(err)
        setError('加载模型状态失败，请刷新页面后重试。')
      })
  }

  const fetchModels = () => {
    fetch('/api/ai-models?enabled=true&usable=true')
      .then(async response => {
        if (!response.ok) throw new Error('加载模型列表失败')
        return response.json()
      })
      .then((data: AiModel[]) => {
        setModels(data)
        setSelectedModelId(current => {
          if (current !== null && data.some(model => model.id === current)) return current
          return data[0]?.id ?? null
        })
      })
      .catch(err => {
        console.error(err)
        setError('加载模型列表失败，请刷新页面后重试。')
      })
  }

  useEffect(() => {
    fetchProjects()
    fetchStatus()
    fetchModels()
  }, [])

  const createProject = async () => {
    if (!requirement.trim() || loading) return
    if (!selectedModelId) {
      setError('当前还没有可用的模型服务，请先到模型配置页面填写可用的接口密钥，并启用至少一个模型。')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirement.trim(), modelId: selectedModelId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '创建项目失败')
      const prompt = requirement.trim()
      const nextSeed = placeholderSeed + 1
      void warmupPreviewEngine()
      setPlaceholderSeed(nextSeed)
      setRequirement(PLACEHOLDERS[nextSeed % PLACEHOLDERS.length])
      navigate(`/projects/${data.id}`, { state: { autoPrompt: prompt, suggestedModelId: selectedModelId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const cloneProject = async (project: ProjectSummary) => {
    const name = window.prompt('请输入新项目名称', `${project.name}-副本`)
    if (!name) return
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.error || '克隆项目失败')
      return
    }
    fetchProjects()
  }

  const openProjectFolder = async (project: ProjectSummary) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/open-folder`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.error || '打开文件夹失败')
      return
    }
  }

  const deleteProject = async (project: ProjectSummary) => {
    const firstConfirm = window.confirm(`确定要删除“${project.name}”吗？`)
    if (!firstConfirm) return
    const secondConfirm = window.confirm(`删除：${project.files.length} 个文件，${project.chatHistory.length} 条消息。\n删除后无法恢复，确定继续吗？`)
    if (!secondConfirm) return
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.error || '删除项目失败')
      return
    }
    fetchProjects()
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {error && <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}

        <section className="rounded-3xl border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/20">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Sparkles className="h-8 w-8 text-blue-400" />
                <div>
                  <h1 className="text-2xl font-bold text-white">最后一版PPT</h1>
                  <p className="text-sm text-gray-400">输入需求后，系统会先帮你取一个项目名，再进入项目页自动开始生成与编辑 PPT。</p>
                </div>
              </div>
            </div>
            <Button
              variant={configStatus?.needsAttention ? 'destructive' : 'outline'}
              onClick={() => navigate('/models')}
              className={configStatus?.needsAttention ? 'animate-pulse' : ''}
            >
              <Settings2 className="h-4 w-4" />
              模型配置
            </Button>
          </div>

          {configStatus?.needsAttention && (
            <div className="mt-5 rounded-2xl border border-amber-700/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-medium">需要先配置真实模型</div>
                  <div className="mt-1 text-amber-200/80">如果服务商仍在使用尚未配置模型服务的 API Key，或者当前没有启用可用模型，系统就无法帮你创建项目和继续完善 PPT。</div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><BrainCircuit className="h-4 w-4 text-blue-400" />新建演示稿需求</div>
            <Textarea
              value={requirement}
              onChange={event => setRequirement(event.target.value)}
              placeholder="请直接写下你想做的演示稿要求"
              aria-label="演示稿需求"
              className="min-h-32 bg-gray-900"
            />
            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div>
                <Select
                  value={selectedModelId?.toString() || ''}
                  onChange={event => setSelectedModelId(event.target.value ? Number(event.target.value) : null)}
                  disabled={models.length === 0}
                  aria-label="选择模型"
                >
                  <option value="">{models.length === 0 ? '还没有可用模型' : '请选择模型'}</option>
                  {models.map(model => <option key={model.id} value={model.id}>{model.display_name || model.model_name}</option>)}
                </Select>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    const nextSeed = placeholderSeed + 1
                    setPlaceholderSeed(nextSeed)
                    setRequirement(PLACEHOLDERS[nextSeed % PLACEHOLDERS.length])
                  }}
                >
                  换一个示例
                </Button>
                <Button onClick={createProject} disabled={loading || !requirement.trim() || !selectedModelId}>
                  {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    创建项目并开始制作
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">项目列表</h2>
                <p className="text-sm text-gray-400">点击项目可继续完善内容，也可以复制、删除或直接打开对应文件夹。</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <Input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="搜索项目名、编号或需求内容" className="pl-9" />
              </div>
              <Button variant="outline" onClick={fetchProjects}><FolderOpen className="h-4 w-4" />刷新列表</Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredProjects.map(project => (
              <div key={project.id} className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{project.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{project.id}</div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => openProjectFolder(project)}><FolderOpen className="h-4 w-4" />打开文件夹</Button>
                </div>
                <div className="mt-3 line-clamp-3 min-h-14 text-sm text-gray-400">{project.sourcePrompt || '这个项目还没有保存初始需求。'}</div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span className="rounded-full border border-gray-800 px-2 py-1">{project.files.length} 个文件</span>
                  <span className="rounded-full border border-gray-800 px-2 py-1">{project.chatHistory.length} 条消息</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" asChild>
                    <a href={`/projects/${project.id}`}><ArrowRight className="h-4 w-4" />进入项目</a>
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => cloneProject(project)}><CopyPlus className="h-4 w-4" />克隆</Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteProject(project)}><Trash2 className="h-4 w-4" />删除</Button>
                </div>
              </div>
            ))}
          </div>

          {filteredProjects.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-sm text-gray-500">
              {projects.length === 0 ? '还没有项目。先在顶部输入需求，系统会自动命名并创建第一个项目。' : '没有找到符合条件的项目，请换个关键词试试。'}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
