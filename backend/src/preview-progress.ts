export interface PreviewProgress {
  message: string;
  percent?: number;
  updatedAt: number;
}

const progressMap = new Map<string, PreviewProgress>();

export function setPreviewProgress(projectId: string, progress: { message: string; percent?: number }): void {
  progressMap.set(projectId, { ...progress, updatedAt: Date.now() });
}

export function getPreviewProgress(projectId: string): PreviewProgress | null {
  return progressMap.get(projectId) ?? null;
}

export function clearPreviewProgress(projectId: string): void {
  progressMap.delete(projectId);
}
