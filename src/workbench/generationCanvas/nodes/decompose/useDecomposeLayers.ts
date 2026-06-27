// 「元素拆解」交互编排（从工具条抽出，别喂巨壳 R9）。
// 付费确认 → 调 decompose IPC 拿 N 张远端图层 → 逐张落地成 nomi-local（同 removeBackground）→
// 组装白板态。工具条据 decomposeState 打开 WhiteboardModal(sourceKind:'image')，关闭时白板现成的
// 「截图合成回主图」完成闭环。
import React from 'react'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { WhiteboardState } from '../whiteboard/whiteboardTypes'
import { inferWhiteboardAspectRatio } from '../whiteboard/whiteboardState'
import { buildLayerWhiteboardState } from './buildLayerWhiteboard'
import { confirmAndMintGrant, describeGenerationCost } from '../../spend/spendConfirm'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { persistNodeImageFile } from '../../adapters/persistNodeImage'
import { toast } from '../../../../ui/toast'

const DECOMPOSE_LAYERS = 6

export type DecomposeLayersController = {
  decomposeBusy: boolean
  decomposeState: WhiteboardState | null
  runDecompose: () => Promise<void>
  clearDecompose: () => void
}

export function useDecomposeLayers(node: GenerationCanvasNode, imageUrl: string): DecomposeLayersController {
  const [decomposeBusy, setDecomposeBusy] = React.useState(false)
  const [decomposeState, setDecomposeState] = React.useState<WhiteboardState | null>(null)

  const runDecompose = React.useCallback(async () => {
    if (!imageUrl || decomposeBusy) return
    const grantId = await confirmAndMintGrant({
      nodeIds: [node.id],
      title: '拆解元素',
      message: `${describeGenerationCost(1, 'image')}（把这张图拆成可独立编辑的图层）`,
      confirmLabel: '拆解',
      light: true,
    })
    if (!grantId) return
    setDecomposeBusy(true)
    toast('拆解中…约 15 秒', 'info')
    try {
      const bridge = getDesktopBridge()
      if (!bridge) throw new Error('桌面端不可用')
      const { layers } = await bridge.image.decomposeLayers({ nodeId: node.id, imageUrl, numLayers: DECOMPOSE_LAYERS, grantId })
      if (!layers || layers.length === 0) throw new Error('拆解未返回图层')
      // 远端图层（临时直链）逐张落地成 nomi-local（同 removeBackground 落盘套路）。
      const localUrls = await Promise.all(layers.map(async (url, index) => {
        try {
          const resp = await fetch(url)
          const blob = await resp.blob()
          const file = new File([blob], `decompose-${node.id}-${index}.png`, { type: 'image/png' })
          return (await persistNodeImageFile(file, node.id)) || url
        } catch {
          return url
        }
      }))
      const ratio = inferWhiteboardAspectRatio(node.meta?.imageWidth, node.meta?.imageHeight)
      setDecomposeState(buildLayerWhiteboardState(localUrls, ratio))
      toast('已拆成图层，拖动元素后关闭画板即合成回图', 'success')
    } catch (error) {
      toast(error instanceof Error && error.message ? error.message : '拆解失败，请稍后重试', 'error')
    } finally {
      setDecomposeBusy(false)
    }
  }, [decomposeBusy, imageUrl, node])

  const clearDecompose = React.useCallback(() => setDecomposeState(null), [])

  return { decomposeBusy, decomposeState, runDecompose, clearDecompose }
}
