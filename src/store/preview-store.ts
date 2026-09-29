/**
 * `usePreviewStore` — a **viewing mode** of the simulator, not a car part.
 *
 * This store used to hold the doors, windows, mirrors, sunroof, trunks, turn
 * signals and wipers too, with a note saying "drawable, but not in `CarState`
 * yet". All seven have since moved to `CarState`: they have tools, go through
 * `runCommand`, produce a `ToolResult`, and voice can reach them — exactly
 * what that note promised.
 *
 * Exactly one field remains, and it stays **not because its turn hasn't come
 * yet**: hiding the roof to look straight into the cabin is a way of viewing
 * the car, not something the car does. No car has a "hide roof" button, so it
 * has no tool, and it doesn't belong in `CarState`.
 */

import { create } from 'zustand'

type PreviewState = {
  /**
   * **Roof hidden by default.** Almost everything this screen draws on the car
   * is inside the cabin — seat heating, per-side temperature, airflow. Open it
   * to a solid roof and the demoer's first command shows up nowhere. The button
   * in the "Mui" ("Roof") block is a *show* roof button: unpressed it isn't
   * lit, and pressing it puts the roof back on.
   */
  roofHidden: boolean
}

type PreviewActions = {
  toggleRoof: () => void
}

export const usePreviewStore = create<PreviewState & PreviewActions>()(
  (set) => ({
    roofHidden: true,
    toggleRoof: () => set((state) => ({ roofHidden: !state.roofHidden })),
  }),
)
