/**
 * The **app's** Web Worker (`CreateWebWorkerMLCEngine` first; a Service
 * Worker would be a separate, later upgrade).
 *
 * Identical to `src/eval/worker.ts` line for line, and that's the intent
 * already recorded in that file: the eval loop `reload()`s models constantly,
 * while the head unit loads one model and keeps it. Merging them would force
 * the app to live with the lifecycle of something that only runs when someone
 * opens `#/eval` — and force the two pages to share one `GPUDevice`.
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message)
}
