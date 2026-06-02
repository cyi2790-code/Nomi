import React from 'react'
import { cn } from '../../utils/cn'
import type { WorkspaceFileNode } from '../../../electron/workspace/workspaceFileIndex'
import { getDesktopBridge } from '../../desktop/bridge'
import { WORKSPACE_FILE_DRAG_MIME, type WorkspaceFileDragPayload } from './workspaceFileDrag'

type Props = {
  node: WorkspaceFileNode
  projectId: string
  depth?: number
}

function icon(kind: WorkspaceFileNode['kind']): string {
  if (kind === 'directory') return '▸'
  if (kind === 'text') return 'TXT'
  if (kind === 'image') return 'IMG'
  if (kind === 'video') return 'VID'
  if (kind === 'audio') return 'AUD'
  if (kind === 'document') return 'DOC'
  return 'FILE'
}

export default function FileTreeNode({ node, projectId, depth = 0 }: Props): JSX.Element {
  const [expanded, setExpanded] = React.useState(depth < 2)
  const [selected, setSelected] = React.useState(false)
  const hasChildren = node.kind === 'directory' && Boolean(node.children?.length)
  const label = node.name

  const selectOrToggle = React.useCallback(() => {
    if (node.kind === 'directory') {
      setExpanded((value) => !value)
      return
    }
    setSelected(true)
  }, [node.kind])

  const reveal = React.useCallback(() => {
    if (node.kind !== 'directory') {
      void getDesktopBridge()?.workspace?.revealFile?.({ projectId, relativePath: node.relativePath })
    }
  }, [node.kind, node.relativePath, projectId])

  // 仅图片可拖进画布（画布创建图片节点）。文件已在项目里，拖拽只传引用，不重新导入。
  const draggable = node.kind === 'image' && Boolean(projectId)
  const handleDragStart = React.useCallback((event: React.DragEvent<HTMLButtonElement>) => {
    if (!draggable) return
    const payload: WorkspaceFileDragPayload = { projectId, relativePath: node.relativePath, name: node.name, kind: node.kind }
    event.dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'copy'
  }, [draggable, node.kind, node.name, node.relativePath, projectId])

  return (
    <div>
      <button
        type="button"
        draggable={draggable}
        onDragStart={handleDragStart}
        onClick={selectOrToggle}
        onDoubleClick={reveal}
        className={cn(
          'w-full h-7 flex items-center gap-1 rounded px-1 text-left text-[12px]',
          'text-nomi-ink-60 hover:text-nomi-ink hover:bg-nomi-bg',
          selected && 'bg-nomi-bg text-nomi-ink',
          draggable && 'cursor-grab active:cursor-grabbing',
        )}
        style={{ paddingLeft: 6 + depth * 12 }}
        title={node.relativePath}
      >
        <span className="w-7 shrink-0 text-[9px] text-nomi-ink-40">{hasChildren ? (expanded ? '▾' : '▸') : icon(node.kind)}</span>
        <span className="truncate">{label}</span>
      </button>
      {hasChildren && expanded ? (
        <div>
          {node.children?.map((child) => (
            <FileTreeNode key={child.id} node={child} projectId={projectId} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
