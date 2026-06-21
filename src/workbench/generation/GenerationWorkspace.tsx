import React from 'react'
import { cn } from '../../utils/cn'
import { markStartupProbe } from '../../utils/startupDiagnostics'

const TimelinePanel = React.lazy(() => import('../timeline/TimelinePanel'))

function TimelinePlaceholder(): JSX.Element {
  return (
    <div
      className="w-full h-full bg-[var(--workbench-surface-solid)] border-t border-[var(--workbench-border)]"
      aria-label="生成时间轴加载中"
    />
  )
}

type GenerationWorkspaceProps = {
  canvas: React.ReactNode
  aiSidebar?: React.ReactNode
  aiLayout?: 'sidebar' | 'overlay'
}

export default function GenerationWorkspace({
  canvas,
  aiSidebar,
  aiLayout = 'sidebar',
}: GenerationWorkspaceProps): JSX.Element {
  const [timelineEnabled, setTimelineEnabled] = React.useState(false)

  React.useEffect(() => {
    markStartupProbe('generation-workspace-mounted')
    const timer = window.setTimeout(() => setTimelineEnabled(true), 1_200)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <section
      className={cn(
        'workbench-generation',
        'grid grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--workbench-timeline-height)]',
        'w-full h-full overflow-hidden bg-[var(--workbench-bg)]',
        aiSidebar && aiLayout === 'sidebar' && 'grid-cols-[minmax(0,1fr)_340px]',
        aiSidebar && aiLayout === 'overlay' && 'relative grid-cols-[minmax(0,1fr)]',
      )}
      data-has-ai={aiSidebar ? 'true' : 'false'}
      data-ai-layout={aiSidebar ? aiLayout : 'none'}
      aria-label="生成区"
    >
      {/* E.2C-29 → 左侧面板重做: 分类导航已下沉到 WorkbenchShell 的
          ProjectExplorerSidebar「分类」tab（CategoryTree），生成区内不再单独挂载。 */}
      <div className={cn(
        'workbench-generation__canvas',
        'min-w-0 min-h-0 overflow-hidden border-b border-[var(--workbench-border)]',
        'relative',
      )}>
        {canvas}
      </div>
      {aiSidebar ? (
        <aside className={cn(
          'workbench-generation__ai',
          'grid min-w-0 min-h-0 overflow-hidden border-b border-[var(--workbench-border)]',
          aiLayout === 'overlay'
            ? 'absolute top-4 right-4 z-[80] block w-auto h-auto border-0 bg-transparent pointer-events-auto'
            : 'border-l border-l-[var(--workbench-border)] bg-[var(--workbench-surface)]',
        )} aria-label="生成区 AI 侧栏">
          {aiSidebar}
        </aside>
      ) : null}
      <div className={cn(
        'workbench-generation__timeline',
        'col-span-full min-w-0 min-h-0',
      )}>
        {timelineEnabled ? (
          <React.Suspense fallback={<TimelinePlaceholder />}>
            <TimelinePanel density="compact" regionLabel="生成时间轴" actionLabelPrefix="生成时间轴-" />
          </React.Suspense>
        ) : (
          <TimelinePlaceholder />
        )}
      </div>
    </section>
  )
}
