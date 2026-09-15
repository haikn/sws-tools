export interface UntrustedWebviewMessage {
  requestId?: unknown
  type?: unknown
  path?: unknown
  body?: unknown
  page?: unknown
}

export const EDITOR_PAGES = new Set([
  'main',
  'dynamodb',
  'postgres',
  'decode-token',
  'format-json',
  'templates',
  'settings',
  'about',
])

const ACTIONS_BY_PATH: Record<string, Set<string>> = {
  '/_postgres': new Set(['databases', 'tables', 'objects', 'describe', 'rows', 'insert', 'update', 'delete', 'truncate', 'executeQuery']),
  '/_dynamodb': new Set(['listTables', 'describeTable', 'scanTable', 'putItem', 'deleteItem', 'truncateTable']),
  '/_sqs': new Set(['listQueues', 'queueDetails', 'createQueue', 'sendMessage', 'purgeQueue', 'deleteQueue', 'deleteMessage']),
  '/_extension_settings': new Set(['get', 'setPostgresPassword', 'clearPostgresPassword', 'setPostgresDatabase']),
}

export function validateBackendMessage(message: UntrustedWebviewMessage): { ok: true; requestId: string; path: string; body: Record<string, unknown> } | { ok: false; error: string } {
  if (message.type !== 'backend.request') return { ok: false, error: 'Unsupported webview message type.' }
  if (typeof message.requestId !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(message.requestId)) return { ok: false, error: 'Invalid request ID.' }
  if (typeof message.path !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS_BY_PATH, message.path)) return { ok: false, error: 'Unsupported backend path.' }
  if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) return { ok: false, error: 'Request body must be an object.' }
  const body = message.body as Record<string, unknown>
  if (typeof body.action !== 'string' || !ACTIONS_BY_PATH[message.path].has(body.action)) return { ok: false, error: 'Unsupported backend action.' }
  if (body.action === 'executeQuery' && (typeof body.sql !== 'string' || body.sql.trim().length === 0 || body.sql.length > 100_000)) return { ok: false, error: 'SQL query must be a non-empty string shorter than 100,000 characters.' }
  return { ok: true, requestId: message.requestId, path: message.path, body }
}

export function validateEditorPage(page: unknown): page is string {
  return typeof page === 'string' && EDITOR_PAGES.has(page)
}
