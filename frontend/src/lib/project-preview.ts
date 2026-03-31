import type { PreviewPresentation } from '../types'

export interface ProjectPreviewRunResult {
  presentation: PreviewPresentation
  images: string[]
  imageError?: string
}

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

export async function runProjectPreview(
  projectId: string,
  onProgress?: (progress: PreviewProgressStatus) => void,
): Promise<ProjectPreviewRunResult> {
  onProgress?.({ message: '正在请服务器生成预览，请稍等…' })

  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview`, {
    method: 'POST',
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || '服务器生成预览失败')
  }

  const data = await response.json() as ProjectPreviewRunResult
  onProgress?.({ message: '预览已经准备好了' })
  return {
    presentation: data.presentation,
    images: Array.isArray(data.images) ? data.images : [],
    imageError: typeof data.imageError === 'string' ? data.imageError : undefined,
  }
}

export async function fetchPreviewProgress(projectId: string): Promise<PreviewProgressStatus | null> {
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview/progress`);
    if (!response.ok) return null;
    const data = await response.json() as { progress?: PreviewProgressStatus | null };
    if (data && data.progress && typeof data.progress.message === 'string') {
      return data.progress;
    }
    return null;
  } catch {
    return null;
  }
}
