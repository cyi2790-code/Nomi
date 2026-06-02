import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { persistActiveWorkbenchProjectNow } from '../../project/workbenchProjectSession'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { generationNodeExecutor, type GenerationNodeExecutor } from './generationNodeExecutor'
import { resolveGenerationReferences } from './generationReferenceResolver'

export type RunGenerationNodeOptions = {
  executor?: GenerationNodeExecutor
  retry?: {
    maxAttempts?: number
    baseDelayMs?: number
  }
}

type GenerationRunContext = {
  nodes?: GenerationCanvasNode[]
  edges?: GenerationCanvasEdge[]
}

type RetryableGenerationError = Error & {
  status?: number
  code?: unknown
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 350

function isRetryableGenerationError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  if (!(error instanceof Error)) return false
  const candidate = error as RetryableGenerationError
  if (typeof candidate.status === 'number') {
    return candidate.status === 408 || candidate.status === 409 || candidate.status === 425 || candidate.status === 429 || candidate.status >= 500
  }
  const message = candidate.message.trim().toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('socket') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable') ||
    message.includes('rate limit')
  )
}

function normalizeRetryAttempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_MAX_ATTEMPTS
  return Math.max(1, Math.min(5, Math.floor(value)))
}

function normalizeBaseDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_BASE_DELAY_MS
  return Math.max(0, Math.min(3_000, Math.floor(value)))
}

async function waitForRetry(attempt: number, baseDelayMs: number): Promise<void> {
  if (baseDelayMs <= 0) return
  await new Promise((resolve) => globalThis.setTimeout(resolve, baseDelayMs * 2 ** Math.max(0, attempt - 1)))
}

export async function runGenerationNode(
  nodeId: string,
  options: RunGenerationNodeOptions = {},
): Promise<GenerationNodeResult> {
  const id = String(nodeId || '').trim()
  if (!id) throw new Error('nodeId is required')

  const initialState = useGenerationCanvasStore.getState()
  const initialNode = initialState.nodes.find((node) => node.id === id)
  if (!initialNode) throw new Error('node not found')
  if (!canRunGenerationNode(initialNode, { nodes: initialState.nodes, edges: initialState.edges })) {
    throw new Error(initialNode.kind === 'video'
      ? '视频节点缺少上游真实图片或视频资产 URL。请先生成或选择首帧/参考图后再生成视频。'
      : `暂不支持「${initialNode.kind}」类型节点的生成`)
  }

  const run = initialState.appendNodeRun(id, {
    status: 'queued',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  })
  useGenerationCanvasStore.getState().setNodeProgress(id, {
    runId: run.id,
    phase: 'queued',
    message: '准备生成',
    percent: 0,
  })

  try {
    const executor = options.executor ?? generationNodeExecutor
    const maxAttempts = normalizeRetryAttempts(options.retry?.maxAttempts)
    const baseDelayMs = normalizeBaseDelayMs(options.retry?.baseDelayMs)
    let result: GenerationNodeResult | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const state = useGenerationCanvasStore.getState()
      const node = state.nodes.find((candidate) => candidate.id === id) || initialNode
      try {
        result = await executor(node, {
          nodes: state.nodes,
          edges: state.edges,
        })
        break
      } catch (error: unknown) {
        if (attempt >= maxAttempts || !isRetryableGenerationError(error)) {
          throw error
        }
        useGenerationCanvasStore.getState().setNodeProgress(id, {
          runId: run.id,
          phase: 'retrying-fetch',
          message: `正在重试 (${attempt + 1}/${maxAttempts})`,
          percent: Math.min(90, attempt * 10),
        })
        await waitForRetry(attempt, baseDelayMs)
      }
    }
    if (!result) throw new Error('生成失败')
    useGenerationCanvasStore.getState().addNodeResult(id, result)
    await persistActiveWorkbenchProjectNow().catch(() => {})
    return result
  } catch (error: unknown) {
    const rawMessage = error instanceof Error && error.message ? error.message : '生成失败'
    // v0.7.5: 错误信息友好化 — 给常见 API 错误加 hint
    const friendlyMessage = enrichGenerationError(rawMessage)
    useGenerationCanvasStore.getState().setNodeStatus(id, 'error', friendlyMessage)
    throw error
  }
}

/**
 * 把底层 API 错误转成用户能行动的文案。
 * 常见情况：API key 缺失/无效、模型未配置、配额耗尽、网络问题、超时。
 */
function enrichGenerationError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('401')) {
    return `${message}\n→ 请在「模型接入」页检查 API Key`
  }
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429') || lower.includes('insufficient')) {
    return `${message}\n→ 服务商配额或限流，请稍后重试或更换模型`
  }
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('network')) {
    return `${message}\n→ 网络问题，请检查网络后重试`
  }
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('未找到') || lower.includes('not configured'))) {
    return `${message}\n→ 模型未配置，请去「模型接入」页设置`
  }
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('safety') || lower.includes('filter'))) {
    return `${message}\n→ 提示词被安全策略拦截，请修改后重试`
  }
  return message
}

export type RunGenerationNodesBatchOptions = RunGenerationNodeOptions & {
  /** Maximum concurrent runs. Defaults to 2 so two nodes can execute in parallel without overwhelming the provider. */
  concurrency?: number
  /** Called whenever a node finishes (success or failure) so the UI can update progress. */
  onNodeResult?: (event:
    | { ok: true; nodeId: string; result: GenerationNodeResult }
    | { ok: false; nodeId: string; error: Error }
  ) => void
}

export type RunGenerationNodesBatchResult = {
  totalCount: number
  successes: Array<{ nodeId: string; result: GenerationNodeResult }>
  failures: Array<{ nodeId: string; error: Error }>
}

function normalizeConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 2
  return Math.max(1, Math.min(4, Math.floor(value)))
}

/**
 * Run a batch of generation nodes with bounded concurrency. Each node
 * goes through the same retry/failure semantics as `runGenerationNode`,
 * so callers can still display a per-node retry button if a run fails.
 * This is the runtime used by the storyboard demo's "全部生成" action.
 */
export async function runGenerationNodesBatch(
  nodeIds: readonly string[],
  options: RunGenerationNodesBatchOptions = {},
): Promise<RunGenerationNodesBatchResult> {
  const queue = nodeIds
    .map((value) => String(value || '').trim())
    .filter((value, index, array) => Boolean(value) && array.indexOf(value) === index)
  const concurrency = normalizeConcurrency(options.concurrency)
  const successes: RunGenerationNodesBatchResult['successes'] = []
  const failures: RunGenerationNodesBatchResult['failures'] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < queue.length) {
      const nextIndex = cursor
      cursor += 1
      const nodeId = queue[nextIndex]
      try {
        const result = await runGenerationNode(nodeId, {
          executor: options.executor,
          retry: options.retry,
        })
        successes.push({ nodeId, result })
        options.onNodeResult?.({ ok: true, nodeId, result })
      } catch (error: unknown) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        failures.push({ nodeId, error: normalizedError })
        options.onNodeResult?.({ ok: false, nodeId, error: normalizedError })
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
  await Promise.all(workers)
  return { totalCount: queue.length, successes, failures }
}

export async function rerunGenerationNodeAsNewNode(
  nodeId: string,
  options: RunGenerationNodeOptions = {},
): Promise<GenerationNodeResult> {
  const state = useGenerationCanvasStore.getState()
  const duplicatedNode = state.duplicateNodeForRegeneration(nodeId)
  if (!duplicatedNode) throw new Error('node not found')
  return runGenerationNode(duplicatedNode.id, options)
}

export function canRunGenerationNode(
  node: GenerationCanvasNode | Pick<GenerationCanvasNode, 'kind'> | null | undefined,
  context: GenerationRunContext = {},
): boolean {
  if (!node) return false
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'image') return true
  if (executionKind !== 'video') return false
  if (!('id' in node) || !node.id) return false
  const references = resolveGenerationReferences(node, context)
  return Boolean(
    references.firstFrameUrl ||
    references.lastFrameUrl ||
    references.referenceImages.length > 0,
  )
}
