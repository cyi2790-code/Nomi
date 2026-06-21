import { IconPlugConnected, IconPlus } from '@tabler/icons-react'
import { WorkbenchIconButton } from '../../design/workbenchActions'
import { cn } from '../../utils/cn'

export type WorkbenchAiHeaderActionsProps = {
  className?: string
  actionClassName?: string
  onModelIntegration: () => void
  onNewConversation: () => void
}

export function WorkbenchAiHeaderActions({
  className,
  actionClassName,
  onModelIntegration,
  onNewConversation,
}: WorkbenchAiHeaderActionsProps): JSX.Element {
  return (
    <div className={cn('workbench-ai-header-actions inline-flex items-center flex-nowrap gap-1.5', className)}>
      <WorkbenchIconButton
        className={cn('workbench-ai-header-actions__button', actionClassName)}
        label="模型接入"
        onClick={onModelIntegration}
        icon={<IconPlugConnected size={14} />}
      />
      <WorkbenchIconButton
        className={cn('workbench-ai-header-actions__button', actionClassName)}
        label="新对话"
        onClick={onNewConversation}
        icon={<IconPlus size={14} />}
      />
    </div>
  )
}

export function openWorkbenchModelIntegration(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('nomi-open-model-catalog', { detail: { intent: 'model-integration' } }))
}
