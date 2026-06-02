import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { WorkspaceFileListResult } from '../../../electron/workspace/workspaceFileIndex'

export type WorkspaceFilesState = WorkspaceFileListResult & {
  loading: boolean
  error: string | null
}

export function useWorkspaceFiles(projectId: string | null): WorkspaceFilesState & { refresh: () => void } {
  const [state, setState] = React.useState<WorkspaceFilesState>({ items: [], truncated: false, loading: false, error: null })
  const [version, setVersion] = React.useState(0)

  const refresh = React.useCallback(() => setVersion((value) => value + 1), [])

  React.useEffect(() => {
    let canceled = false
    const bridge = getDesktopBridge()
    if (!projectId || !bridge?.workspace?.listFiles) {
      setState({ items: [], truncated: false, loading: false, error: null })
      return () => {
        canceled = true
      }
    }
    setState((current) => ({ ...current, loading: true, error: null }))
    bridge.workspace.listFiles({ projectId, limit: 500 })
      .then((result) => {
        if (!canceled) setState({ items: result.items, truncated: result.truncated, loading: false, error: null })
      })
      .catch(() => {
        if (!canceled) setState({ items: [], truncated: false, loading: false, error: '无法读取项目文件夹，请检查权限或重新打开文件夹' })
      })
    return () => {
      canceled = true
    }
  }, [projectId, version])

  return { ...state, refresh }
}
