/**
 * v0.8: 节点错误状态徽章。
 *
 * 替代之前在卡片内塞大段 error stack 的 div。
 * 鼠标悬停 → 看完整 error。
 * 单击 → 复制 error 到剪贴板（方便贴给开发者）。
 */
import React from 'react'
import { cn } from '../../../utils/cn'

export function ErrorBadge({ message }: { message: string }): JSX.Element {
  const [copied, setCopied] = React.useState(false)

  const handleClick = React.useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      /* ignore — read-only env */
    }
  }, [message])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={copied ? '已复制错误信息' : message}
      aria-label="生成失败 — 点击复制详细错误"
      className={cn(
        'inline-flex items-center justify-center',
        'w-[18px] h-[18px] rounded-full',
        'bg-workbench-danger-soft text-workbench-danger',
        'text-[11px] font-bold leading-none',
        'cursor-pointer select-none',
        'hover:bg-workbench-danger hover:text-nomi-paper transition-colors',
      )}
    >
      {copied ? '✓' : '!'}
    </button>
  )
}
