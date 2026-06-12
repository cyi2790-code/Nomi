import { describe, expect, it } from 'vitest'
import { layoutPlannedNodes, trajectoryOrigin } from './trajectoryLayout'
import { DEFAULT_NODE_SIZE } from '../model/generationNodeKinds'
import type { GenerationNodeKind } from '../model/generationCanvasTypes'

const kinds = (list: string[]): GenerationNodeKind[] => list as GenerationNodeKind[]

describe('trajectoryLayout（T4：分层布局 + 避让已有节点）', () => {
  it('三层轨迹按列分层：参考列 < 关键帧列 < 视频列，层内竖排', () => {
    const planned = kinds(['character', 'scene', 'image', 'image', 'image', 'video', 'video', 'video'])
    const positions = layoutPlannedNodes(planned, [])
    const xs = positions.map((p) => p.x)
    // 三个不同列 x
    expect(new Set(xs).size).toBe(3)
    const [refX, kfX, videoX] = [xs[0], xs[2], xs[5]]
    expect(refX).toBeLessThan(kfX)
    expect(kfX).toBeLessThan(videoX)
    // 同层竖排不重叠（y 间距 ≥ 默认最大节点高 280）
    const kfYs = positions.slice(2, 5).map((p) => p.y)
    expect(new Set(kfYs).size).toBe(3)
    expect(Math.min(kfYs[1] - kfYs[0], kfYs[2] - kfYs[1])).toBeGreaterThanOrEqual(280)
    // 参考层第 1/2 个同列不同行
    expect(positions[0].x).toBe(positions[1].x)
    expect(positions[1].y).toBeGreaterThan(positions[0].y)
  })

  it('原点避让：新计划永远落在已有节点包围盒下方（修审计 bug D）', () => {
    const existing = [
      { kind: 'image' as GenerationNodeKind, position: { x: 546, y: 194 } },
      { kind: 'video' as GenerationNodeKind, position: { x: 200, y: 600 } },
    ]
    const origin = trajectoryOrigin(existing)
    const lowestBottom = 600 + DEFAULT_NODE_SIZE.video.height
    expect(origin.y).toBeGreaterThanOrEqual(lowestBottom + 80)

    const positions = layoutPlannedNodes(kinds(['character', 'image', 'video']), existing)
    for (const p of positions) expect(p.y).toBeGreaterThanOrEqual(origin.y)
  })

  it('单层计划退回紧凑网格（形状不变，原点平移避让）', () => {
    const planned = kinds(['image', 'image', 'image', 'image', 'image', 'image'])
    const clean = layoutPlannedNodes(planned, [])
    // 3 列 2 行（与 gridPosition 既有断言一致）
    expect(new Set(clean.map((p) => p.y)).size).toBe(2)
    expect(new Set(clean.map((p) => p.x)).size).toBe(3)

    const shifted = layoutPlannedNodes(planned, [
      { kind: 'image' as GenerationNodeKind, position: { x: 100, y: 1000 } },
    ])
    // 形状一致，只是整体下移
    const dy = shifted[0].y - clean[0].y
    expect(dy).toBeGreaterThan(0)
    shifted.forEach((p, i) => {
      expect(p.x).toBe(clean[i].x)
      expect(p.y).toBe(clean[i].y + dy)
    })
  })

  it('混入不可推导 kind（text）→ 整批退网格，不半层半网格', () => {
    const planned = kinds(['character', 'image', 'video', 'text'])
    const positions = layoutPlannedNodes(planned, [])
    // 网格形态：2 列 2 行（ceil(sqrt(4))=2）
    expect(new Set(positions.map((p) => p.x)).size).toBe(2)
    expect(new Set(positions.map((p) => p.y)).size).toBe(2)
  })
})
