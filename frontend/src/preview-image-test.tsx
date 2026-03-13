import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import type { ProjectPreviewResult } from './types'

function readInitialProjectId() {
  return new URLSearchParams(window.location.search).get('projectId')?.trim() ?? ''
}

function buildDownloadName(projectId: string, index: number) {
  return `${projectId || 'project'}-slide-${index + 1}.png`
}

function PreviewImageTestPage() {
  const [projectId, setProjectId] = useState(readInitialProjectId)
  const [preview, setPreview] = useState<ProjectPreviewResult | null>(null)
  const [status, setStatus] = useState('请输入项目编号，然后点击“开始生成”。')
  const [loading, setLoading] = useState(false)
  const canRun = projectId.trim().length > 0 && !loading
  const pageCountText = useMemo(() => preview ? `共生成 ${preview.slideCount} 页，已经写入 ${preview.images.length} 张预览图。` : '', [preview])

  const generateImages = useCallback(async (targetProjectId = projectId) => {
    const nextProjectId = targetProjectId.trim()
    if (!nextProjectId) {
      setStatus('请先填写项目编号。')
      return
    }

    setLoading(true)
    setStatus('正在生成演示稿并转换预览图片，请稍等…')

    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(nextProjectId)}/preview`, { method: 'POST' })
      const data = await response.json().catch(() => null) as ProjectPreviewResult | { error?: string } | null
      if (!response.ok) throw new Error(data && 'error' in data && data.error ? data.error : '生成预览失败')
      setPreview(data as ProjectPreviewResult)
      setStatus(`生成完成，项目 ${nextProjectId} 的预览图已经准备好了。`)
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('projectId', nextProjectId)
      window.history.replaceState(null, '', nextUrl)
    } catch (error) {
      setPreview(null)
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void generateImages(projectId)
  }, [generateImages, projectId])

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold">预览出图测试</h1>
          <p className="max-w-3xl text-sm leading-6 text-slate-300">
            这个页面会让后端先生成 PPT，再用 wasm 转成图片并写进项目里的 preview 文件夹，方便确认新的预览链路是否正常。
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="flex-1">
              <div className="mb-2 text-sm text-slate-300">项目编号</div>
              <input
                value={projectId}
                onChange={event => setProjectId(event.target.value)}
                placeholder="例如：20260312_新的演示文稿"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none ring-0 placeholder:text-slate-500"
              />
            </label>
            <button
              type="button"
              onClick={() => void generateImages()}
              disabled={!canRun}
              className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {loading ? '正在生成…' : '开始生成'}
            </button>
          </div>
          <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">{status}</div>
          {pageCountText && <div className="mt-3 text-xs text-slate-400">{pageCountText}</div>}
        </section>

        {preview && preview.images.length > 0 && (
          <section className="space-y-4">
            <div className="text-sm text-slate-300">下面就是刚刚直接生成出来的预览图：</div>
            <div className="grid gap-4 lg:grid-cols-2">
              {preview.images.map((image, index) => (
                <article key={index} className="rounded-3xl border border-slate-800 bg-slate-900/80 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-white">第 {index + 1} 页</div>
                    <a
                      href={image}
                      download={buildDownloadName(projectId, index)}
                      className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-200 hover:border-slate-500"
                    >
                      下载这一页
                    </a>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-slate-800 bg-white">
                    <img src={image} alt={`第 ${index + 1} 页预览图`} className="block h-auto w-full" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<PreviewImageTestPage />)
