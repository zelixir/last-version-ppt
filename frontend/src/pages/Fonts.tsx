import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, LoaderCircle, RefreshCw, Save, Search, Sparkles } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

interface FontItem {
  name: string
  displayName?: string
  size: number
  selected?: boolean
  defaultPreferred?: boolean
}

interface FontResponse {
  fonts: FontItem[]
  selected: string[]
  defaults: string[]
}

export default function Fonts() {
  const navigate = useNavigate()
  const location = useLocation()
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo || '/'
  const [fonts, setFonts] = useState<FontItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [defaultFonts, setDefaultFonts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const filteredFonts = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    if (!text) return fonts
    return fonts.filter(font => {
      const title = (font.displayName || font.name).toLowerCase()
      return title.includes(text) || font.name.toLowerCase().includes(text)
    })
  }, [fonts, keyword])

  const syncSelection = (list: string[]) => setSelected(new Set(list))

  const fetchFonts = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/fonts')
      if (!response.ok) throw new Error('加载字体列表失败')
      const data = await response.json() as FontResponse
      const selectedNames = new Set(data.selected ?? [])
      const normalizedFonts = (data.fonts ?? []).map(font => ({
        ...font,
        displayName: font.displayName || font.name,
      }))
      const sortedFonts = [...normalizedFonts].sort((a, b) => {
        const aSelected = selectedNames.has(a.name) || a.selected
        const bSelected = selectedNames.has(b.name) || b.selected
        if (aSelected !== bSelected) return Number(bSelected) - Number(aSelected)
        if (a.defaultPreferred !== b.defaultPreferred) return Number(Boolean(b.defaultPreferred)) - Number(Boolean(a.defaultPreferred))
        return (a.displayName || a.name).localeCompare(b.displayName || b.name, 'zh-Hans-CN')
      })
      setFonts(sortedFonts)
      syncSelection(data.selected ?? normalizedFonts.filter(font => font.selected).map(font => font.name))
      setDefaultFonts(data.defaults ?? [])
      setMessage(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFonts().catch(() => undefined)
  }, [])

  const toggleFont = (name: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const selectDefaults = () => {
    if (!defaultFonts.length) return
    const available = new Set(fonts.map(font => font.name))
    const next = defaultFonts.filter(name => available.has(name))
    syncSelection(next)
  }

  const selectAll = () => syncSelection(fonts.map(font => font.name))

  const saveSelection = async () => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const response = await fetch('/api/fonts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected: Array.from(selected) }),
      })
      const data = await response.json() as FontResponse
      if (!response.ok) throw new Error(data && typeof (data as any).error === 'string' ? (data as any).error : '保存失败')
      syncSelection(data.selected ?? [])
      setMessage('字体配置已保存，后端会在下一次预览时加载这些字体。')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const formatSize = (size: number) => {
    if (!Number.isFinite(size) || size <= 0) return ''
    if (size > 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`
    if (size > 1024) return `${Math.round(size / 1024)} KB`
    return `${size} B`
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6 md:p-10">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(returnTo)} aria-label="返回">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="text-sm font-semibold text-white">字体管理</div>
              <div className="text-xs text-gray-400">只有勾选的字体会被上传到预览引擎，AI 也会遵守这里的名单。</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={selectDefaults} disabled={loading || fonts.length === 0}>
              <Sparkles className="h-4 w-4" />使用推荐字体
            </Button>
            <Button variant="outline" size="sm" onClick={selectAll} disabled={loading || fonts.length === 0}>
              <RefreshCw className="h-4 w-4" />全选
            </Button>
            <Button size="sm" onClick={saveSelection} disabled={saving || loading}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存配置
            </Button>
          </div>
        </header>

        {(message || error) && (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${error ? 'border-red-900/60 bg-red-950/40 text-red-100' : 'border-green-900/60 bg-green-950/30 text-green-100'}`}>
            {error || message}
          </div>
        )}

        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4 shadow-xl shadow-black/10">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <CheckCircle2 className="h-4 w-4 text-blue-400" />
              <span>已选 {selected.size} 个字体 · 共 {fonts.length} 个可用字体</span>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <Input
                value={keyword}
                onChange={event => setKeyword(event.target.value)}
                placeholder="按文件名搜索字体，例如 msyh"
                className="w-full bg-gray-900 pl-10"
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {loading && <div className="col-span-full flex items-center gap-2 text-sm text-gray-400"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取字体列表…</div>}
            {!loading && filteredFonts.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-gray-800 px-4 py-6 text-center text-sm text-gray-400">没有找到匹配的字体，可以换个关键词试试。</div>}
            {filteredFonts.map(font => {
              const checked = selected.has(font.name)
              return (
                <label key={font.name} className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition ${checked ? 'border-blue-600 bg-blue-950/40' : 'border-gray-800 bg-gray-950/40 hover:border-gray-700'}`}>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 text-sm font-medium text-white">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFont(font.name)}
                        className="h-4 w-4"
                      />
                      <span>{font.displayName || font.name}</span>
                      {font.defaultPreferred && <span className="rounded-full bg-blue-900/60 px-2 text-xs text-blue-100">推荐</span>}
                    </div>
                    <div className="ml-6 text-xs text-gray-500">
                      {font.name} · {formatSize(font.size) || '大小未知'}
                    </div>
                  </div>
                  {checked && <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-blue-400" />}
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
