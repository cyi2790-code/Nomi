import React from 'react'
import {
  IconHandStop,
  IconManFilled,
  IconPlayerPlayFilled,
  IconRun,
  IconArmchair,
  IconArrowBarToDown,
  IconX,
} from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { PanelButton, SceneAddToolbar } from './scene3dToolbar'
import { MANNEQUIN_POSE_PRESETS, type CrowdAddOptions } from './scene3dConstants'
import type { Scene3DGeometry, Scene3DObject } from './scene3dTypes'

type CharacterDriveApi = {
  possessId: string | null
  selectedMannequin: Scene3DObject | undefined
  enterPossess: (objectId: string) => void
  exitPossess: () => void
}

// 头部工具栏「操控」入口：选中单个假人时出现，进入/退出操控态。整块逻辑+可见性自闭合，
// 让 Scene3DFullscreen 壳只写一行接线（R9 防巨壳）。
export function CharacterPossessButton({ drive }: { drive: CharacterDriveApi }): JSX.Element | null {
  const possessing = Boolean(drive.possessId)
  if (!possessing && !drive.selectedMannequin) return null
  return (
    <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
      <PanelButton
        title={possessing ? '退出操控' : '操控该角色（WASD 走位 + 动作库）'}
        active={possessing}
        onClick={() => {
          if (possessing) drive.exitPossess()
          else if (drive.selectedMannequin) drive.enterPossess(drive.selectedMannequin.id)
        }}
      >
        <IconManFilled size={15} />
        <span>操控</span>
      </PanelButton>
    </div>
  )
}

// 动作库：动作名 → 现有静态姿势预设 key 的映射（不造新预设）。
// 某动作没有对应预设就不会进列表（诚实，见 ACTION_LIBRARY 过滤）。
const ACTION_DEFS: Array<{ label: string; presetId: string; icon: typeof IconManFilled }> = [
  { label: '待机', presetId: 'standing', icon: IconManFilled },
  { label: '行走', presetId: 'walk', icon: IconPlayerPlayFilled },
  { label: '奔跑', presetId: 'run', icon: IconRun },
  { label: '下蹲', presetId: 'squat', icon: IconArrowBarToDown },
  { label: '挥手', presetId: 'wave', icon: IconHandStop },
  { label: '坐下', presetId: 'sit', icon: IconArmchair },
]

const ACTION_LIBRARY = ACTION_DEFS.filter((action) =>
  MANNEQUIN_POSE_PRESETS.some((preset) => preset.id === action.presetId),
)

// 操控态底部动作库工具栏。点动作 → 把对应预设的 pose 应用到被操控假人。
// className 风格照搬 SceneAddToolbar 底部条。
export function CharacterActionBar({
  characterName,
  activePresetId,
  onApplyPreset,
  onExit,
}: {
  characterName: string
  activePresetId?: string
  onApplyPreset: (presetId: string) => void
  onExit: () => void
}): JSX.Element {
  return (
    <div
      className="absolute bottom-5 left-1/2 z-[5] max-w-[calc(100%-32px)] -translate-x-1/2"
      aria-label="角色操控动作库"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          'inline-flex max-w-full items-center gap-1 overflow-x-auto p-[6px]',
          'rounded-nomi border border-[var(--workbench-border)] bg-[var(--nomi-paper)] text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]',
        )}
        role="toolbar"
      >
        <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-nomi bg-[var(--nomi-ink)] px-2.5 text-caption text-[var(--nomi-paper)]" title="正在操控的角色">
          <IconManFilled size={15} />
          <span className="max-w-[120px] truncate">{characterName}</span>
        </span>
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        {ACTION_LIBRARY.map((action) => {
          const Icon = action.icon
          const active = activePresetId === action.presetId
          return (
            <button
              key={action.presetId}
              className={cn(
                'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
                'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
                'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
                active && 'bg-[var(--nomi-ink-05)] text-[var(--nomi-ink)]',
              )}
              type="button"
              title={`应用动作：${action.label}`}
              onClick={() => onApplyPreset(action.presetId)}
            >
              <Icon size={15} />
              <span>{action.label}</span>
            </button>
          )
        })}
        <span className="h-5 w-px shrink-0 bg-[var(--workbench-border)]" />
        <button
          className={cn(
            'inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-nomi px-2 whitespace-nowrap',
            'border-0 bg-transparent text-caption text-[var(--nomi-ink-60)] transition',
            'hover:bg-[var(--nomi-ink-05)] hover:text-[var(--nomi-ink)]',
          )}
          type="button"
          title="退出操控"
          onClick={onExit}
        >
          <IconX size={15} />
          <span>退出操控</span>
        </button>
      </div>
      <div className="mt-1.5 text-center text-micro text-[var(--nomi-ink-60)]">
        WASD 走位 · 自动面向 · 点动作切换姿势
      </div>
    </div>
  )
}

// 画布底部条：操控态显示动作库，否则显示原添加工具栏。把这层「显示哪个条」的判断从
// Scene3DFullscreen 壳里抽出（R9 防巨壳），壳只传 possessedObject + 两套回调。
export function Scene3DBottomBar({
  readOnly,
  possessedObject,
  activePresetId,
  onApplyPreset,
  onExitPossess,
  onAddObject,
  onAddCrowd,
  onAddCamera,
  trajectoryMode,
  onToggleTrajectoryMode,
  canvasFocusMode,
  onToggleCanvasFocusMode,
}: {
  readOnly: boolean
  possessedObject?: Scene3DObject
  activePresetId?: string
  onApplyPreset: (presetId: string) => void
  onExitPossess: () => void
  onAddObject: (kind: Scene3DGeometry | 'mannequin' | 'light') => void
  onAddCrowd: (options: CrowdAddOptions) => void
  onAddCamera: () => void
  trajectoryMode: boolean
  onToggleTrajectoryMode: () => void
  canvasFocusMode: boolean
  onToggleCanvasFocusMode: () => void
}): JSX.Element | null {
  if (possessedObject) {
    return (
      <CharacterActionBar
        characterName={possessedObject.name}
        activePresetId={activePresetId}
        onApplyPreset={onApplyPreset}
        onExit={onExitPossess}
      />
    )
  }
  if (readOnly) return null
  return (
    <SceneAddToolbar
      onAddObject={onAddObject}
      onAddCrowd={onAddCrowd}
      onAddCamera={onAddCamera}
      trajectoryMode={trajectoryMode}
      onToggleTrajectoryMode={onToggleTrajectoryMode}
      canvasFocusMode={canvasFocusMode}
      onToggleCanvasFocusMode={onToggleCanvasFocusMode}
    />
  )
}
