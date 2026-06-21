import { getDesktopBridge } from '../../desktop/bridge'
import { readLocalProjectAsync, saveLocalProjectAsync } from './projectRepository'
import { localizeWorkbenchProjectDataUrls, upgradeWorkbenchProjectMediaUrls, normalizeLegacyImageAssetKinds } from './projectMediaMigration'
import {
  clearActiveWorkbenchProjectSaveTarget,
  readCurrentWorkbenchProjectPayload,
  readCurrentWorkbenchPersistMarker,
  restoreGenerationCanvasState,
  restoreWorkbenchProjectPayload,
  restoreWorkbenchProjectState,
  subscribeWorkbenchProjectPersistence,
} from './workbenchProjectSession'
import type { WorkbenchProjectPayload, WorkbenchProjectRecordV1, WorkbenchProjectSummary as LocalProjectSummary } from './projectRecordSchema'
import { migrateProjectRecord, type CategoryMigrationDiagnostic } from './projectCategoryMigration'
import { migrateProjectV51ToV60 } from './projectV51ToV60Migration'

let lastCategoryMigrationDiagnostic: CategoryMigrationDiagnostic | null = null

/** Returns + clears the most recent Phase E4 migration diagnostic (for toast UI). */
export function consumeCategoryMigrationDiagnostic(): CategoryMigrationDiagnostic | null {
  const value = lastCategoryMigrationDiagnostic
  lastCategoryMigrationDiagnostic = null
  return value
}

const LAST_ACTIVE_PROJECT_KEY = 'nomi-workbench-last-active-project-v1'

type Dependencies = {
  onSaveError: (error: unknown) => void
}

const HYDRATE_TIMING_WARN_MS = 250
const DATA_URL_LOCALIZE_BATCH_SIZE = 12
const POST_STARTUP_BACKGROUND_DELAY_MS = 2_500

function readWindowSearchParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    const url = new URL(window.location.href)
    const directValue = url.searchParams.get(name)
    if (directValue && directValue.trim()) return directValue.trim()
    const hashSearch = url.hash.includes('?') ? url.hash.slice(url.hash.indexOf('?')) : ''
    const value = hashSearch ? new URLSearchParams(hashSearch).get(name) : ''
    return value && value.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function writeLastActiveProjectId(projectId: string): void {
  if (typeof window === 'undefined') return
  const id = projectId.trim()
  if (!id) return
  window.localStorage.setItem(LAST_ACTIVE_PROJECT_KEY, id)
}

function schedulePostStartupBackgroundWork(callback: () => void): void {
  if (typeof window === 'undefined') {
    callback()
    return
  }
  const idleWindow = window as Window & {
    requestIdleCallback?: (
      callback: IdleRequestCallback,
      options?: IdleRequestOptions,
    ) => number
  }
  window.setTimeout(() => {
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(() => callback(), { timeout: 3_000 })
      return
    }
    window.setTimeout(callback, 0)
  }, POST_STARTUP_BACKGROUND_DELAY_MS)
}

function writeLastActiveProjectIdSoon(projectId: string): void {
  schedulePostStartupBackgroundWork(() => writeLastActiveProjectId(projectId))
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function logHydrateTiming(projectId: string, entries: Array<[label: string, durationMs: number]>): void {
  const total = entries.reduce((sum, [, duration]) => sum + duration, 0)
  if (total < HYDRATE_TIMING_WARN_MS && entries.every(([, duration]) => duration < HYDRATE_TIMING_WARN_MS)) return
  const summary = entries
    .filter(([, duration]) => duration >= 1)
    .map(([label, duration]) => `${label}=${duration.toFixed(1)}ms`)
    .join(' ')
  console.info(`[nomi] hydrate project ${projectId}: total=${total.toFixed(1)}ms ${summary}`)
}

function logBackgroundMigration(projectId: string, message: string): void {
  console.info(`[nomi] project ${projectId}: ${message}`)
}

export type WorkbenchProjectPersistenceService = {
  hydrateProject: (projectId: string) => Promise<WorkbenchProjectRecordV1 | null>
  hydrateInitialProject: () => Promise<WorkbenchProjectRecordV1 | null>
  persistProject: (project: LocalProjectSummary, payload: WorkbenchProjectPayload) => Promise<WorkbenchProjectRecordV1>
  bindProjectPersistence: (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }) => () => void
}

export function createWorkbenchProjectPersistenceService(deps: Dependencies): WorkbenchProjectPersistenceService {
  let hydrateSequence = 0

  const persistProject = async (project: LocalProjectSummary, payload: WorkbenchProjectPayload): Promise<WorkbenchProjectRecordV1> => {
    const localSaved = await saveLocalProjectAsync(project.id, payload, project.name, project)
    writeLastActiveProjectId(localSaved.id)
    return localSaved
  }

  const bindProjectPersistence = (input: {
    project: LocalProjectSummary
    isHydrating: () => boolean
    canPersist: () => boolean
    onSaved: (record: WorkbenchProjectRecordV1) => void
    onSaveError: (error: unknown) => void
  }): (() => void) => {
    return subscribeWorkbenchProjectPersistence({
      projectId: input.project.id,
      projectName: input.project.name,
      isHydrating: input.isHydrating,
      canPersist: input.canPersist,
      saveProject: async (_projectId, payload, _projectName) => persistProject(input.project, payload),
      onSaved: input.onSaved,
      onSaveError: input.onSaveError,
    })
  }

  const hydrateProject = async (projectId: string): Promise<WorkbenchProjectRecordV1 | null> => {
    const sequence = ++hydrateSequence
    const timings: Array<[string, number]> = []
    const timeStep = <T>(label: string, work: () => T): T => {
      const start = nowMs()
      try {
        return work()
      } finally {
        timings.push([label, nowMs() - start])
      }
    }
    const timeAsyncStep = async <T>(label: string, work: () => Promise<T>): Promise<T> => {
      const start = nowMs()
      try {
        return await work()
      } finally {
        timings.push([label, nowMs() - start])
      }
    }
    const project = await timeAsyncStep('read', () => readLocalProjectAsync(projectId))
    if (!project) return null
    clearActiveWorkbenchProjectSaveTarget()
    const mediaUpgraded = await timeAsyncStep('media', () => upgradeWorkbenchProjectMediaUrls(project))
    const { record: catUpgraded, diagnostic } = timeStep('category', () => migrateProjectRecord(mediaUpgraded))
    const { record: v60Upgraded } = timeStep('v60', () => migrateProjectV51ToV60(catUpgraded))
    // A1.5：历史导入/切图/裁剪/截图的 image 节点改判为 asset（素材卡）。
    const upgraded = timeStep('assets', () => normalizeLegacyImageAssetKinds(v60Upgraded))
    const changed = upgraded !== project
    if (!diagnostic.alreadyMigrated && (diagnostic.migratedNodes > 0 || diagnostic.removedNodes > 0 || diagnostic.categoriesSeeded)) {
      lastCategoryMigrationDiagnostic = diagnostic
    }
    timeStep('restore-workbench', () => restoreWorkbenchProjectState(upgraded.payload))
    timeStep('restore-generation', () => restoreGenerationCanvasState(upgraded.payload))
    const restoredPersistMarker = timeStep('marker', () => readCurrentWorkbenchPersistMarker())
    timeStep('last-active', () => writeLastActiveProjectIdSoon(upgraded.id))
    logHydrateTiming(upgraded.id, timings)
    schedulePostStartupBackgroundWork(() => {
      if (sequence !== hydrateSequence) return
      void (async () => {
        if (changed) {
          await saveLocalProjectAsync(upgraded.id, readCurrentWorkbenchProjectPayload(), upgraded.name, upgraded)
          if (sequence !== hydrateSequence) return
        }

        const desktop = getDesktopBridge()
        if (!desktop) return
        const { record: localized, stats } = await localizeWorkbenchProjectDataUrls(upgraded, {
          desktop,
          projectId: upgraded.id,
          maxItems: DATA_URL_LOCALIZE_BATCH_SIZE,
        })
        if (sequence !== hydrateSequence) return
        if (stats.localized === 0) {
          if (stats.errors > 0) {
            logBackgroundMigration(upgraded.id, `data URL localization skipped (${stats.errors} errors)`)
          }
          return
        }
        const markerUnchanged = readCurrentWorkbenchPersistMarker() === restoredPersistMarker
        if (markerUnchanged) {
          restoreWorkbenchProjectPayload(localized.payload)
        }
        await saveLocalProjectAsync(
          localized.id,
          markerUnchanged ? localized.payload : readCurrentWorkbenchProjectPayload(),
          localized.name,
          localized,
        )
        const suffix = stats.skipped > 0 ? `, ${stats.skipped} remaining` : ''
        logBackgroundMigration(localized.id, `localized ${stats.localized} embedded data URLs${suffix}`)
      })().catch((error: unknown) => {
        if (sequence !== hydrateSequence) return
        deps.onSaveError(error)
      })
    })
    return upgraded
  }

  const hydrateInitialProject = async (): Promise<WorkbenchProjectRecordV1 | null> => {
    const explicitProjectId = readWindowSearchParam('projectId')
    if (!explicitProjectId) return null
    return hydrateProject(explicitProjectId)
  }

  return {
    hydrateProject,
    hydrateInitialProject,
    persistProject,
    bindProjectPersistence,
  }
}
