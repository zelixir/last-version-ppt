const PPTX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

interface UploadedPreviewImage {
  pageNumber: number
  url: string
}

export interface PreviewProgressStatus {
  message: string
  percent?: number
}

export async function warmupPreviewEngine() {
}

export async function generatePreviewImages(
  projectId: string,
  pptxData: Uint8Array,
  onProgress?: (progress: PreviewProgressStatus) => void,
) {
  onProgress?.({ message: '正在请服务器生成高保真预览图…' })

  const formData = new FormData()
  const pptxBytes = Uint8Array.from(pptxData)
  formData.append('pptx', new File([pptxBytes], 'preview.pptx', { type: PPTX_MIME_TYPE }))

  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview-images`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new Error(data?.error || '服务器生成预览图失败')
  }

  onProgress?.({ message: '预览图已经生成好了', percent: 100 })
  const data = await response.json() as { images?: UploadedPreviewImage[] }
  return (data.images ?? []).sort((a, b) => a.pageNumber - b.pageNumber).map(image => image.url)
}
