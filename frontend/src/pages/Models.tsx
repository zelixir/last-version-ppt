import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, BrainCircuit, Building2, Check, Copy, Eye, EyeOff, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { AiModel, ModelProvider } from '../types'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'

type Tab = 'providers' | 'models'
const emptyModelForm = { model_name: '', display_name: '', provider: '', enabled: 'Y' as 'Y' | 'N' }
const emptyProviderForm = { name: '', label: '', base_url: '', api_key: '' }

type ConfirmState =
  | { type: 'provider'; name: string; affectedModels: AiModel[] }
  | { type: 'model'; id: number; name: string }

type ProviderForm = typeof emptyProviderForm
type ModelForm = typeof emptyModelForm
type ProviderFormErrors = Partial<Record<keyof ProviderForm, string>>
type ModelFormErrors = Partial<Record<keyof ModelForm, string>>

const DEFAULT_STUB_API_KEYS = new Set([
  'your_dashscope_api_key_here',
  'your_modelscope_api_key_here',
])

function isStubApiKey(apiKey: string) {
  const normalized = apiKey.trim()
  if (!normalized) return false
  const lowered = normalized.toLowerCase()
  return DEFAULT_STUB_API_KEYS.has(normalized)
    || /^(your[_-]|example[_-]?key|placeholder|demo[_-]?key|test[_-]?key)/.test(lowered)
}

function getFieldClass(hasError: boolean) {
  return hasError ? 'border-red-500 bg-red-950/20 focus:ring-red-500' : ''
}

function buildProviderErrors(form: ProviderForm): ProviderFormErrors {
  const errors: ProviderFormErrors = {}
  if (!form.name.trim()) errors.name = '请填写服务标识'
  if (!form.base_url.trim()) errors.base_url = '请填写接口地址'
  if (!form.api_key.trim()) errors.api_key = '请填写接口密钥'
  else if (isStubApiKey(form.api_key)) errors.api_key = '当前还是示例密钥，请换成你自己的真实密钥'
  return errors
}

function buildModelErrors(form: ModelForm): ModelFormErrors {
  const errors: ModelFormErrors = {}
  if (!form.model_name.trim()) errors.model_name = '请填写模型编号'
  if (!form.display_name.trim()) errors.display_name = '请填写显示名称'
  if (!form.provider.trim()) errors.provider = '请选择所属服务'
  return errors
}

export default function Models() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || '/'
  const [tab, setTab] = useState<Tab>('providers')
  const [providers, setProviders] = useState<ModelProvider[]>([])
  const [models, setModels] = useState<AiModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [showProviderForm, setShowProviderForm] = useState(false)
  const [showModelForm, setShowModelForm] = useState(false)
  const [providerForm, setProviderForm] = useState(emptyProviderForm)
  const [modelForm, setModelForm] = useState(emptyModelForm)
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null)
  const [editingModelId, setEditingModelId] = useState<number | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null)
  const [providerErrors, setProviderErrors] = useState<ProviderFormErrors>({})
  const [modelErrors, setModelErrors] = useState<ModelFormErrors>({})
  const [showProviderApiKey, setShowProviderApiKey] = useState(false)
  const [copiedState, setCopiedState] = useState<string | null>(null)

  const fetchProviders = () => {
    fetch('/api/providers')
      .then(async r => {
        if (!r.ok) throw new Error(`加载服务商失败（${r.status} ${r.statusText}）`)
        return r.json()
      })
      .then((data: ModelProvider[]) => setProviders(data))
      .catch(err => {
        console.error(err)
        setError('加载服务商失败，请刷新页面重试。')
      })
  }

  const fetchModels = () => {
    fetch('/api/ai-models')
      .then(async r => {
        if (!r.ok) throw new Error(`加载模型失败（${r.status} ${r.statusText}）`)
        return r.json()
      })
      .then((data: AiModel[]) => setModels(data))
      .catch(err => {
        console.error(err)
        setError('加载模型失败，请刷新页面重试。')
      })
  }

  useEffect(() => {
    fetchProviders()
    fetchModels()
  }, [])

  useEffect(() => {
    if (!modelForm.provider && providers[0]) {
      setModelForm(form => ({ ...form, provider: providers[0].name }))
    }
  }, [providers, modelForm.provider])

  const resetProviderForm = () => {
    setProviderForm(emptyProviderForm)
    setProviderErrors({})
    setShowProviderApiKey(false)
    setEditingProviderName(null)
    setShowProviderForm(false)
  }

  const resetModelForm = () => {
    setModelForm({ ...emptyModelForm, provider: providers[0]?.name || '' })
    setModelErrors({})
    setEditingModelId(null)
    setShowModelForm(false)
  }

  const saveProvider = async (originalName?: string) => {
    const nextErrors = buildProviderErrors(providerForm)
    setProviderErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError(Object.values(nextErrors)[0] ?? '请先补全服务商信息')
      return
    }
    const method = originalName ? 'PUT' : 'POST'
    const url = originalName ? `/api/providers/${encodeURIComponent(originalName)}` : '/api/providers'
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(providerForm) })
    if (!response.ok) throw new Error('保存服务商失败')
    resetProviderForm()
    fetchProviders()
    fetchModels()
  }

  const saveModel = async (id?: number) => {
    const nextErrors = buildModelErrors(modelForm)
    setModelErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) {
      setError(Object.values(nextErrors)[0] ?? '请先补全模型信息')
      return
    }
    const method = id ? 'PUT' : 'POST'
    const url = id ? `/api/ai-models/${id}` : '/api/ai-models'
    const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(modelForm) })
    if (!response.ok) throw new Error('保存模型失败')
    resetModelForm()
    fetchModels()
  }

  const copyApiKey = async (apiKey: string, key: string) => {
    try {
      await navigator.clipboard.writeText(apiKey)
      setCopiedState(key)
      window.setTimeout(() => setCopiedState(current => (current === key ? null : current)), 1500)
    } catch (err) {
      console.error(err)
      setError('复制失败，请手动复制。')
    }
  }

  const deleteProviderWithModels = async (name: string, affectedModels: AiModel[]) => {
    await Promise.all(affectedModels.map(model => fetch(`/api/ai-models/${model.id}`, { method: 'DELETE' })))
    await fetch(`/api/providers/${encodeURIComponent(name)}`, { method: 'DELETE' })
    fetchProviders()
    fetchModels()
  }

  const deleteModel = async (id: number) => {
    await fetch(`/api/ai-models/${id}`, { method: 'DELETE' })
    fetchModels()
  }

  return (
    <>
      <Dialog open={!!confirmState} onOpenChange={open => !open && setConfirmState(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-red-400" />确认删除</DialogTitle>
            <DialogDescription>
              {confirmState?.type === 'provider'
                ? `删除服务商「${confirmState.name}」会同时删除其下 ${confirmState.affectedModels.length} 个模型。`
                : `删除模型「${confirmState?.name}」后无法恢复。`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmState(null)}>取消</Button>
            <Button variant="destructive" onClick={async () => {
              if (!confirmState) return
              if (confirmState.type === 'provider') await deleteProviderWithModels(confirmState.name, confirmState.affectedModels)
              else await deleteModel(confirmState.id)
              setConfirmState(null)
            }}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="min-h-screen bg-gray-950 p-6 md:p-8">
        <div className="mx-auto max-w-5xl space-y-6">
          {error && <div className="rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">{error}</div>}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-6 shadow-2xl shadow-black/20">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="icon" onClick={() => navigate(returnTo)}><ArrowLeft className="h-4 w-4" /></Button>
                  <Sparkles className="h-8 w-8 text-blue-400" />
                  <div>
                    <h1 className="text-2xl font-bold text-white">模型配置</h1>
                    <p className="text-sm text-gray-400">在这里填写做演示稿要用到的模型服务。示例密钥需要替换成你自己的可用密钥。</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-1 border-b border-gray-800">
            <button onClick={() => setTab('providers')} className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'providers' ? 'border-b-2 border-purple-400 bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              <span className="flex items-center gap-2"><Building2 className="h-4 w-4" />服务商</span>
            </button>
            <button onClick={() => setTab('models')} className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'models' ? 'border-b-2 border-blue-400 bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
              <span className="flex items-center gap-2"><BrainCircuit className="h-4 w-4" />模型</span>
            </button>
          </div>

          {tab === 'providers' && (
            <div className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">服务商配置</h2>
                   <p className="text-sm text-gray-400">填写模型服务地址和接口密钥。</p>
                </div>
                <Button size="sm" onClick={() => {
                  setShowProviderForm(prev => !prev)
                  setEditingProviderName(null)
                  setProviderForm(emptyProviderForm)
                  setProviderErrors({})
                  setShowProviderApiKey(false)
                }}><Plus className="h-4 w-4" />新增服务商</Button>
              </div>
              {showProviderForm && (
                <div className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">服务标识<span className="ml-1 text-red-400">*</span></label>
                    <Input className={getFieldClass(Boolean(providerErrors.name))} placeholder="例如 openai" value={providerForm.name} onChange={e => { setProviderForm(prev => ({ ...prev, name: e.target.value })); setProviderErrors(prev => ({ ...prev, name: undefined })) }} />
                    {providerErrors.name && <div className="text-xs text-red-300">{providerErrors.name}</div>}
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">显示名称</label>
                    <Input placeholder="给自己看的名称" value={providerForm.label} onChange={e => setProviderForm(prev => ({ ...prev, label: e.target.value }))} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-sm font-medium text-gray-200">接口地址<span className="ml-1 text-red-400">*</span></label>
                    <Input className={getFieldClass(Boolean(providerErrors.base_url))} placeholder="可直接粘贴服务商提供的地址" value={providerForm.base_url} onChange={e => { setProviderForm(prev => ({ ...prev, base_url: e.target.value })); setProviderErrors(prev => ({ ...prev, base_url: undefined })) }} />
                    {providerErrors.base_url && <div className="text-xs text-red-300">{providerErrors.base_url}</div>}
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <label className="block text-sm font-medium text-gray-200">接口密钥<span className="ml-1 text-red-400">*</span></label>
                      {isStubApiKey(providerForm.api_key) && <span className="text-xs font-medium text-red-300">未配置</span>}
                    </div>
                    <div className="flex gap-2">
                      <Input className={getFieldClass(Boolean(providerErrors.api_key) || isStubApiKey(providerForm.api_key))} type={showProviderApiKey ? 'text' : 'password'} placeholder="请粘贴真实可用的接口密钥" value={providerForm.api_key} onChange={e => { setProviderForm(prev => ({ ...prev, api_key: e.target.value })); setProviderErrors(prev => ({ ...prev, api_key: undefined })) }} />
                      <Button type="button" variant="outline" onClick={() => setShowProviderApiKey(value => !value)}>{showProviderApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showProviderApiKey ? '隐藏' : '显示'}</Button>
                      <Button type="button" variant="outline" onClick={() => copyApiKey(providerForm.api_key, editingProviderName ?? 'new-provider')} disabled={!providerForm.api_key.trim()}>{copiedState === (editingProviderName ?? 'new-provider') ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copiedState === (editingProviderName ?? 'new-provider') ? '已复制' : '复制'}</Button>
                    </div>
                    {providerErrors.api_key && <div className="text-xs text-red-300">{providerErrors.api_key}</div>}
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={resetProviderForm}>取消</Button><Button onClick={() => saveProvider().catch(err => setError(err instanceof Error ? err.message : String(err)))}>保存</Button></div>
                </div>
              )}
              <div className="space-y-3">
                {providers.map(provider => {
                  const isEditing = editingProviderName === provider.name
                  const providerUsesStubKey = isStubApiKey(provider.api_key)
                  return (
                    <div key={provider.name} className={`rounded-xl border bg-gray-950/60 p-4 ${providerUsesStubKey ? 'border-red-900/60' : 'border-gray-800'}`}>
                      {isEditing ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">服务标识<span className="ml-1 text-red-400">*</span></label>
                            <Input className={getFieldClass(Boolean(providerErrors.name))} value={providerForm.name} onChange={e => { setProviderForm(prev => ({ ...prev, name: e.target.value })); setProviderErrors(prev => ({ ...prev, name: undefined })) }} />
                            {providerErrors.name && <div className="text-xs text-red-300">{providerErrors.name}</div>}
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">显示名称</label>
                            <Input value={providerForm.label} onChange={e => setProviderForm(prev => ({ ...prev, label: e.target.value }))} />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <label className="block text-sm font-medium text-gray-200">接口地址<span className="ml-1 text-red-400">*</span></label>
                            <Input className={getFieldClass(Boolean(providerErrors.base_url))} value={providerForm.base_url} onChange={e => { setProviderForm(prev => ({ ...prev, base_url: e.target.value })); setProviderErrors(prev => ({ ...prev, base_url: undefined })) }} />
                            {providerErrors.base_url && <div className="text-xs text-red-300">{providerErrors.base_url}</div>}
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <div className="flex items-center justify-between gap-3">
                              <label className="block text-sm font-medium text-gray-200">接口密钥<span className="ml-1 text-red-400">*</span></label>
                              {isStubApiKey(providerForm.api_key) && <span className="text-xs font-medium text-red-300">未配置</span>}
                            </div>
                            <div className="flex gap-2">
                              <Input className={getFieldClass(Boolean(providerErrors.api_key) || isStubApiKey(providerForm.api_key))} type={showProviderApiKey ? 'text' : 'password'} value={providerForm.api_key} onChange={e => { setProviderForm(prev => ({ ...prev, api_key: e.target.value })); setProviderErrors(prev => ({ ...prev, api_key: undefined })) }} />
                              <Button type="button" variant="outline" onClick={() => setShowProviderApiKey(value => !value)}>{showProviderApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{showProviderApiKey ? '隐藏' : '显示'}</Button>
                              <Button type="button" variant="outline" onClick={() => copyApiKey(providerForm.api_key, provider.name)} disabled={!providerForm.api_key.trim()}>{copiedState === provider.name ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copiedState === provider.name ? '已复制' : '复制'}</Button>
                            </div>
                            {providerErrors.api_key && <div className="text-xs text-red-300">{providerErrors.api_key}</div>}
                          </div>
                          <div className="md:col-span-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={resetProviderForm}><X className="h-4 w-4" />取消</Button><Button size="sm" onClick={() => saveProvider(provider.name).catch(err => setError(err instanceof Error ? err.message : String(err)))}><Check className="h-4 w-4" />保存</Button></div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2"><span className="text-sm font-medium text-white">{provider.label || provider.name}</span>{providerUsesStubKey && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] text-red-300">未配置</span>}</div>
                            <div className="text-xs text-gray-500">标识：{provider.name}</div>
                            <div className="break-all text-xs text-gray-400">{provider.base_url}</div>
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="ghost" onClick={() => {
                              setEditingProviderName(provider.name)
                              setProviderErrors({})
                              setShowProviderApiKey(false)
                              setProviderForm({ name: provider.name, label: provider.label || '', base_url: provider.base_url, api_key: provider.api_key })
                            }}><Pencil className="h-4 w-4" />编辑</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmState({ type: 'provider', name: provider.name, affectedModels: models.filter(model => model.provider === provider.name) })}><Trash2 className="h-4 w-4" />删除</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-4 rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">模型管理</h2>
                   <p className="text-sm text-gray-400">选择项目页里可供智能助手使用的模型。</p>
                </div>
                <Button size="sm" onClick={() => {
                  setShowModelForm(prev => !prev)
                  setEditingModelId(null)
                  setModelErrors({})
                  setModelForm({ ...emptyModelForm, provider: providers[0]?.name || '' })
                }} disabled={providers.length === 0}><Plus className="h-4 w-4" />新增模型</Button>
              </div>
              {showModelForm && (
                <div className="grid gap-3 rounded-xl border border-gray-800 bg-gray-950/60 p-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">模型编号<span className="ml-1 text-red-400">*</span></label>
                    <Input className={getFieldClass(Boolean(modelErrors.model_name))} placeholder="例如 qwen3-max" value={modelForm.model_name} onChange={e => { setModelForm(prev => ({ ...prev, model_name: e.target.value })); setModelErrors(prev => ({ ...prev, model_name: undefined })) }} />
                    {modelErrors.model_name && <div className="text-xs text-red-300">{modelErrors.model_name}</div>}
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">显示名称<span className="ml-1 text-red-400">*</span></label>
                    <Input className={getFieldClass(Boolean(modelErrors.display_name))} placeholder="前端下拉里显示给你看的名称" value={modelForm.display_name} onChange={e => { setModelForm(prev => ({ ...prev, display_name: e.target.value })); setModelErrors(prev => ({ ...prev, display_name: undefined })) }} />
                    {modelErrors.display_name && <div className="text-xs text-red-300">{modelErrors.display_name}</div>}
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">所属服务<span className="ml-1 text-red-400">*</span></label>
                    <Select className={getFieldClass(Boolean(modelErrors.provider))} value={modelForm.provider} onChange={e => { setModelForm(prev => ({ ...prev, provider: e.target.value })); setModelErrors(prev => ({ ...prev, provider: undefined })) }}>{providers.map(provider => <option key={provider.name} value={provider.name}>{provider.label || provider.name}</option>)}</Select>
                    {modelErrors.provider && <div className="text-xs text-red-300">{modelErrors.provider}</div>}
                  </div>
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-200">启用状态</label>
                    <Select value={modelForm.enabled} onChange={e => setModelForm(prev => ({ ...prev, enabled: e.target.value as 'Y' | 'N' }))}><option value="Y">启用</option><option value="N">停用</option></Select>
                  </div>
                  <div className="md:col-span-2 flex justify-end gap-2"><Button variant="ghost" onClick={resetModelForm}>取消</Button><Button onClick={() => saveModel().catch(err => setError(err instanceof Error ? err.message : String(err)))}>保存</Button></div>
                </div>
              )}
              <div className="space-y-3">
                {models.map(model => {
                  const isEditing = editingModelId === model.id
                  return (
                    <div key={model.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                      {isEditing ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">模型编号<span className="ml-1 text-red-400">*</span></label>
                            <Input className={getFieldClass(Boolean(modelErrors.model_name))} value={modelForm.model_name} onChange={e => { setModelForm(prev => ({ ...prev, model_name: e.target.value })); setModelErrors(prev => ({ ...prev, model_name: undefined })) }} />
                            {modelErrors.model_name && <div className="text-xs text-red-300">{modelErrors.model_name}</div>}
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">显示名称<span className="ml-1 text-red-400">*</span></label>
                            <Input className={getFieldClass(Boolean(modelErrors.display_name))} value={modelForm.display_name} onChange={e => { setModelForm(prev => ({ ...prev, display_name: e.target.value })); setModelErrors(prev => ({ ...prev, display_name: undefined })) }} />
                            {modelErrors.display_name && <div className="text-xs text-red-300">{modelErrors.display_name}</div>}
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">所属服务<span className="ml-1 text-red-400">*</span></label>
                            <Select className={getFieldClass(Boolean(modelErrors.provider))} value={modelForm.provider} onChange={e => { setModelForm(prev => ({ ...prev, provider: e.target.value })); setModelErrors(prev => ({ ...prev, provider: undefined })) }}>{providers.map(provider => <option key={provider.name} value={provider.name}>{provider.label || provider.name}</option>)}</Select>
                            {modelErrors.provider && <div className="text-xs text-red-300">{modelErrors.provider}</div>}
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-gray-200">启用状态</label>
                            <Select value={modelForm.enabled} onChange={e => setModelForm(prev => ({ ...prev, enabled: e.target.value as 'Y' | 'N' }))}><option value="Y">启用</option><option value="N">停用</option></Select>
                          </div>
                          <div className="md:col-span-2 flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={resetModelForm}><X className="h-4 w-4" />取消</Button><Button size="sm" onClick={() => saveModel(model.id).catch(err => setError(err instanceof Error ? err.message : String(err)))}><Check className="h-4 w-4" />保存</Button></div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2"><span className="text-sm font-medium text-white">{model.display_name || model.model_name}</span><span className={`rounded-full px-2 py-0.5 text-[10px] ${model.enabled === 'Y' ? 'bg-green-500/15 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{model.enabled === 'Y' ? '已启用' : '已停用'}</span></div>
                            <div className="text-xs text-gray-500">{model.model_name}</div>
                            <div className="text-xs text-gray-400">服务商：{providers.find(provider => provider.name === model.provider)?.label || model.provider}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="ghost" onClick={() => fetch(`/api/ai-models/${model.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: model.enabled === 'Y' ? 'N' : 'Y' }) }).then(fetchModels)}>{model.enabled === 'Y' ? '停用' : '启用'}</Button>
                            <Button size="sm" variant="ghost" onClick={() => {
                              setEditingModelId(model.id)
                              setModelErrors({})
                              setModelForm({ model_name: model.model_name, display_name: model.display_name || model.model_name, provider: model.provider, enabled: model.enabled })
                            }}><Pencil className="h-4 w-4" />编辑</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmState({ type: 'model', id: model.id, name: model.display_name || model.model_name })}><Trash2 className="h-4 w-4" />删除</Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
