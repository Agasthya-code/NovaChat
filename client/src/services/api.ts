const apiBase = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
export const socketBase = import.meta.env.VITE_SOCKET_URL || window.location.origin

export async function api<T>(path: string, token?: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error('Cannot reach the NovaChat API. Make sure the backend is running on port 3001 and restart the Vite dev server.')
  }
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'The request could not be completed.')
  return body
}
