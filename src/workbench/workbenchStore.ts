import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  addClipAtFrame,
  duplicateClipById,
  moveClipToFrame,
  nudgeClipById,
  removeClipById,
  resizeClipEdge,
  setTimelinePlayheadFrame,
  setTimelineScale,
  splitClipAtFrame,
} from './timeline/timelineEdit'
import { createDefaultTimeline, normalizeTimeline } from './timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrackType } from './timeline/timelineTypes'
import { createDefaultWorkbenchDocument, normalizeWorkbenchDocument, type CreationDocumentTools, type PreviewAspectRatio, type WorkbenchDocument } from './workbenchTypes'
import type { WorkbenchAiMessage } from './ai/workbenchAiTypes'
import { toast } from '../ui/toast'

export const WORKSPACE_MODES = ['creation', 'generation', 'preview'] as const

export type WorkspaceMode = (typeof WORKSPACE_MODES)[number]

type GraphViewport = { zoom: number; offset: { x: number; y: number } }

type WorkbenchState = {
  persistRevision: number
  workspaceMode: WorkspaceMode
  /** Phase E: which directory-tree category is currently selected */
  activeCategoryId: string
  /** Phase E: collapsed (icon-only) vs expanded sidebar */
  sidebarCollapsed: boolean
  /** Phase E: viewport (zoom + offset) per graph-canvas-type category */
  categoryViewports: Record<string, GraphViewport>
  setActiveCategoryId: (id: string) => void
  toggleSidebarCollapsed: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  rememberCategoryViewport: (categoryId: string, viewport: GraphViewport) => void
  workbenchDocument: WorkbenchDocument
  creationDocumentTools: CreationDocumentTools | null
  creationSelectionText: string
  creationAiModeId: string
  creationAiDraft: string
  creationAiMessages: WorkbenchAiMessage[]
  creationAiError: string
  timeline: TimelineState
  timelinePlaying: boolean
  previewAspectRatio: PreviewAspectRatio
  selectedTimelineClipId: string
  setWorkspaceMode: (mode: unknown) => void
  setWorkbenchDocument: (document: WorkbenchDocument) => void
  setCreationDocumentTools: (tools: CreationDocumentTools | null) => void
  setCreationSelectionText: (text: string) => void
  setCreationAiModeId: (modeId: string) => void
  setCreationAiDraft: (draft: string) => void
  setCreationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setCreationAiError: (error: string) => void
  resetCreationAiConversation: () => void
  setTimeline: (timeline: TimelineState) => void
  setTimelinePlaying: (playing: boolean) => void
  setPreviewAspectRatio: (ratio: PreviewAspectRatio) => void
  addTimelineClipAtFrame: (clip: TimelineClip, trackType: TimelineTrackType, startFrame: number) => void
  moveTimelineClip: (clipId: string, startFrame: number) => void
  removeTimelineClip: (clipId: string) => void
  resizeTimelineClip: (clipId: string, edge: 'left' | 'right', deltaFrame: number) => void
  splitTimelineClip: (clipId: string, frame: number) => void
  duplicateTimelineClip: (clipId: string) => void
  nudgeTimelineClip: (clipId: string, deltaFrame: number) => void
  selectTimelineClip: (clipId: string) => void
  setTimelinePlayhead: (frame: number) => void
  setTimelineZoom: (scale: number) => void
  restoreTimeline: (timeline: unknown) => void
}

export function isWorkspaceMode(value: unknown): value is WorkspaceMode {
  return typeof value === 'string' && WORKSPACE_MODES.includes(value as WorkspaceMode)
}

export const useWorkbenchStore = create<WorkbenchState>()(subscribeWithSelector((set) => ({
  persistRevision: 0,
  workspaceMode: 'generation',
  activeCategoryId: 'shots',
  sidebarCollapsed: true,
  categoryViewports: {},
  setActiveCategoryId: (id) => {
    if (typeof id !== 'string' || !id.trim()) return
    set({ activeCategoryId: id })
  },
  toggleSidebarCollapsed: () => {
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
  },
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed: Boolean(sidebarCollapsed) })
  },
  rememberCategoryViewport: (categoryId, viewport) => {
    if (!categoryId) return
    set((state) => ({
      categoryViewports: {
        ...state.categoryViewports,
        [categoryId]: viewport,
      },
    }))
  },
  workbenchDocument: createDefaultWorkbenchDocument(),
  creationDocumentTools: null,
  creationSelectionText: '',
  creationAiModeId: 'general',
  creationAiDraft: '',
  creationAiMessages: [],
  creationAiError: '',
  timeline: createDefaultTimeline(),
  timelinePlaying: false,
  previewAspectRatio: '16:9',
  selectedTimelineClipId: '',
  setWorkspaceMode: (mode) => {
    if (!isWorkspaceMode(mode)) return
    set({ workspaceMode: mode })
  },
  setWorkbenchDocument: (workbenchDocument) => {
    set((state) => ({
      workbenchDocument: normalizeWorkbenchDocument(workbenchDocument),
      persistRevision: state.persistRevision + 1,
    }))
  },
  setCreationDocumentTools: (creationDocumentTools) => {
    set({ creationDocumentTools })
  },
  setCreationSelectionText: (text) => {
    set({ creationSelectionText: typeof text === 'string' ? text.trim() : '' })
  },
  setCreationAiModeId: (creationAiModeId) => {
    set({ creationAiModeId })
  },
  setCreationAiDraft: (creationAiDraft) => {
    set({ creationAiDraft })
  },
  setCreationAiMessages: (messages) => {
    set((state) => ({
      creationAiMessages: typeof messages === 'function' ? messages(state.creationAiMessages) : messages,
    }))
  },
  setCreationAiError: (creationAiError) => {
    set({ creationAiError })
  },
  resetCreationAiConversation: () => {
    set({ creationAiDraft: '', creationAiMessages: [], creationAiError: '' })
  },
  setTimeline: (timeline) => {
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
  },
  setTimelinePlaying: (timelinePlaying) => {
    set({ timelinePlaying: Boolean(timelinePlaying) })
  },
  setPreviewAspectRatio: (previewAspectRatio) => {
    set({ previewAspectRatio })
  },
  addTimelineClipAtFrame: (clip, trackType, startFrame) => {
    set((state) => {
      const nextTimeline = addClipAtFrame(state.timeline, clip, trackType, startFrame)
      const inserted = nextTimeline !== state.timeline
        && nextTimeline.tracks.some((track) => track.clips.some((current) => current.id === clip.id))
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: inserted ? clip.id : state.selectedTimelineClipId,
        persistRevision: inserted ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  moveTimelineClip: (clipId, startFrame) => {
    set((state) => {
      const nextTimeline = moveClipToFrame(state.timeline, clipId, startFrame)
      if (nextTimeline === state.timeline) {
        toast('此位置已有片段', 'error')
      }
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: String(clipId || '').trim(),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  removeTimelineClip: (clipId) => {
    set((state) => {
      const hasClip = state.timeline.tracks.some((track) => track.clips.some((clip) => clip.id === clipId))
      return {
        timeline: hasClip ? removeClipById(state.timeline, clipId) : state.timeline,
        selectedTimelineClipId: state.selectedTimelineClipId === clipId ? '' : state.selectedTimelineClipId,
        timelinePlaying: false,
        persistRevision: hasClip ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  resizeTimelineClip: (clipId, edge, deltaFrame) => {
    set((state) => {
      const nextTimeline = resizeClipEdge(state.timeline, clipId, edge, deltaFrame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: String(clipId || '').trim(),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  splitTimelineClip: (clipId, frame) => {
    set((state) => {
      const nextTimeline = splitClipAtFrame(state.timeline, clipId, frame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: String(clipId || '').trim(),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  duplicateTimelineClip: (clipId) => {
    set((state) => {
      const nextTimeline = duplicateClipById(state.timeline, clipId)
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: String(clipId || '').trim(),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  nudgeTimelineClip: (clipId, deltaFrame) => {
    set((state) => {
      const nextTimeline = nudgeClipById(state.timeline, clipId, deltaFrame)
      return {
        timeline: nextTimeline,
        selectedTimelineClipId: String(clipId || '').trim(),
        persistRevision: nextTimeline !== state.timeline ? state.persistRevision + 1 : state.persistRevision,
      }
    })
  },
  selectTimelineClip: (clipId) => {
    set({ selectedTimelineClipId: String(clipId || '').trim() })
  },
  setTimelinePlayhead: (frame) => {
    set((state) => ({ timeline: setTimelinePlayheadFrame(state.timeline, frame) }))
  },
  setTimelineZoom: (scale) => {
    set((state) => ({ timeline: setTimelineScale(state.timeline, scale) }))
  },
  restoreTimeline: (timeline) => {
    set((state) => ({
      timeline: normalizeTimeline(timeline),
      persistRevision: state.persistRevision + 1,
    }))
  },
})))
