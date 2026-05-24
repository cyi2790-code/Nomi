import { getDesktopActiveProjectId } from '../../desktop/activeProject'
import { getDesktopBridge, type DesktopBridge } from '../../desktop/bridge'

export type TaskKind =
  | 'chat'
  | 'prompt_refine'
  | 'text_to_image'
  | 'image_to_prompt'
  | 'image_to_video'
  | 'text_to_video'
  | 'image_edit'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type TaskAssetDto = {
  type: 'image' | 'video'
  url: string
  thumbnailUrl?: string | null
  assetId?: string | null
  assetRefId?: string | null
  assetName?: string | null
}

export type TaskResultDto = {
  id: string
  kind: TaskKind
  status: TaskStatus
  assets: TaskAssetDto[]
  raw: unknown
  /**
   * E11: Complete provenance for reproducibility. Populated by the electron
   * runtime on successful generation. Renderer copies into
   * GenerationNodeResult.provenance via extractProvenanceFromTaskResult.
   */
  provenance?: {
    provider?: string
    modelKey?: string
    modelVersion?: string
    prompt?: string
    negativePrompt?: string
    seed?: number
    params?: Record<string, unknown>
    vendorRequestId?: string
    cost?: { amount: number; currency: string; unit: 'estimate' }
    timestamp: number
    agentRunId?: string
  }
}

export type TaskRequestDto = {
  kind: TaskKind
  prompt: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  extras?: Record<string, unknown>
}

export type FetchWorkbenchTaskResultRequestDto = {
  taskId: string
  vendor?: string
  taskKind?: TaskKind
  prompt?: string | null
  modelKey?: string | null
}

export type FetchWorkbenchTaskResultResponseDto = {
  vendor: string
  result: TaskResultDto
}

function requireDesktopRuntime(feature: string): DesktopBridge {
  const desktop = getDesktopBridge()
  if (!desktop) throw new Error(`${feature} requires the Electron desktop runtime`)
  return desktop
}

export async function runWorkbenchTaskByVendor(vendor: string, request: TaskRequestDto): Promise<TaskResultDto> {
  const normalizedVendor = String(vendor || '').trim()
  if (!normalizedVendor) throw new Error('vendor is required')
  const desktop = requireDesktopRuntime('task execution')
  const projectId = getDesktopActiveProjectId()
  return desktop.tasks.run({
    vendor: normalizedVendor,
    request: {
      ...request,
      extras: {
        ...(request.extras || {}),
        ...(projectId ? { projectId } : {}),
      },
    },
  }) as Promise<TaskResultDto>
}

export async function fetchWorkbenchTaskResultByVendor(
  payload: FetchWorkbenchTaskResultRequestDto,
): Promise<FetchWorkbenchTaskResultResponseDto> {
  return requireDesktopRuntime('task result polling').tasks.result(payload) as Promise<FetchWorkbenchTaskResultResponseDto>
}
