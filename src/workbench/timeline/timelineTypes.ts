// v0.7.1: 加 'audio' clip type（轨道仍是 image / video 两条；audio clip 落到 video 轨）
export type TimelineTrackType = 'image' | 'video'
export type TimelineClipType = 'image' | 'video' | 'audio'

export type TimelineClip = {
  id: string
  type: TimelineClipType
  sourceNodeId: string
  label: string
  startFrame: number
  endFrame: number
  frameCount: number
  offsetStartFrame: number
  offsetEndFrame: number
  text?: string
  url?: string
  thumbnailUrl?: string
}

export type TimelineTrack = {
  id: string
  type: TimelineTrackType
  label: string
  clips: TimelineClip[]
}

export type TimelineState = {
  version: 1
  fps: 30
  scale: number
  playheadFrame: number
  tracks: TimelineTrack[]
}

// v0.7.1: 视频轨改名"媒体轨"（承载 video / audio clip）
export const TIMELINE_TRACK_DEFINITIONS: Array<Pick<TimelineTrack, 'id' | 'type' | 'label'>> = [
  { id: 'imageTrack', type: 'image', label: '图片轨' },
  { id: 'videoTrack', type: 'video', label: '媒体轨' },
]

// audio / video clip 共用一条轨道；helper 用于决定 clip 该挂哪条
export function getTrackTypeForClipType(clipType: TimelineClipType): TimelineTrackType {
  return clipType === 'image' ? 'image' : 'video'
}
