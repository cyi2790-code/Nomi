import React from 'react'
import { createRoot } from 'react-dom/client'
import NomiRouterApp from './NomiRouterApp'
import { markStartup, markStartupProbe, timeStartupStep } from './utils/startupDiagnostics'

const DEFAULT_COLOR_SCHEME = 'light'

function primeColorSchemeAttribute() {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-mantine-color-scheme', DEFAULT_COLOR_SCHEME)
}

markStartup('renderer module loaded')
markStartupProbe('renderer-module-loaded')
;(window as typeof window & { __NOMI_RENDERER_MODULE_LOADED__?: boolean }).__NOMI_RENDERER_MODULE_LOADED__ = true
primeColorSchemeAttribute()

const container = document.getElementById('root')
if (!container) throw new Error('Root container not found')
const root = timeStartupStep('createRoot', () => (container ? createRoot(container) : null), 100)

root?.render(
  <React.StrictMode>
    <NomiRouterApp />
  </React.StrictMode>
)
markStartup('react render scheduled')
markStartupProbe('react-render-scheduled')
