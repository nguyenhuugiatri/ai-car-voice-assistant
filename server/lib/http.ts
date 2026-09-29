/**
 * Two utilities every route needs: read a JSON body and return uncached JSON.
 *
 * Handlers are written with standard `Request`/`Response` rather than h3's own
 * helpers: reading a route is reading a `fetch` function, not learning another
 * framework.
 */

export function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/** `undefined` when the body isn't JSON — the caller picks its own error message. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown
  } catch {
    return undefined
  }
}
