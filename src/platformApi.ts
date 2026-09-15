interface ExtensionRequest {
  requestId: string
  type: 'backend.request' | 'open.editor'
  path: string
  body?: Record<string, unknown>
  page?: string
}

interface ExtensionResponse {
  requestId: string
  ok: boolean
  data?: unknown
  error?: string
}

type VsCodeApi = {
  postMessage(message: ExtensionRequest): void
}

declare global {
  interface Window {
    __SWS_INITIAL_PAGE__?: string
    __SWS_SURFACE__?: 'sidebar' | 'editor'
  }
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi
  }
}

const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>()
let listenerInstalled = false
let vscodeApi: VsCodeApi | null = null

export function isExtensionWebview(): boolean {
  return typeof window.acquireVsCodeApi === 'function'
}

function getVsCodeApi(): VsCodeApi {
  if (!vscodeApi) {
    if (!window.acquireVsCodeApi) throw new Error('VS Code webview API is unavailable.')
    vscodeApi = window.acquireVsCodeApi()
  }
  return vscodeApi
}

function extensionRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!listenerInstalled) {
    window.addEventListener('message', (event: MessageEvent<ExtensionResponse>) => {
      const response = event.data
      const request = pending.get(response.requestId)
      if (!request) return
      pending.delete(response.requestId)
      if (response.ok) request.resolve(response.data)
      else request.reject(new Error(response.error ?? 'Extension request failed.'))
    })
    listenerInstalled = true
  }

  const requestId = crypto.randomUUID()
  return new Promise<T>((resolve, reject) => {
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject })
    getVsCodeApi().postMessage({ requestId, type: 'backend.request', path, body })
  })
}

export async function requestBackend<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (isExtensionWebview()) return extensionRequest<T>(path, body)
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok || result.error) throw new Error(result.error ?? `Backend request failed (${response.status})`)
  return result
}

export function openPageInEditor(page: string): void {
  if (!isExtensionWebview()) return
  getVsCodeApi().postMessage({ requestId: crypto.randomUUID(), type: 'open.editor', path: '', page })
}

export function getInitialPage<T extends string>(fallback: T): T {
  return (window.__SWS_INITIAL_PAGE__ as T | undefined) ?? fallback
}

export function isSidebarSurface(): boolean {
  return window.__SWS_SURFACE__ === 'sidebar'
}

export function onEditorNavigation(callback: (page: string) => void): () => void {
  const listener = (event: MessageEvent<{ type?: string; page?: string }>) => {
    if (event.data.type === 'reload') {
      window.location.reload()
      return
    }
    if (event.data.type === 'navigate' && event.data.page) callback(event.data.page)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
