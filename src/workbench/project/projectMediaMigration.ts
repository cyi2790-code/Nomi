import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'

type BlobLikeRecord = {
  url?: string
  thumbnailUrl?: string
}

function isBlobUrl(value: string | undefined): value is string {
  return typeof value === 'string' && value.startsWith('blob:')
}

async function blobUrlToDataUrl(url: string): Promise<string | null> {
  return blobUrlToDataUrlWithFetcher(url, async (input: string) => {
    try {
      const response = await fetch(input)
      if (!response.ok) return null
      return await response.blob()
    } catch {
      return null
    }
  })
}

async function blobUrlToDataUrlWithFetcher(
  url: string,
  fetchBlob: (input: string) => Promise<Blob | null>,
): Promise<string | null> {
  try {
    const blob = await fetchBlob(url)
    if (!blob) return null
    return await blobToDataUrl(blob)
  } catch {
    return null
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (result) resolve(result)
      else reject(new Error('failed to read blob data url'))
    }
    reader.onerror = () => reject(new Error('failed to read blob'))
    reader.readAsDataURL(blob)
  })
}

async function upgradeRecordUrlFields<T extends BlobLikeRecord>(
  input: T,
  fetchBlob?: (url: string) => Promise<Blob | null>,
): Promise<T> {
  let changed = false
  const next = { ...input }
  if (isBlobUrl(next.url)) {
    const converted = fetchBlob ? await blobUrlToDataUrlWithFetcher(next.url, fetchBlob) : await blobUrlToDataUrl(next.url)
    if (converted) {
      next.url = converted
      changed = true
    }
  }
  if (isBlobUrl(next.thumbnailUrl)) {
    const converted = fetchBlob ? await blobUrlToDataUrlWithFetcher(next.thumbnailUrl, fetchBlob) : await blobUrlToDataUrl(next.thumbnailUrl)
    if (converted) {
      next.thumbnailUrl = converted
      changed = true
    }
  }
  return changed ? next : input
}

export async function upgradeWorkbenchProjectMediaUrls(
  record: WorkbenchProjectRecordV1,
  options?: {
    fetchBlob?: (url: string) => Promise<Blob | null>
  },
): Promise<WorkbenchProjectRecordV1> {
  const fetchBlob = options?.fetchBlob
  const payload = record.payload
  const nextNodes = await Promise.all(payload.generationCanvas.nodes.map(async (node) => {
    let changed = false
    const nextNode = { ...node }
    if (nextNode.result && typeof nextNode.result === 'object') {
      const upgradedResult = await upgradeRecordUrlFields(nextNode.result, fetchBlob)
      if (upgradedResult !== nextNode.result) {
        changed = true
        nextNode.result = upgradedResult as typeof nextNode.result
      }
    }
    if (Array.isArray(nextNode.history) && nextNode.history.length) {
      const nextHistory = await Promise.all(nextNode.history.map(async (item) => upgradeRecordUrlFields(item, fetchBlob)))
      if (nextHistory.some((item, index) => item !== nextNode.history?.[index])) {
        changed = true
        nextNode.history = nextHistory as typeof nextNode.history
      }
    }
    return changed ? nextNode : node
  }))

  const nextTracks = await Promise.all(payload.timeline.tracks.map(async (track) => {
    let changed = false
    const nextTrack = { ...track }
    const nextClips = await Promise.all(track.clips.map(async (clip) => {
      if (!clip || typeof clip !== 'object') return clip
      const nextClip = { ...clip }
      const upgraded = await upgradeRecordUrlFields(nextClip as BlobLikeRecord, fetchBlob)
      if (upgraded !== nextClip) {
        changed = true
        return upgraded
      }
      return clip
    }))
    if (changed) {
      nextTrack.clips = nextClips as typeof track.clips
      return nextTrack
    }
    return track
  }))

  const nextGenerationCanvas = nextNodes.some((node, index) => node !== payload.generationCanvas.nodes[index])
    ? { ...payload.generationCanvas, nodes: nextNodes }
    : payload.generationCanvas
  const nextTimeline = nextTracks.some((track, index) => track !== payload.timeline.tracks[index])
    ? { ...payload.timeline, tracks: nextTracks }
    : payload.timeline

  if (nextGenerationCanvas === payload.generationCanvas && nextTimeline === payload.timeline) {
    return record
  }

  return {
    ...record,
    payload: {
      ...payload,
      generationCanvas: nextGenerationCanvas,
      timeline: nextTimeline,
    },
  }
}

// A1.5 step 5：老项目规整。历史上「导入图 / 文件树拖入 / 切图裁剪旋转 / 全景截图」都存成
// kind:'image'，与真生成图混在一起。新版这些都是 kind:'asset'（无 composer 的素材卡）。
// 这里在加载时把符合「素材特征」的老 image 节点改判为 asset；保守谓词避免误伤真生成节点。
const LEGACY_ASSET_SOURCE_TAGS = new Set<string>([
  'local-drop',
  'asset-upload',
  'workspace-file',
  'image-crop',
  'image-rotate-left',
  'image-rotate-right',
  'image-flip-h',
  'image-flip-v',
  'panorama-screenshot',
])

function isLegacyMaterialImageNode(node: WorkbenchProjectRecordV1['payload']['generationCanvas']['nodes'][number]): boolean {
  if (node.kind !== 'image') return false
  // 真生成图带 provenance —— 一定保留为生成节点，绝不转素材。
  if (node.result?.provenance) return false
  const meta = node.meta || {}
  if (meta.localOnly === true) return true
  const source = typeof meta.source === 'string' ? meta.source : ''
  if (!source) return false
  if (LEGACY_ASSET_SOURCE_TAGS.has(source)) return true
  return source.startsWith('image-grid-split-') || source.startsWith('panorama-')
}

export function normalizeLegacyImageAssetKinds(record: WorkbenchProjectRecordV1): WorkbenchProjectRecordV1 {
  const payload = record.payload
  let changed = false
  const nextNodes = payload.generationCanvas.nodes.map((node) => {
    if (!isLegacyMaterialImageNode(node)) return node
    changed = true
    return { ...node, kind: 'asset' as const }
  })
  if (!changed) return record
  return {
    ...record,
    payload: {
      ...payload,
      generationCanvas: { ...payload.generationCanvas, nodes: nextNodes },
    },
  }
}

export function assertWorkbenchProjectMediaUrlsPersistable(record: WorkbenchProjectRecordV1): void {
  const payload = record.payload
  for (const node of payload.generationCanvas.nodes) {
    if (isBlobUrl(node.result?.url)) {
      throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
    }
    for (const item of node.history || []) {
      if (isBlobUrl(item.url)) {
        throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
      }
    }
  }
  for (const track of payload.timeline.tracks) {
    for (const clip of track.clips) {
      if (isBlobUrl((clip as BlobLikeRecord).url)) {
        throw new Error(`本地项目记录包含不可持久化图片地址：${record.id}`)
      }
    }
  }
}
