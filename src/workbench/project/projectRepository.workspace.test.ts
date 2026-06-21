import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalProject, listLocalProjectsAsync, readLocalProject, saveLocalProjectAsync } from './projectRepository'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import { getDesktopBridge } from '../../desktop/bridge'

vi.mock('../../desktop/bridge', () => ({
  getDesktopBridge: vi.fn(),
}))

const mockedGetDesktopBridge = vi.mocked(getDesktopBridge)

describe('projectRepository workspace project creation', () => {
  beforeEach(() => {
    mockedGetDesktopBridge.mockReset()
  })

  it('desktop createLocalProject does not pass arbitrary rootPath through projects.create', () => {
    const create = vi.fn((record: unknown) => ({ ...(record as object), id: 'desktop-id' }))
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { create } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    createLocalProject('Desktop Project', undefined, { rootPath: '/Users/me/Work/Nomi Project' })

    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ rootPath: expect.any(String) }))
  })

  it('browser fallback still creates local project without rootPath', () => {
    mockedGetDesktopBridge.mockReturnValue(null)

    const record = createLocalProject('Browser Project')

    expect(record).toMatchObject({ name: 'Browser Project', version: 1 })
    expect('rootPath' in record).toBe(false)
  })

  it('reads a workspace manifest record (version 2, nested payload) without throwing', () => {
    // Regression: the workspace folder migration writes version:2 manifests
    // (.nomi/project.json) with a nested payload + lastKnownRootPath. The
    // renderer previously only accepted version:1 and mis-routed v2 records
    // through the legacy normalizer, throwing "payload 缺少必要字段".
    const v2Record = {
      id: 'ws-1',
      name: 'Workspace Project',
      version: 2,
      createdAt: 1,
      updatedAt: 2,
      savedAt: 2,
      revision: 9,
      lastKnownRootPath: '/Users/me/Work/Nomi Project',
      payload: {
        workbenchDocument: {
          version: 1,
          title: '',
          contentJson: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
          updatedAt: 1,
        },
        timeline: {
          version: 1,
          fps: 30,
          scale: 1,
          playheadFrame: 0,
          tracks: [
            { id: 'imageTrack', type: 'image', label: '图片轨', clips: [] },
            { id: 'videoTrack', type: 'video', label: '媒体轨', clips: [] },
          ],
        },
        generationCanvas: { nodes: [], edges: [], selectedNodeIds: [], groups: [] },
        categories: [],
      },
    }
    const read = vi.fn(() => v2Record)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { read } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const record = readLocalProject('ws-1')

    expect(record).toMatchObject({ id: 'ws-1', name: 'Workspace Project', version: 1 })
    expect(record?.payload.workbenchDocument.version).toBe(1)
    expect(record?.payload.timeline.tracks).toHaveLength(2)
  })

  it('opens a freshly-initialized workspace (minimal payload) as an empty default project', () => {
    // Regression: "打开文件夹" on an existing folder writes a minimal manifest
    // payload (just { rootPath }) with no workbenchDocument/timeline/canvas.
    // The renderer used to throw "本地项目记录损坏" → hydrate rejected silently
    // → the project card "打不开". It must now open as an empty project.
    const emptyManifest = {
      id: 'ws-music',
      name: 'Music',
      version: 2,
      createdAt: 1,
      updatedAt: 1,
      savedAt: 1,
      revision: 0,
      lastKnownRootPath: '/Users/me/Music',
      payload: { rootPath: '/Users/me/Music' },
    }
    const read = vi.fn(() => emptyManifest)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { read } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const record = readLocalProject('ws-music')

    expect(record).toMatchObject({ id: 'ws-music', name: 'Music', version: 1 })
    expect(record?.payload.workbenchDocument.version).toBe(1)
    expect(record?.payload.timeline.tracks.length).toBeGreaterThan(0)
    expect(Array.isArray(record?.payload.generationCanvas.nodes)).toBe(true)
  })

  it('desktop listLocalProjectsAsync uses async project listing when available', async () => {
    const list = vi.fn(() => {
      throw new Error('sync project list should not be called')
    })
    const listAsync = vi.fn(async () => [
      {
        id: 'ws-list',
        name: 'Async Workspace',
        createdAt: 10,
        updatedAt: 30,
      },
    ])
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: { list, listAsync } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const projects = await listLocalProjectsAsync()

    expect(list).not.toHaveBeenCalled()
    expect(listAsync).toHaveBeenCalledTimes(1)
    expect(projects).toEqual([expect.objectContaining({ id: 'ws-list', name: 'Async Workspace' })])
  })

  it('desktop saveLocalProjectAsync uses the provided summary without reading the full old project', async () => {
    const payload = createDefaultWorkbenchProjectPayload()
    const readAsync = vi.fn(async () => {
      throw new Error('readAsync should not be called when a base summary is provided')
    })
    const saveAsync = vi.fn(async (_projectId: string, record: unknown) => record)
    mockedGetDesktopBridge.mockReturnValue({
      platform: 'darwin',
      workspace: {} as never,
      projects: {
        read: vi.fn(),
        readAsync,
        saveAsync,
      } as never,
      cost: {} as never,
      assets: {} as never,
      exports: {} as never,
      tasks: {} as never,
      agents: {} as never,
      modelCatalog: {} as never,
    })

    const saved = await saveLocalProjectAsync('ws-fast-save', payload, 'Fast Save', {
      id: 'ws-fast-save',
      name: 'Fast Save',
      createdAt: 10,
      updatedAt: 20,
      revision: 7,
      savedAt: 20,
    })

    expect(readAsync).not.toHaveBeenCalled()
    expect(saveAsync).toHaveBeenCalledTimes(1)
    expect(saved).toMatchObject({
      id: 'ws-fast-save',
      name: 'Fast Save',
      createdAt: 10,
      revision: 8,
      payload,
    })
  })
})
