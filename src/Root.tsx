/**
 * The app's entire "router". There are exactly two pages — the head unit and
 * `#/eval` — so a routing library here would be adding a dependency to solve a
 * problem that doesn't exist yet. If a third, parameterized page is ever
 * needed, replace this rather than piling on more conditions.
 *
 * `#/eval` is a separate page inside the app itself — so it shares
 * `src/domain` and `src/prompt` with the real app and the schema never drifts
 * — rather than a button buried in `settings`.
 *
 * `EvalPage` is loaded with `lazy`: it pulls in all of `@mlc-ai/web-llm`, and
 * the head unit has no reason to download those 6 MB just to show the main
 * screen.
 */

import { Suspense, lazy, useSyncExternalStore } from 'react'

import App from './App'

const EvalPage = lazy(() => import('./eval/EvalPage'))

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

export function Root() {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => '',
  )

  if (hash.startsWith('#/eval')) {
    return (
      <Suspense
        fallback={
          <div className="p-6 text-neutral-400">Loading eval suite…</div>
        }
      >
        <EvalPage />
      </Suspense>
    )
  }

  return <App />
}
