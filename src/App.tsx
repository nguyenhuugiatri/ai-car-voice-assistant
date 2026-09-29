/**
 * Head unit — the outer frame.
 *
 * **Landscape** layout, following Tesla's landscape-screen generation (Model
 * S/X 2021+, 3/Y): a thin status bar on top; **the car in the left column**
 * with the temperatures on either side, staying put across every screen; the
 * open screen (climate, menu, settings) on the right — where Tesla puts the
 * map and opens Controls over it; a **black dock** always visible with the
 * screen buttons and the talk button. The earlier 430px portrait version has
 * been replaced.
 *
 * No dedicated assistant card: real cars don't give it a column. Voice shows
 * up as a light band along the bottom edge and a small floating card when
 * needed (`VoiceOverlay`); the debug panel is a drawer opened from the status
 * bar.
 *
 * Below `lg` the blocks stack — that's only for trying it out on a phone, not
 * the real layout. But the frame is still locked to exactly one screen
 * (`h-dvh`) and only the middle scrolls, just like at `lg`: previously the
 * whole page scrolled, so the dock drifted off screen with the content,
 * taking the talk button with it.
 *
 * Screen changes have **no animation**: a voice command already spends ~2.2 s
 * in the model; a few hundred ms of screen slide only makes the lag feel
 * worse, and blurs the moment state actually changes when measuring latency.
 *
 * Three things this outer frame is responsible for, which nothing else
 * handles:
 *
 * 1. `.head-unit` — maps shadcn tokens to the car palette for the whole
 *    subtree (see `index.css`).
 * 2. The frame is locked to exactly one screen (`h-dvh`) and **only the inner
 *    part scrolls** — from `lg` up that's the right column, below `lg` it's
 *    the whole middle block. The dock is `shrink-0` and sits outside the
 *    scroll area, so long content can't push it off screen — and the dock
 *    being pushed off screen means losing the talk button too.
 *
 *    On the right, the open screen is **vertically centered** rather than
 *    stuck to the top. The frame's height is set by the car on the left, and
 *    no screen is as tall as it — stuck to the top, all the leftover space
 *    piles up at the bottom as a black slab, and the control block looks like
 *    it slid up. Centering splits the leftover evenly between both ends, so it
 *    reads as breathing room symmetric with the car (also centered) rather
 *    than forgotten empty space.
 *
 *    `safe center` rather than `center`: when the content is *taller* than the
 *    frame, plain centering pushes the top out beyond the scrollable area
 *    with no way to scroll back to it. `safe` falls back to start alignment
 *    exactly then.
 *
 *    The column ratio widens from 2:3 to 5:8 at `2xl`: the car hits the
 *    ceiling at 720px tall and can't grow any more, so every extra horizontal
 *    pixel in the left column just becomes black background, while the switch
 *    grid on the right is still cramped.
 * 3. Safe areas (`env(safe-area-inset-*)`) — this frame often runs full
 *    screen on real devices, and a status bar under the notch can't be read.
 */

import { useState, type ComponentType } from 'react'

import { CarStage } from '@/components/car/CarStage'
import { ClimateScreen } from '@/components/car/ClimateScreen'
import { DebugPanel } from '@/components/car/DebugPanel'
import { Dock } from '@/components/car/Dock'
import { MenuScreen } from '@/components/car/MenuScreen'
import { SettingsScreen } from '@/components/car/SettingsScreen'
import { StatusBar } from '@/components/car/StatusBar'
import { VoiceAurora } from '@/components/car/VoiceAurora'
import { VoicePanel } from '@/components/car/VoiceOverlay'
import type { Screen } from '@/domain/car-state'
import { useEngineBoot } from '@/llm/use-engine'
import { useCarStore } from '@/store/car-store'
import { useSessionStore } from '@/store/session-store'
import { useCallSession } from '@/voice/use-call-session'

const SCREENS: Record<Screen, ComponentType> = {
  home: MenuScreen,
  climate: ClimateScreen,
  settings: SettingsScreen,
}

export default function App() {
  const screen = useCarStore((state) => state.screen)
  const Screen = SCREENS[screen]
  const debugEnabled = useSessionStore((state) => state.debugOpen)
  // Whether the debug drawer is open is this frame's business, not the
  // session's: `debugOpen` in the store means *is debug enabled at all* (the
  // Settings screen), while this is just whether the drawer is pulled out.
  const [debugShown, setDebugShown] = useState(false)

  // `useCallSession` lives in the outer frame because this is the place that's
  // *always* mounted. Attached to a component that only shows during a call,
  // every hang-up would be an unmount mid-flight, and the cleanup (mic off,
  // cutting the speech queue) would run while its state is being torn down.
  // `active` is the switch, not `mount`.
  const callActive = useSessionStore((state) => state.callActive)
  const setCallActive = useSessionStore((state) => state.setCallActive)
  const engineReady = useSessionStore((state) => state.engine.phase === 'ready')
  const session = useCallSession({ active: callActive, ready: engineReady })

  // Load the model as soon as the page opens rather than waiting for the
  // first command. It sits in the outer frame because it has to survive every
  // screen change — attached to a specific screen, switching screens mid-way
  // would cancel the load.
  useEngineBoot()

  return (
    <div className="head-unit bg-car-void text-car-ink relative flex h-dvh flex-col overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <StatusBar
        debugShown={debugShown && debugEnabled}
        onToggleDebug={() => setDebugShown((shown) => !shown)}
      />

      {/*
        The aurora overlays the top edge (`z-30`, above even the debug drawer
        at `z-20`) — it's light, not a block, so taking up real space would
        make no sense.
      */}
      <VoiceAurora live={callActive && session.levelLive} />

      {/*
        The text card **floats on top**, taking no space: if starting a
        conversation pushed the whole car screen down a bit, every tap of the
        talk button would make the layout jump, and what jumps is the car —
        the thing people are looking at.

        The card **no longer** fits in the empty strip between the bottom of
        the status bar (`top-14`, i.e. 56px) and the top edge of the car
        (~157px): since the assistant's reply was promoted to the large line,
        it's ~146px tall and overlaps the top edge of the car and the control
        panel. That's a considered trade-off — see the comment in
        `VoicePanel`.

        This region is **always in the DOM**, even when empty, because
        `aria-live` lives here: a live region has to exist beforehand for
        screen readers to read content inserted later. Put `aria-live` on the
        card itself — which mounts together with its content — and most
        screen readers skip the first update.
      */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 top-14 z-30 flex justify-center px-4 lg:px-6 [&>*]:pointer-events-auto"
      >
        <VoicePanel
          onClose={() => setCallActive(false)}
          session={callActive ? session : null}
        />
      </div>

      {/*
        Below `lg` **only this block scrolls**, not the whole page: the dock is
        a flex sibling outside it, so it never drifts off screen. At `lg` and
        up, the inner `main` scrolls on its own, so this one is locked.
      */}
      <div className="relative grid min-h-0 flex-1 grid-cols-1 overflow-x-hidden overflow-y-auto lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:overflow-hidden 2xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
        <CarStage />

        <main className="@container min-w-0 px-4 pb-6 lg:flex lg:min-h-0 lg:flex-col lg:[justify-content:safe_center] lg:overflow-y-auto lg:overscroll-contain lg:py-6 lg:pr-6 lg:pl-2">
          <div className="car-screen-enter" key={screen}>
            <Screen />
          </div>
        </main>

        {debugEnabled && debugShown && (
          <div className="pointer-events-none absolute top-2 right-4 bottom-4 z-20 flex w-[min(26rem,calc(100%-2rem))] flex-col lg:right-6">
            <div className="pointer-events-auto flex min-h-0 flex-col">
              <DebugPanel onClose={() => setDebugShown(false)} />
            </div>
          </div>
        )}
      </div>

      <Dock />
    </div>
  )
}
