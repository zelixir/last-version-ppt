export const SELECTED_MODEL_STORAGE_KEY = 'last-version-ppt:selected-model-id'

export function readStoredSelectedModelId() {
  const rawValue = window.localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)
  if (!rawValue) return null
  const value = Number(rawValue)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function getInitialSelectedModelId(preferredSelectedModelId?: number | null) {
  return preferredSelectedModelId ?? readStoredSelectedModelId()
}

export function writeStoredSelectedModelId(selectedModelId: number | null) {
  if (selectedModelId === null) {
    window.localStorage.removeItem(SELECTED_MODEL_STORAGE_KEY)
    return
  }

  window.localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, String(selectedModelId))
}
