import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getInitialSelectedModelId, readStoredSelectedModelId, SELECTED_MODEL_STORAGE_KEY, writeStoredSelectedModelId } from '../frontend/src/lib/selected-model-storage'

class MemoryStorage {
  private readonly data = new Map<string, string>()

  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  setItem(key: string, value: string) {
    this.data.set(key, value)
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  clear() {
    this.data.clear()
  }
}

describe('selected-model-storage', () => {
  const originalWindow = globalThis.window
  const localStorage = new MemoryStorage()

  beforeEach(() => {
    localStorage.clear()
    globalThis.window = { localStorage } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    if (originalWindow) {
      globalThis.window = originalWindow
      return
    }
    Reflect.deleteProperty(globalThis as typeof globalThis & { window?: Window }, 'window')
  })

  test('优先使用页面传入的模型编号', () => {
    writeStoredSelectedModelId(7)

    expect(getInitialSelectedModelId(11)).toBe(11)
  })

  test('页面没有传入模型编号时，继续使用之前记住的模型', () => {
    writeStoredSelectedModelId(7)

    expect(getInitialSelectedModelId()).toBe(7)
  })

  test('写入 null 时会清空记住的模型', () => {
    writeStoredSelectedModelId(7)
    writeStoredSelectedModelId(null)

    expect(readStoredSelectedModelId()).toBeNull()
    expect(localStorage.getItem(SELECTED_MODEL_STORAGE_KEY)).toBeNull()
  })
})
