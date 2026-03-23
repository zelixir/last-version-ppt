import { useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
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

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: '"Noto Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
    padding: '24px',
  } satisfies React.CSSProperties,
  shell: {
    maxWidth: '1280px',
    margin: '0 auto',
  } satisfies React.CSSProperties,
  card: {
    background: 'rgba(15, 23, 42, 0.72)',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: '20px',
    padding: '20px',
    marginBottom: '20px',
  } satisfies React.CSSProperties,
  input: {
    width: '100%',
    boxSizing: 'border-box',
    borderRadius: '14px',
    border: '1px solid #334155',
    background: '#020617',
    color: '#e2e8f0',
    padding: '12px 14px',
    fontSize: '14px',
  } satisfies React.CSSProperties,
  button: {
    border: 'none',
    borderRadius: '14px',
    background: '#2563eb',
    color: '#fff',
    padding: '12px 18px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
  } satisfies React.CSSProperties,
  muted: {
    color: '#cbd5e1',
    fontSize: '14px',
    lineHeight: 1.8,
  } satisfies React.CSSProperties,
  status: {
    marginTop: '14px',
    borderRadius: '14px',
    border: '1px solid #334155',
    background: '#020617',
    padding: '12px 14px',
    fontSize: '14px',
    lineHeight: 1.8,
  } satisfies React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: '20px',
  } satisfies React.CSSProperties,
  imageFrame: {
    overflow: 'hidden',
    borderRadius: '16px',
    border: '1px solid rgba(148, 163, 184, 0.3)',
    background: '#fff',
  } satisfies React.CSSProperties,
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
  } satisfies React.CSSProperties,
  logBox: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    fontSize: '12px',
    lineHeight: 1.8,
  } satisfies React.CSSProperties,
} as const

function PptTextWidthTestPage() {
  const [projectId, setProjectId] = useState(readInitialProjectId)
  const [preview, setPreview] = useState<PreviewPresentation | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [status, setStatus] = useState('请输入项目编号，然后点击“开始核对”。')
  const [loading, setLoading] = useState(false)
  const [phase, setPhase] = useState<RenderPhase>('idle')
  const previewLogs = preview?.logs ?? []
  const canRun = projectId.trim().length > 0 && !loading
  const pageCountText = useMemo(
    () => preview ? `一共生成 ${preview.slides.length} 页，目前已经得到 ${images.length} 张图片。` : '',
    [images.length, preview],
  )

  const generateImages = useCallback(async (targetProjectId = projectId) => {
    const nextProjectId = targetProjectId.trim()
    if (!nextProjectId) {
      setPhase('error')
      setStatus('请先填写项目编号。')
      return
    }

    setLoading(true)
    setPhase('running')
      setStatus('正在请服务器准备核对页面，请稍等…')
      setImages([])

      try {
      const rendered = await runProjectPreview(nextProjectId, progress => setStatus(progress.message))
      setPreview(rendered.presentation)
      setImages(rendered.images)
      setPhase('done')
      setStatus(
        rendered.imageError
          ? `核对页面已经准备好，但高保真图片这次没有生成成功：${rendered.imageError}`
          : `核对页面已经准备好，项目 ${nextProjectId} 的图片已生成。`,
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
    <main style={styles.page}>
      <div style={styles.shell}>
        <section style={styles.card}>
          <h1 style={{ margin: '0 0 12px', fontSize: '28px' }}>中文文字宽度核对</h1>
            <p style={styles.muted}>
              这个页面只用于核对中文文字宽度：由服务器统一生成 PPT 和图片，方便和页面里的预览结果做对照。
            </p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'end', marginTop: '16px' }}>
            <label style={{ flex: 1 }}>
              <div style={{ marginBottom: '8px', fontSize: '14px', color: '#cbd5e1' }}>项目编号</div>
              <input
                value={projectId}
                onChange={event => setProjectId(event.target.value)}
                placeholder="例如：20260318_中文文字宽度核对"
                style={styles.input}
              />
            </label>
            <button
              type="button"
              onClick={() => void generateImages()}
              disabled={!canRun}
              style={{ ...styles.button, opacity: canRun ? 1 : 0.5, cursor: canRun ? 'pointer' : 'not-allowed' }}
            >
              {loading ? '正在核对…' : '开始核对'}
            </button>
          </div>
          <div style={styles.status}>{status}</div>
          {pageCountText ? <div style={{ marginTop: '10px', fontSize: '12px', color: '#94a3b8' }}>{pageCountText}</div> : null}
        </section>

        {previewLogs.length > 0 ? (
          <section style={styles.card}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px' }}>脚本输出</h2>
            <pre style={styles.logBox}>{previewLogs.join('\n')}</pre>
          </section>
        ) : null}

        {images.length > 0 ? (
          <section style={styles.card}>
            <h2 style={{ margin: '0 0 12px', fontSize: '18px' }}>PPT 渲染结果</h2>
            <div style={styles.grid}>
              {images.map((image, index) => (
                <article key={index}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <div>第 {index + 1} 页</div>
                    <a href={image} download={buildDownloadName(projectId, index)} style={{ color: '#93c5fd', fontSize: '12px' }}>
                      下载图片
                    </a>
                  </div>
                  <div style={styles.imageFrame}>
                    <img src={image} alt={`第 ${index + 1} 页预览图`} style={styles.image} />
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<PptTextWidthTestPage />)
