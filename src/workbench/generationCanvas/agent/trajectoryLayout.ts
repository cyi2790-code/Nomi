import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

// 批量创建节点的紧凑网格（自 applyCanvasToolCall 迁入，语义不变）：
// 列数 = ceil(sqrt(n))，行列定距铺开，保证任意数量都紧凑不溢出视口。
const GRID_ORIGIN_X = 160
const GRID_ORIGIN_Y = 160
const GRID_STEP_X = 360
const GRID_STEP_Y = 260
export function gridPosition(index: number, total: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, total))))
  return {
    x: GRID_ORIGIN_X + (index % cols) * GRID_STEP_X,
    y: GRID_ORIGIN_Y + Math.floor(index / cols) * GRID_STEP_Y,
  }
}

/**
 * 轨迹分层布局（执行方案 T4，顺修审计 bug D「网格不避让已有节点」）。
 *
 * 层由 kind 纯函数推导（评审必改：来源显式定义）：
 *   character/scene → 0（参考列）；image → 1（关键帧列）；video → 2（视频列）。
 * 计划里凑不齐 ≥2 个不同层（单层拆镜/混入不可推导 kind）→ 退回紧凑网格。
 * 两种形态的原点都取**已有节点包围盒下方**的空区——新计划永远不压在旧内容上。
 */

const LAYER_COL_STEP_X = 420
const LAYER_ROW_STEP_Y = 320
const ORIGIN_X = 160
const ORIGIN_Y = 160
const CLEARANCE_Y = 80

type ExistingNodeLite = { kind: GenerationNodeKind; position?: { x: number; y: number } }

function layerForKind(kind: GenerationNodeKind): number | null {
  if (kind === 'character' || kind === 'scene') return 0
  if (kind === 'image') return 1
  if (kind === 'video') return 2
  return null
}

/** 原点：无已有节点用固定原点；有则落到全体包围盒下方（含节点默认高度 + 间距）。 */
export function trajectoryOrigin(existing: readonly ExistingNodeLite[]): { x: number; y: number } {
  let maxBottom = -Infinity
  for (const node of existing) {
    if (!node.position) continue
    const height = DEFAULT_NODE_SIZE[node.kind]?.height ?? 280
    maxBottom = Math.max(maxBottom, node.position.y + height)
  }
  if (!Number.isFinite(maxBottom)) return { x: ORIGIN_X, y: ORIGIN_Y }
  return { x: ORIGIN_X, y: Math.max(ORIGIN_Y, maxBottom + CLEARANCE_Y) }
}

/**
 * 为一批计划节点算坐标。返回数组与入参等长、同序。
 * 分层形态：列 = 层，层内按出现顺序竖排；网格形态：沿用 gridPosition（原点平移避让）。
 */
export function layoutPlannedNodes(
  plannedKinds: readonly GenerationNodeKind[],
  existing: readonly ExistingNodeLite[],
): Array<{ x: number; y: number }> {
  const origin = trajectoryOrigin(existing)
  const layers = plannedKinds.map(layerForKind)
  const distinctLayers = new Set(layers.filter((layer) => layer !== null))
  const layered = !layers.includes(null) && distinctLayers.size >= 2

  if (!layered) {
    return plannedKinds.map((_, index) => {
      const cell = gridPosition(index, plannedKinds.length)
      return { x: origin.x + (cell.x - GRID_ORIGIN_X), y: origin.y + (cell.y - GRID_ORIGIN_Y) }
    })
  }

  const rowByLayer = new Map<number, number>()
  return layers.map((layer) => {
    const column = layer as number
    const row = rowByLayer.get(column) ?? 0
    rowByLayer.set(column, row + 1)
    return { x: origin.x + column * LAYER_COL_STEP_X, y: origin.y + row * LAYER_ROW_STEP_Y }
  })
}
