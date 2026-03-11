import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, BrainCircuit, CopyPlus, FolderOpen, Layers3, LoaderCircle, Plus, Settings2, Sparkles } from 'lucide-react'
import type { ConfigStatus, ProjectSummary } from '../types'
import { Button } from '../components/ui/button'
import { Textarea } from '../components/ui/textarea'

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
  const [requirement, setRequirement] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [placeholderSeed, setPlaceholderSeed] = useState(() => Math.floor(Math.random() * PLACEHOLDERS.length))

  const placeholder = useMemo(() => PLACEHOLDERS[placeholderSeed % PLACEHOLDERS.length], [placeholderSeed])

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

  useEffect(() => {
    fetchProjects()
    fetchStatus()
  }, [])

  const createProject = async () => {
    if (!requirement.trim() || loading) return
    if (!configStatus?.firstUsableModelId) {
      setError('当前没有可用模型，先去模型配置页面填写真实 API Key 并启用模型。')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement: requirement.trim(), modelId: configStatus.firstUsableModelId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '创建项目失败')
      const prompt = requirement.trim()
      setRequirement('')
      setPlaceholderSeed(current => current + 1)
      navigate(`/projects/${data.id}`, { state: { autoPrompt: prompt, suggestedModelId: configStatus.firstUsableModelId } })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const cloneProject = async (project: ProjectSummary) => {
    const name = window.prompt('请输入新项目名称', `${project.name}-copy`)
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

  const createVersion = async (project: ProjectSummary) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/create-version`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      setError(data?.error || '创建版本失败')
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
                  <h1 className="text-2xl font-bold text-white">Last Version PPT</h1>
                  <p className="text-sm text-gray-400">输入需求，AI 会先为项目命名，再进入项目页自动开始生成与编辑 index.js。</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-400">
                <span className="rounded-full border border-gray-700 px-2 py-1">项目目录：%appdata%/last-version-ppt</span>
                <span className="rounded-full border border-gray-700 px-2 py-1">PptxGenJS</span>
                <span className="rounded-full border border-gray-700 px-2 py-1">AI 生成 index.js</span>
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
                  <div className="mt-1 text-amber-200/80">如果服务商仍使用示例 stub API Key，或者当前没有启用可用模型，AI 创建项目与项目对话都会被阻止。</div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white"><BrainCircuit className="h-4 w-4 text-blue-400" />新建项目需求</div>
            <Textarea
              value={requirement}
              onChange={event => setRequirement(event.target.value)}
              placeholder={placeholder}
              className="min-h-32 bg-gray-900"
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setPlaceholderSeed(current => current + 1)}>换一个示例</Button>
              <Button onClick={createProject} disabled={loading || !requirement.trim()}>
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                创建项目并开始生成
              </Button>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-3xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">项目列表</h2>
              <p className="text-sm text-gray-400">点击项目可进入对应工作区；支持克隆和创建版本。</p>
            </div>
            <Button variant="outline" onClick={fetchProjects}><FolderOpen className="h-4 w-4" />刷新列表</Button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map(project => (
              <div key={project.id} className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-white">{project.name}</div>
                    <div className="mt-1 text-xs text-gray-500">{project.id}</div>
                  </div>
                  {project.id !== project.rootProjectId && <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[10px] text-blue-200">版本</span>}
                </div>
                <div className="mt-3 line-clamp-3 min-h-14 text-sm text-gray-400">{project.sourcePrompt || '这个项目还没有保存初始需求。'}</div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span className="rounded-full border border-gray-800 px-2 py-1">{project.files.length} 个文件</span>
                  <span className="rounded-full border border-gray-800 px-2 py-1">{project.chatHistory.length} 条消息</span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => navigate(`/projects/${project.id}`)}><ArrowRight className="h-4 w-4" />进入项目</Button>
                  <Button size="sm" variant="ghost" onClick={() => cloneProject(project)}><CopyPlus className="h-4 w-4" />克隆</Button>
                  <Button size="sm" variant="ghost" onClick={() => createVersion(project)}><Layers3 className="h-4 w-4" />创建版本</Button>
                </div>
              </div>
            ))}
          </div>

          {projects.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-700 p-10 text-center text-sm text-gray-500">
              还没有项目。先在顶部输入需求，AI 会自动命名并创建第一个项目。
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
