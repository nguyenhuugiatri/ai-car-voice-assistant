/**
 * The eval suite's Web Worker — `CreateWebWorkerMLCEngine` first; a Service
 * Worker would be a separate, later upgrade.
 *
 * This is the **eval suite's** worker, not the app's (that one is
 * `src/llm/worker.ts`); two files identical line for line is normal here,
 * because the eval loop `reload()`s models constantly while the app doesn't,
 * and merging them would force the app to live with the lifecycle of
 * something that only runs when someone opens `#/eval`.
 */

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (message: MessageEvent) => {
  handler.onmessage(message)
}
