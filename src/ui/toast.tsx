import React from 'react'
import { create } from 'zustand'
import { cn } from '../utils/cn'

type ToastType = 'info' | 'success' | 'error' | 'warning'
type Toast = {
  id: string
  message: string
  type?: ToastType
  ttl?: number
  actionLabel?: string
  onAction?: () => void
}

type ToastState = {
  items: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (t) => {
    const id = Math.random().toString(36).slice(2, 8)
    const item: Toast = { id, ...t }
    set((s) => ({ items: [...s.items, item] }))
    const ttl = t.ttl ?? 3000
    window.setTimeout(() => get().remove(id), ttl)
  },
  remove: (id) => set((s) => ({ items: s.items.filter(i => i.id !== id) })),
}))

export function toast(message: string, type?: ToastType) {
  useToastStore.getState().push({ message, type })
}

export function ToastHost({ className }: { className?: string } = {}): JSX.Element {
  const items = useToastStore((s) => s.items)
  return (
    <div className={cn('fixed bottom-4 right-4 flex flex-col gap-2 z-50', className)}>
      {items.map(i => (
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg border border-black/[.15] shadow-sm',
            i.type === 'error' && 'bg-red-500/[.12]',
            i.type === 'success' && 'bg-emerald-500/[.12]',
            i.type !== 'error' && i.type !== 'success' && 'bg-blue-500/[.12]',
          )}
          key={i.id}
        >
          <span>{i.message}</span>
          {i.actionLabel && i.onAction ? (
            <button
              type="button"
              className="shrink-0 rounded-md border border-black/10 bg-white/70 px-2 py-1 text-[12px] font-medium hover:bg-white"
              onClick={() => {
                i.onAction?.()
                useToastStore.getState().remove(i.id)
              }}
            >
              {i.actionLabel}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
