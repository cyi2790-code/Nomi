import React from 'react'
import { IconCrop, IconFlipHorizontal, IconFlipVertical, IconGrid3x3, IconLayoutGrid, IconRotate2, IconRotateClockwise2 } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { IMAGE_TRANSFORM_LABEL, type ImageGridSize, type ImageTransformOp } from './useNodeImageEditing'

// 图片编辑浮动工具条（切图 / 裁剪 / 旋转翻转）从 BaseGenerationNode 抽出（A1.5 接缝）。
// 纯展示：状态与 handler 都来自 useNodeImageEditing。图片类与素材类节点共用同一条。

type Props = {
  splittingGridSize: ImageGridSize | null
  cropMode: boolean
  imageOpBusy: boolean
  onGridSplit: (gridSize: ImageGridSize) => void
  onCrop: () => void
  onTransform: (op: ImageTransformOp) => void
}

export default function NodeImageEditToolbar({
  splittingGridSize,
  cropMode,
  imageOpBusy,
  onGridSplit,
  onCrop,
  onTransform,
}: Props): JSX.Element {
  return (
    <div
      className={cn(
        'generation-canvas-v2-node__panorama-toolbar',
        'absolute left-1/2 bottom-[calc(100%+18px)] z-[12]',
        'inline-flex items-center gap-1 min-h-[44px] py-[5px] px-2',
        'border border-[rgba(18,24,38,0.08)] rounded-[14px]',
        'bg-white/[0.96] shadow-[0_12px_34px_rgba(18,24,38,0.14)]',
        '-translate-x-1/2 backdrop-blur-[12px]',
      )}
      role="toolbar"
      aria-label="图片切图操作"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        className={cn(
          'inline-flex items-center justify-center gap-[7px]',
          'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
          'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          'disabled:opacity-[0.45] disabled:cursor-wait',
        )}
        type="button"
        aria-label="四视图截图（2×2）"
        title="四视图截图（2×2）"
        disabled={splittingGridSize !== null}
        onClick={() => onGridSplit(2)}
      >
        <IconLayoutGrid size={16} stroke={1.8} />
        <span>四视图截图</span>
      </button>
      <button
        className={cn(
          'inline-flex items-center justify-center gap-[7px]',
          'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
          'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          'disabled:opacity-[0.45] disabled:cursor-wait',
        )}
        type="button"
        aria-label="九宫格截图（3×3）"
        title="九宫格截图（3×3）"
        disabled={splittingGridSize !== null}
        onClick={() => onGridSplit(3)}
      >
        <IconGrid3x3 size={16} stroke={1.8} />
        <span>九宫格截图</span>
      </button>
      <span className={cn('w-px h-[22px] bg-[rgba(18,24,38,0.1)]')} />
      <button
        className={cn(
          'inline-flex items-center justify-center gap-[7px]',
          'min-w-0 min-h-[34px] px-[11px] border-0 rounded-[9px]',
          'bg-transparent text-nomi-ink-80 font-[inherit] text-[13px] leading-none whitespace-nowrap cursor-pointer',
          'hover:bg-nomi-ink-05 hover:text-nomi-ink',
          'disabled:opacity-[0.45] disabled:cursor-wait',
        )}
        type="button"
        aria-label="裁剪图片"
        title="裁剪（裁出一个新节点，原图保留）"
        disabled={cropMode || splittingGridSize !== null}
        onClick={onCrop}
      >
        <IconCrop size={16} stroke={1.8} />
        <span>裁剪</span>
      </button>
      <span className={cn('w-px h-[22px] bg-[rgba(18,24,38,0.1)]')} />
      {([
        { op: 'rotate-left' as const, Icon: IconRotate2 },
        { op: 'rotate-right' as const, Icon: IconRotateClockwise2 },
        { op: 'flip-h' as const, Icon: IconFlipHorizontal },
        { op: 'flip-v' as const, Icon: IconFlipVertical },
      ]).map(({ op, Icon }) => (
        <button
          key={op}
          className={cn(
            'inline-flex items-center justify-center',
            'min-w-0 w-[34px] min-h-[34px] border-0 rounded-[9px]',
            'bg-transparent text-nomi-ink-80 cursor-pointer',
            'hover:bg-nomi-ink-05 hover:text-nomi-ink',
            'disabled:opacity-[0.45] disabled:cursor-wait',
          )}
          type="button"
          aria-label={IMAGE_TRANSFORM_LABEL[op]}
          title={`${IMAGE_TRANSFORM_LABEL[op]}（生成一个新节点，原图保留）`}
          disabled={imageOpBusy || cropMode || splittingGridSize !== null}
          onClick={() => onTransform(op)}
        >
          <Icon size={16} stroke={1.8} />
        </button>
      ))}
    </div>
  )
}
