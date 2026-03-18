import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { WorkerBrowserConverter } from '@matbee/libreoffice-converter/browser'
import {
  __resetLibreOfficeEnvironmentForTests,
  __setPreviewConverterFactoryForTests,
  getPreviewConverter,
  runPreviewTaskWithEnvironment,
  warmupPreviewEnvironment,
} from './libreoffice-environment'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('libreoffice-environment', () => {
  beforeEach(() => {
    __resetLibreOfficeEnvironmentForTests()
  })

  afterEach(() => {
    __resetLibreOfficeEnvironmentForTests()
  })

  it('reuses the same initialization for concurrent warmup and preview access', async () => {
    const converter = { name: 'shared' } as unknown as WorkerBrowserConverter
    const initDeferred = createDeferred<WorkerBrowserConverter>()
    let initializeCount = 0

    __setPreviewConverterFactoryForTests(() => {
      initializeCount += 1
      return initDeferred.promise
    })

    const progressMessages: string[] = []
    const warmupPromise = warmupPreviewEnvironment(progress => progressMessages.push(progress.message))
    const converterPromise = getPreviewConverter(progress => progressMessages.push(progress.message))

    expect(initializeCount).toBe(1)

    initDeferred.resolve(converter)

    await expect(warmupPromise).resolves.toBeUndefined()
    await expect(converterPromise).resolves.toBe(converter)
    expect(progressMessages.at(-1)).toBe('高保真预览引擎已经准备好了')
  })

  it('retries initialization after a failed attempt', async () => {
    const converter = { name: 'retry-success' } as unknown as WorkerBrowserConverter
    let initializeCount = 0

    __setPreviewConverterFactoryForTests(() => {
      initializeCount += 1
      if (initializeCount === 1) return Promise.reject(new Error('首次初始化失败'))
      return Promise.resolve(converter)
    })

    await expect(getPreviewConverter()).rejects.toThrow('首次初始化失败')
    await expect(getPreviewConverter()).resolves.toBe(converter)
    expect(initializeCount).toBe(2)
  })

  it('serializes preview tasks so only one render runs at a time', async () => {
    const converter = { name: 'queue' } as unknown as WorkerBrowserConverter
    const firstTaskDeferred = createDeferred<void>()
    const executionOrder: string[] = []
    const queuedProgressMessages: string[] = []

    __setPreviewConverterFactoryForTests(() => Promise.resolve(converter))

    const firstTask = runPreviewTaskWithEnvironment(async activeConverter => {
      executionOrder.push(`first:${activeConverter === converter}`)
      await firstTaskDeferred.promise
      executionOrder.push('first:done')
      return 'first-result'
    })

    const secondTask = runPreviewTaskWithEnvironment(async activeConverter => {
      executionOrder.push(`second:${activeConverter === converter}`)
      return 'second-result'
    }, progress => queuedProgressMessages.push(progress.message))

    await Bun.sleep(0)
    expect(executionOrder).toEqual(['first:true'])
    expect(queuedProgressMessages).toContain('前一个预览还在处理，马上就会继续…')

    firstTaskDeferred.resolve()

    await expect(firstTask).resolves.toBe('first-result')
    await expect(secondTask).resolves.toBe('second-result')
    expect(executionOrder).toEqual(['first:true', 'first:done', 'second:true'])
  })
})
