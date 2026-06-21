import { describe, expect, it } from 'vitest'
import { localizeWorkbenchProjectDataUrls, normalizeLegacyImageAssetKinds, upgradeWorkbenchProjectMediaUrls } from './projectMediaMigration'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'
import type { DesktopBridge } from '../../desktop/bridge'

function makeNode(overrides: Partial<GenerationCanvasNode> & { id: string }): GenerationCanvasNode {
  return {
    id: overrides.id,
    kind: overrides.kind || 'image',
    title: overrides.title || 'Node',
    prompt: overrides.prompt ?? '',
    position: overrides.position || { x: 0, y: 0 },
    result: overrides.result,
    history: overrides.history,
    meta: overrides.meta,
  } as GenerationCanvasNode
}

function makeRecord(nodes: GenerationCanvasNode[]): WorkbenchProjectRecordV1 {
  const payload = createDefaultWorkbenchProjectPayload()
  return {
    id: 'p1',
    name: 'Test',
    payload: {
      ...payload,
      generationCanvas: { ...payload.generationCanvas, nodes },
    },
  } as WorkbenchProjectRecordV1
}

function kindsOf(record: WorkbenchProjectRecordV1): string[] {
  return record.payload.generationCanvas.nodes.map((n) => n.kind)
}

describe('normalizeLegacyImageAssetKinds', () => {
  it('converts imported / file-tree / local-edit image nodes to asset', () => {
    const record = makeRecord([
      makeNode({ id: 'import', kind: 'image', meta: { source: 'local-drop', localOnly: true } }),
      makeNode({ id: 'uploaded', kind: 'image', meta: { source: 'asset-upload' } }),
      makeNode({ id: 'workspace', kind: 'image', meta: { source: 'workspace-file' } }),
      makeNode({ id: 'crop', kind: 'image', meta: { source: 'image-crop', localOnly: true } }),
      makeNode({ id: 'rotate', kind: 'image', meta: { source: 'image-rotate-left', localOnly: true } }),
      makeNode({ id: 'flip', kind: 'image', meta: { source: 'image-flip-h', localOnly: true } }),
      makeNode({ id: 'grid', kind: 'image', meta: { source: 'image-grid-split-2x2', localOnly: true } }),
      makeNode({ id: 'pano-shot', kind: 'image', meta: { source: 'panorama-screenshot', localOnly: true } }),
      makeNode({ id: 'localonly', kind: 'image', meta: { localOnly: true } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(Array(9).fill('asset'))
  })

  it('keeps real generated image nodes as image', () => {
    const record = makeRecord([
      // 真生成图：带 provenance —— 即便 source/localOnly 看着像素材也不动。
      makeNode({
        id: 'generated',
        kind: 'image',
        result: { id: 'r', type: 'image', url: 'x', createdAt: 1, provenance: { model: 'm' } } as GenerationCanvasNode['result'],
        meta: { source: 'image-crop', localOnly: true },
      }),
      // 无素材特征的 image（纯生成节点，无 meta.source / 非 localOnly）。
      makeNode({ id: 'plain', kind: 'image' }),
      makeNode({ id: 'authored', kind: 'image', meta: { source: 'generation' } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(['image', 'image', 'image'])
  })

  it('does not touch non-image kinds', () => {
    const record = makeRecord([
      makeNode({ id: 'char', kind: 'character', meta: { localOnly: true } }),
      makeNode({ id: 'vid', kind: 'video', meta: { source: 'local-drop' } }),
    ])
    const out = normalizeLegacyImageAssetKinds(record)
    expect(kindsOf(out)).toEqual(['character', 'video'])
  })

  it('returns the same record reference when nothing changes', () => {
    const record = makeRecord([makeNode({ id: 'plain', kind: 'image' })])
    expect(normalizeLegacyImageAssetKinds(record)).toBe(record)
  })
})

describe('upgradeWorkbenchProjectMediaUrls', () => {
  it('returns the same record reference when no blob urls are present', async () => {
    const record = makeRecord([
      makeNode({
        id: 'plain-url',
        kind: 'image',
        result: { id: 'r', type: 'image', url: 'https://example.test/a.png', createdAt: 1 } as GenerationCanvasNode['result'],
        history: [{ id: 'h', type: 'image', thumbnailUrl: 'data:image/png;base64,abc', createdAt: 2 }] as GenerationCanvasNode['history'],
      }),
    ])
    const out = await upgradeWorkbenchProjectMediaUrls(record, {
      fetchBlob: async () => {
        throw new Error('fetchBlob should not be called without blob urls')
      },
    })
    expect(out).toBe(record)
  })
})

describe('localizeWorkbenchProjectDataUrls', () => {
  function makeDesktop(importedUrls: string[]): DesktopBridge {
    let index = 0
    return {
      platform: 'test',
      workspace: {} as DesktopBridge['workspace'],
      projects: {} as DesktopBridge['projects'],
      assets: {
        list: async () => ({ items: [], cursor: null }),
        importFile: async () => ({ id: 'file', name: 'file', userId: 'local', projectId: 'p1', createdAt: '', updatedAt: '', data: {} }),
        importRemoteUrl: async () => ({
          id: `asset-${index}`,
          name: `asset-${index}`,
          userId: 'local',
          projectId: 'p1',
          createdAt: '',
          updatedAt: '',
          data: { url: importedUrls[index++] || `nomi-local://asset/p1/${index}.png` },
        }),
      },
      exports: {} as DesktopBridge['exports'],
      tasks: {} as DesktopBridge['tasks'],
      agents: {} as DesktopBridge['agents'],
      onboarding: {} as DesktopBridge['onboarding'],
      modelCatalog: {} as DesktopBridge['modelCatalog'],
    }
  }

  it('returns the same record reference when no embedded data media urls exist', async () => {
    const record = makeRecord([
      makeNode({
        id: 'plain-url',
        result: { id: 'r', type: 'image', url: 'nomi-local://asset/p1/a.png', createdAt: 1 } as GenerationCanvasNode['result'],
      }),
    ])
    const desktop = makeDesktop([])
    const out = await localizeWorkbenchProjectDataUrls(record, { desktop, projectId: 'p1' })
    expect(out.record).toBe(record)
    expect(out.stats).toEqual({ localized: 0, skipped: 0, errors: 0 })
  })

  it('localizes embedded data media urls up to maxItems', async () => {
    const record = makeRecord([
      makeNode({
        id: 'n1',
        result: { id: 'r1', type: 'image', url: 'data:image/png;base64,aaa', createdAt: 1 } as GenerationCanvasNode['result'],
        history: [
          { id: 'h1', type: 'image', url: 'data:image/png;base64,bbb', createdAt: 2 },
          { id: 'h2', type: 'image', url: 'data:image/png;base64,ccc', createdAt: 3 },
        ] as GenerationCanvasNode['history'],
      }),
    ])
    const desktop = makeDesktop([
      'nomi-local://asset/p1/r1.png',
      'nomi-local://asset/p1/h1.png',
    ])

    const out = await localizeWorkbenchProjectDataUrls(record, { desktop, projectId: 'p1', maxItems: 2 })
    const [node] = out.record.payload.generationCanvas.nodes
    expect(out.record).not.toBe(record)
    expect(out.stats).toEqual({ localized: 2, skipped: 1, errors: 0 })
    expect(node.result?.url).toBe('nomi-local://asset/p1/r1.png')
    expect(node.history?.[0]?.url).toBe('nomi-local://asset/p1/h1.png')
    expect(node.history?.[1]?.url).toBe('data:image/png;base64,ccc')
  })
})
