import React from 'react'
import useSWR, { mutate } from 'swr'
import {
  listLocalProjectSummariesAsync,
  listLocalProjectSummaries,
} from '../project/projectSummaryRepository'
import type {
  WorkbenchProjectRecordV1 as LocalProjectRecord,
  WorkbenchProjectSummary as LocalProjectSummary,
} from '../project/projectRecordSchema'
import type { GenerationCanvasSnapshot } from '../generationCanvasV2/model/generationCanvasTypes'
import type { TimelineState } from '../timeline/timelineTypes'
import type { WorkbenchDocument } from '../workbenchTypes'
import { markStartupProbe } from '../../utils/startupDiagnostics'

const LOCAL_PROJECTS_SWR_KEY = 'nomi:local-projects:v1'

function toProjectSummary(record: LocalProjectRecord): LocalProjectSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    revision: record.revision,
    savedAt: record.savedAt,
    thumbStyle: record.thumbStyle,
    thumbnail: record.thumbnail,
    thumbnailUrls: record.thumbnailUrls,
  }
}

function sortProjectSummaries(items: LocalProjectSummary[]): LocalProjectSummary[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

function publishLocalProjectRecord(record: LocalProjectRecord): void {
  const summary = toProjectSummary(record)
  void mutate<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    (current) => {
      const items = Array.isArray(current) ? current : []
      const index = items.findIndex((project) => project.id === summary.id)
      if (index < 0) return sortProjectSummaries([summary, ...items])
      const next = [...items]
      next[index] = summary
      return sortProjectSummaries(next)
    },
    { revalidate: false },
  )
}

function unpublishLocalProject(projectId: string): void {
  void mutate<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    (current) => {
      const items = Array.isArray(current) ? current : []
      return items.filter((project) => project.id !== projectId)
    },
    { revalidate: false },
  )
}

export function listLocalProjects(): LocalProjectSummary[] {
  return listLocalProjectSummaries()
}

export function listLocalProjectsAsync(): Promise<LocalProjectSummary[]> {
  return listLocalProjectSummariesAsync()
}

export function useLocalProjects(): {
  projects: LocalProjectSummary[]
  refreshProjects: () => void
} {
  const { data, mutate: mutateProjects } = useSWR<LocalProjectSummary[]>(
    LOCAL_PROJECTS_SWR_KEY,
    async () => {
      const projects = await listLocalProjectSummariesAsync()
      markStartupProbe('library-projects-ready', { count: projects.length })
      return projects
    },
    {
      fallbackData: [],
      revalidateOnMount: true,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )
  const refreshProjects = React.useCallback(() => {
    void mutateProjects(listLocalProjectSummariesAsync(), { revalidate: false })
  }, [mutateProjects])
  return {
    projects: data ?? [],
    refreshProjects,
  }
}

export function createLocalProject(name?: string, templateId?: string, options: { rootPath?: string } = {}): LocalProjectRecord {
  throw new Error('createLocalProject is async-only; use createLocalProjectAsync')
}

export async function createLocalProjectAsync(
  name?: string,
  templateId?: string,
  options: { rootPath?: string } = {},
): Promise<LocalProjectRecord> {
  const { createLocalProject: createProjectRecord } = await import('../project/projectRepository')
  const record = createProjectRecord(name, templateId, options)
  publishLocalProjectRecord(record)
  return record
}

export async function readLocalProjectAsync(projectId: string): Promise<LocalProjectRecord | null> {
  const { readLocalProjectAsync: readProjectRecordAsync } = await import('../project/projectRepository')
  return readProjectRecordAsync(projectId)
}

export function saveLocalProject(
  projectId: string,
  state: {
    workbenchDocument: WorkbenchDocument
    timeline: TimelineState
    generationCanvas: GenerationCanvasSnapshot
  },
  name?: string,
): LocalProjectRecord {
  throw new Error('saveLocalProject is async-only; use saveLocalProjectAsync')
}

export async function saveLocalProjectAsync(
  projectId: string,
  state: {
    workbenchDocument: WorkbenchDocument
    timeline: TimelineState
    generationCanvas: GenerationCanvasSnapshot
  },
  name?: string,
  baseSummary?: LocalProjectSummary,
): Promise<LocalProjectRecord> {
  const { saveLocalProjectAsync: saveProjectRecordAsync } = await import('../project/projectRepository')
  const record = await saveProjectRecordAsync(projectId, state, name, baseSummary)
  publishLocalProjectRecord(record)
  return record
}

export async function deleteLocalProject(projectId: string): Promise<void> {
  const { deleteLocalProject: deleteProjectRecord } = await import('../project/projectRepository')
  deleteProjectRecord(projectId)
  unpublishLocalProject(projectId)
}

export type {
  LocalProjectRecord,
  LocalProjectSummary,
}
