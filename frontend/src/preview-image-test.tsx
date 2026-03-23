import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { runProjectPreview } from './lib/project-preview'
import type { PreviewPresentation } from './types'

type RenderPhase = 'idle' | 'running' | 'done' | 'error'

interface PreviewImageTestState {
  projectId: string
  phase: RenderPhase
  status: string
  images: string[]
  previewLogs: string[]
  slideCount: number
  updatedAt: string
}

declare global {
  interface Window {
    __PREVIEW_IMAGE_TEST_STATE__?: PreviewImageTestState
  }
}

function readInitialProjectId() {
  return new URLSearchParams(window.location.search).get('projectId')?.trim() ?? ''
}

function buildDownloadName(projectId: string, index: number) {
  return `${projectId || 'project'}-slide-${index + 1}.png`
}

function PreviewImageTestPage() {
  const [projectId, setProjectId] = useState(readInitialProjectId)
  const [preview, setPreview] = useState<PreviewPresentation | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [status, setStatus] = useState('请输入项目编号，然后点击“开始生成”。')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<RenderPhase>('idle')
  const canRun = projectId.trim().length > 0 && !loading
  const previewLogs = preview?.logs ?? []
  const pageCountText = useMemo(() => preview ? `共生成 ${preview.slides.length} 页，已经转成 ${images.length} 张预览图。` : '', [images.length, preview])

  const generateImages = useCallback(async (targetProjectId = projectId) => {
    const nextProjectId = targetProjectId.trim()
    if (!nextProjectId) {
      setPhase('error')
      setStatus('请先填写项目编号。')
      return
    }

    setLoading(true)
    setPhase('running')
      setStatus('正在请服务器生成预览图，请稍等…')
      setImages([])

      try {
      const rendered = await runProjectPreview(nextProjectId, progress => setStatus(progress.message))
      setPreview(rendered.presentation)
      setImages(rendered.images)
      setPhase('done')
      setStatus(
        rendered.imageError
          ? `项目 ${nextProjectId} 的页面预览已经准备好，但高保真图片这次没有生成成功：${rendered.imageError}`
          : `生成完成，项目 ${nextProjectId} 的预览图已经准备好了。`,
      )
      const nextUrl = new URL(window.location.href)
      nextUrl.searchParams.set('projectId', nextProjectId)
      window.history.replaceState(null, '', nextUrl)
    } catch (error) {
      setPreview(null)
      setImages([])
      setPhase('error')
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    void generateImages(projectId)
  }, [generateImages, projectId])

  useEffect(() => {
    window.__PREVIEW_IMAGE_TEST_STATE__ = {
      projectId: projectId.trim(),
      phase,
      status,
      images,
      previewLogs,
      slideCount: preview?.slides.length ?? 0,
      updatedAt: new Date().toISOString(),
    }
  }, [images, phase, preview?.slides.length, previewLogs, projectId, status])

  return (
    <main data-render-phase={phase} className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="space-y-3">
          <h1 className="text-3xl font-semibold">预览出图测试</h1>
            <p className="max-w-3xl text-sm leading-6 text-slate-300">
              这个页面会直接让服务器读取项目脚本、生成 PPT，并把预览图写进 preview 文件夹，方便确认整条链路是否正常。
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

        {previewLogs.length > 0 && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="mb-3 text-sm font-medium text-white">脚本输出记录</div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs leading-6 text-slate-300">
                {previewLogs.join('\n')}
              </pre>
            </div>
          </section>
        )}

        {images.length > 0 && (
          <section className="space-y-4">
            <div className="text-sm text-slate-300">下面就是刚刚直接生成出来的预览图：</div>
            <div className="grid gap-4 lg:grid-cols-2">
              {images.map((image, index) => (
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
