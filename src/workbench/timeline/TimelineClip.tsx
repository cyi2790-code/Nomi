import React from 'react'
import { WorkbenchButton } from '../../design'
import { cn } from '../../utils/cn'
import { useWorkbenchStore } from '../workbenchStore'
import { canPlaceClip, frameToPixel, withClipStartFrame } from './timelineEdit'
import type { TimelineClip as TimelineClipData } from './timelineTypes'
import { buildVideoPlaybackUrl } from '../../media/videoPlaybackUrl'
import { diagnoseVideoPlaybackFailure, logVideoPlaybackFailure } from '../../media/videoPlaybackDiagnostics'

type TimelineClipProps = {
  clip: TimelineClipData
}

export default function TimelineClip({ clip }: TimelineClipProps): JSX.Element {
  const scale = useWorkbenchStore((state) => state.timeline.scale)
  const selectedClipId = useWorkbenchStore((state) => state.selectedTimelineClipId)
  const selectTimelineClip = useWorkbenchStore((state) => state.selectTimelineClip)
  const setTimelinePlayhead = useWorkbenchStore((state) => state.setTimelinePlayhead)
  const resizeTimelineClip = useWorkbenchStore((state) => state.resizeTimelineClip)
  const moveTimelineClip = useWorkbenchStore((state) => state.moveTimelineClip)
  const track = useWorkbenchStore((state) => state.timeline.tracks.find((t) => t.clips.some((c) => c.id === clip.id)))

  const [dragDeltaPixels, setDragDeltaPixels] = React.useState<number | null>(null)

  const title = clip.label || clip.text || clip.sourceNodeId
  const showVideoThumb = clip.type === 'video' && !clip.thumbnailUrl && Boolean(clip.url)
  const hasVisualThumb = Boolean(clip.thumbnailUrl) || showVideoThumb
  const clipVideoUrl = typeof clip.url === 'string' ? clip.url : ''

  const beginResize = React.useCallback((event: React.PointerEvent<HTMLButtonElement>, edge: 'left' | 'right') => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const pointerId = event.pointerId
    const target = event.currentTarget
    let appliedDeltaFrame = 0
    target.setPointerCapture(pointerId)
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaFrame = Math.round((moveEvent.clientX - startX) / scale)
      const incrementalDelta = deltaFrame - appliedDeltaFrame
      if (incrementalDelta === 0) return
      appliedDeltaFrame = deltaFrame
      resizeTimelineClip(clip.id, edge, incrementalDelta)
    }
    const handlePointerUp = () => {
      target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [clip.id, resizeTimelineClip, scale])

  const beginDrag = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    // Don't start drag if clicking on a resize handle
    if ((event.target as HTMLElement).closest('.workbench-timeline-clip__handle')) return
    event.preventDefault()
    const startX = event.clientX
    const pointerId = event.pointerId
    const target = event.currentTarget
    target.setPointerCapture(pointerId)
    let currentDelta = 0

    const handlePointerMove = (moveEvent: PointerEvent) => {
      currentDelta = moveEvent.clientX - startX
      setDragDeltaPixels(currentDelta)
    }
    const handlePointerUp = () => {
      target.releasePointerCapture(pointerId)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      const deltaFrame = Math.round(currentDelta / scale)
      const targetFrame = Math.max(0, clip.startFrame + deltaFrame)
      moveTimelineClip(clip.id, targetFrame)
      setDragDeltaPixels(null)
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [clip.id, clip.startFrame, moveTimelineClip, scale])

  const isDragging = dragDeltaPixels !== null
  const ghostDeltaPixels = dragDeltaPixels ?? 0
  const ghostFrame = Math.max(0, clip.startFrame + Math.round(ghostDeltaPixels / scale))
  const hasCollision = isDragging && track != null && !canPlaceClip(track, withClipStartFrame(clip, ghostFrame))

  const clipWidth = Math.max(36, frameToPixel(clip.frameCount, scale))

  const thumbContent = clip.thumbnailUrl ? (
    <img className={cn(
      'workbench-timeline-clip__thumb',
      'block absolute inset-0 w-full h-full object-cover rounded-[inherit] bg-[var(--nomi-ink-10)]',
    )} src={clip.thumbnailUrl} alt="" draggable={false} />
  ) : showVideoThumb && clipVideoUrl ? (
    <video
      className={cn(
        'workbench-timeline-clip__thumb',
        'block absolute inset-0 w-full h-full object-cover rounded-[inherit] bg-[var(--nomi-ink-10)]',
      )}
      src={buildVideoPlaybackUrl(clipVideoUrl)}
      crossOrigin="use-credentials"
      muted
      playsInline
      preload="metadata"
      draggable={false}
      onError={(event) => {
        void diagnoseVideoPlaybackFailure(clipVideoUrl, event.currentTarget.error).then(logVideoPlaybackFailure)
      }}
    />
  ) : null

  const isSelected = selectedClipId === clip.id

  const clipBaseClasses = cn(
    'workbench-timeline-clip',
    'absolute top-[5px] h-9 flex items-center gap-0 p-0',
    'rounded text-[var(--workbench-ink)] text-[11px] font-medium',
    'shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] cursor-grab select-none active:cursor-grabbing',
    clip.type === 'image' && 'border border-[color-mix(in_srgb,var(--workbench-accent)_22%,transparent)] bg-[var(--workbench-accent-soft)]',
    clip.type === 'video' && 'border border-[color-mix(in_srgb,var(--workbench-video)_24%,transparent)] bg-[var(--workbench-video-soft)]',
    // v0.7.1: audio clip 视觉（紫色调，与 video 区分）
    clip.type === 'audio' && 'border border-[color-mix(in_srgb,var(--nomi-accent)_24%,transparent)] bg-[var(--nomi-accent-soft)]',
  )

  const selectedClasses = isSelected ? cn(
    clip.type === 'video'
      ? 'border-[color-mix(in_srgb,var(--workbench-video)_56%,transparent)] bg-[color-mix(in_srgb,var(--workbench-video)_16%,var(--workbench-surface))] shadow-[0_0_0_2px_color-mix(in_srgb,var(--workbench-video)_13%,transparent),0_8px_18px_var(--workbench-video-soft)]'
      : 'border-[color-mix(in_srgb,var(--workbench-accent)_62%,transparent)] bg-[color-mix(in_srgb,var(--workbench-accent)_16%,var(--workbench-surface))] shadow-[0_0_0_2px_color-mix(in_srgb,var(--workbench-accent)_13%,transparent),0_8px_18px_var(--workbench-accent-soft)]',
  ) : ''

  const handleClasses = cn(
    'workbench-timeline-clip__handle',
    'absolute -top-px -bottom-px w-1.5 border-0 cursor-ew-resize opacity-90',
    clip.type === 'video' ? 'bg-[var(--workbench-video)]' : 'bg-[var(--workbench-accent)]',
  )

  return (
    <>
      <div
        className={cn(clipBaseClasses, selectedClasses)}
        data-testid="timeline-clip"
        data-clip-type={clip.type}
        title={title}
        data-selected={isSelected ? 'true' : 'false'}
        style={{
          left: frameToPixel(clip.startFrame, scale),
          width: clipWidth,
          opacity: isDragging ? 0.4 : undefined,
          cursor: isDragging ? 'grabbing' : undefined,
        }}
        onClick={(event) => {
          if (isDragging) return
          event.stopPropagation()
          selectTimelineClip(clip.id)
          setTimelinePlayhead(clip.startFrame)
        }}
        onPointerDown={beginDrag}
      >
        {isSelected ? (
          <WorkbenchButton
            className={cn(handleClasses, 'workbench-timeline-clip__handle--left', '-left-1 rounded-l-[5px] rounded-r-none')}
            aria-label="调整片段起点"
            title="调整片段起点"
            onPointerDown={(event) => beginResize(event, 'left')}
          />
        ) : null}
        {thumbContent}
        {!hasVisualThumb ? (
          <span className={cn(
            'workbench-timeline-clip__label',
            'relative z-[1] min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
            'rounded-[3px] text-[var(--nomi-ink)] backdrop-blur-[8px]',
            'self-end mt-auto mx-1 mb-1 px-[5px] py-0.5 bg-[color-mix(in_oklch,var(--nomi-paper)_72%,transparent)]',
          )}>{title}</span>
        ) : null}
        {isSelected ? (
          <WorkbenchButton
            className={cn(handleClasses, 'workbench-timeline-clip__handle--right', '-right-1 rounded-l-none rounded-r-[5px]')}
            aria-label="调整片段终点"
            title="调整片段终点"
            onPointerDown={(event) => beginResize(event, 'right')}
          />
        ) : null}
      </div>
      {isDragging ? (
        <div
          className={cn(
            clipBaseClasses,
            'workbench-timeline-clip__ghost',
            'opacity-70 pointer-events-none',
            hasCollision && 'border-[var(--workbench-danger)] bg-[var(--workbench-danger-soft)] opacity-50',
          )}
          data-clip-type={clip.type}
          data-collision={hasCollision ? 'true' : 'false'}
          aria-hidden="true"
          style={{
            left: frameToPixel(clip.startFrame, scale),
            width: clipWidth,
            transform: `translateX(${ghostDeltaPixels}px)`,
            pointerEvents: 'none',
          }}
        >
          {thumbContent}
          {!hasVisualThumb ? (
            <span className={cn(
              'workbench-timeline-clip__label',
              'relative z-[1] min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap',
              'rounded-[3px] text-[var(--nomi-ink)] backdrop-blur-[8px]',
              'self-end mt-auto mx-1 mb-1 px-[5px] py-0.5 bg-[color-mix(in_oklch,var(--nomi-paper)_72%,transparent)]',
            )}>{title}</span>
          ) : null}
        </div>
      ) : null}
    </>
  )
}
