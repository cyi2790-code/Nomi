import React from 'react'
import { markStartupProbe, timeStartupStepAsync } from './utils/startupDiagnostics'

const NomiStudioRoute = React.lazy(() => {
  markStartupProbe('NomiStudioRoute lazy requested')
  return timeStartupStepAsync('load NomiStudioRoute chunk', () => import('./NomiStudioRoute'), 250)
})

const ProjectLibraryStandaloneRoute = React.lazy(() =>
  timeStartupStepAsync(
    'load ProjectLibraryStandaloneRoute chunk',
    () => import('./workbench/library/ProjectLibraryStandaloneRoute'),
    250,
  ),
)

type AppRoute = {
  hasProjectId: boolean
}

function readRoute(): AppRoute {
  if (typeof window === 'undefined') return { hasProjectId: false }
  try {
    const hash = window.location.hash || '#/studio'
    const search = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
    const projectId = search ? new URLSearchParams(search).get('projectId') : ''
    return { hasProjectId: Boolean(projectId?.trim()) }
  } catch {
    return { hasProjectId: false }
  }
}

function normalizeHashRoute(): void {
  if (typeof window === 'undefined') return
  const hash = window.location.hash || ''
  if (!hash || hash === '#/' || hash.startsWith('#/workspace')) {
    window.history.replaceState(null, '', '#/studio')
  }
}

function RouteLoading(): JSX.Element {
  React.useEffect(() => {
    markStartupProbe('route-loading-mounted')
  }, [])

  return (
    <div
      className="grid h-screen w-screen place-items-center bg-nomi-bg text-nomi-ink font-nomi-sans"
      aria-label="Nomi 加载中"
    >
      <div className="h-6 w-6 rounded-full border border-nomi-line border-t-nomi-accent animate-spin" />
    </div>
  )
}

export default function NomiRouterApp(): JSX.Element {
  markStartupProbe('NomiRouterApp render')
  const [route, setRoute] = React.useState<AppRoute>(() => {
    normalizeHashRoute()
    return readRoute()
  })

  React.useEffect(() => {
    const handleHashChange = () => {
      normalizeHashRoute()
      setRoute(readRoute())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return route.hasProjectId ? (
    <React.Suspense fallback={<RouteLoading />}>
      <NomiStudioRoute />
    </React.Suspense>
  ) : (
    <React.Suspense fallback={<RouteLoading />}>
      <ProjectLibraryStandaloneRoute />
    </React.Suspense>
  )
}
