import type { ProjectPreviewResult } from '../types'

function isProjectPreviewResult(value: unknown): value is ProjectPreviewResult {
  if (!value || typeof value !== 'object') return false
  const preview = value as Record<string, unknown>
  return typeof preview.width === 'number'
    && typeof preview.height === 'number'
    && typeof preview.slideCount === 'number'
    && Array.isArray(preview.images)
    && preview.images.every(item => typeof item === 'string')
    && Array.isArray(preview.logs)
    && preview.logs.every(item => typeof item === 'string')
}

export async function fetchProjectPreview(projectId: string): Promise<ProjectPreviewResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview`, { method: 'POST' })
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(data?.error || '生成预览失败')
  }

  const data = await response.json()
  if (!isProjectPreviewResult(data)) {
    throw new Error('预览结果格式不正确，请稍后再试')
  }
  return data
}
