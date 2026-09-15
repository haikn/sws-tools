import { useRef, useState } from 'react'
import type { QueueInfo } from './sqs'
import { sendMessage } from './sqs'
import { getTemplates, getCategories } from './store'
import './LoadTestModal.css'

interface Props {
  queues: QueueInfo[]
  onClose: () => void
}

interface LeafField {
  path: string
  value: unknown
  type: 'string' | 'number' | 'boolean' | 'other'
}

function extractLeafPaths(obj: unknown, prefix = ''): LeafField[] {
  const result: LeafField[] = []
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return result

  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result.push(...extractLeafPaths(val, path))
    } else {
      const type: LeafField['type'] =
        typeof val === 'string' ? 'string' :
        typeof val === 'number' ? 'number' :
        typeof val === 'boolean' ? 'boolean' : 'other'
      result.push({ path, value: val, type })
    }
  }
  return result
}

function randomValue(type: LeafField['type']): unknown {
  if (type === 'string') return crypto.randomUUID()
  if (type === 'number') return Math.floor(Math.random() * 1_000_000)
  if (type === 'boolean') return Math.random() > 0.5
  return null
}

function applyRandomFields(
  obj: unknown,
  fields: LeafField[],
  randomized: Set<string>,
  prefix = ''
): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj

  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (randomized.has(path)) {
      const field = fields.find((f) => f.path === path)
      result[key] = field ? randomValue(field.type) : val
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      result[key] = applyRandomFields(val, fields, randomized, path)
    } else {
      result[key] = val
    }
  }
  return result
}

function validateJson(text: string): string | null {
  if (!text.trim()) return null
  try { JSON.parse(text); return null }
  catch (e) { return e instanceof Error ? e.message : 'Invalid JSON' }
}

export default function LoadTestModal({ queues, onClose }: Props) {
  const templates = getTemplates()
  const catMap = new Map(getCategories().map((c) => [c.id, c.name]))

  const [selectedUrl, setSelectedUrl] = useState(queues[0]?.url ?? '')
  const [count, setCount] = useState(100)
  const [selectedTpl, setSelectedTpl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [leafFields, setLeafFields] = useState<LeafField[]>([])
  const [randomized, setRandomized] = useState<Set<string>>(new Set())
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<{ sent: number; errors: number; total: number } | null>(null)
  const [done, setDone] = useState(false)

  const abortRef = useRef(false)
  const sentRef = useRef(0)
  const errorsRef = useRef(0)

  function handleTemplateSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedTpl('')
    if (!id) return
    const tpl = templates.find((t) => t.id === id)
    if (tpl) loadJson(tpl.content)
  }

  function loadJson(text: string) {
    setJsonText(text)
    setDone(false)
    setProgress(null)
    const err = validateJson(text)
    setJsonError(err)
    if (!err && text.trim()) {
      try {
        const parsed = JSON.parse(text)
        const fields = extractLeafPaths(parsed)
        setLeafFields(fields)
        setRandomized(new Set(fields.filter((f) => f.type !== 'other').map((f) => f.path)))
      } catch {
        setLeafFields([])
        setRandomized(new Set())
      }
    } else {
      setLeafFields([])
      setRandomized(new Set())
    }
  }

  function toggleField(path: string) {
    setRandomized((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setRandomized(new Set(leafFields.filter((f) => f.type !== 'other').map((f) => f.path)))
    } else {
      setRandomized(new Set())
    }
  }

  async function handleSend() {
    const trimmed = jsonText.trim()
    if (!trimmed || jsonError) return

    const parsed = JSON.parse(trimmed)
    const total = count
    abortRef.current = false
    sentRef.current = 0
    errorsRef.current = 0

    setSending(true)
    setDone(false)
    setProgress({ sent: 0, errors: 0, total })

    const CONCURRENCY = 20

    for (let i = 0; i < total; i += CONCURRENCY) {
      if (abortRef.current) break

      const batchSize = Math.min(CONCURRENCY, total - i)
      await Promise.all(
        Array.from({ length: batchSize }, () => async () => {
          const msg = applyRandomFields(parsed, leafFields, randomized)
          try {
            await sendMessage(selectedUrl, JSON.stringify(msg))
            sentRef.current++
          } catch {
            errorsRef.current++
          }
          setProgress({ sent: sentRef.current, errors: errorsRef.current, total })
        }).map((fn) => fn())
      )
    }

    setSending(false)
    setDone(true)
  }

  function handleStop() {
    abortRef.current = true
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget && !sending) onClose()
  }

  const randomizableCount = leafFields.filter((f) => f.type !== 'other').length
  const allRandomized = randomizableCount > 0 && leafFields.filter((f) => f.type !== 'other').every((f) => randomized.has(f.path))
  const canSend = selectedUrl && jsonText.trim() && !jsonError && count > 0 && !sending

  return (
    <div className="lt-overlay" onClick={handleOverlayClick}>
      <div className="lt-modal">
        <div className="lt-header">
          <h2>Load Test</h2>
          <button className="lt-close" onClick={onClose} aria-label="Close" disabled={sending}>✕</button>
        </div>

        <div className="lt-body">
          {/* Queue */}
          <div className="lt-field">
            <label className="lt-label">Queue</label>
            {queues.length === 0 ? (
              <div className="lt-no-queues">No queues available.</div>
            ) : (
              <select className="lt-select" value={selectedUrl} onChange={(e) => setSelectedUrl(e.target.value)}>
                {queues.map((q) => <option key={q.url} value={q.url}>{q.name}</option>)}
              </select>
            )}
          </div>

          {/* Count */}
          <div className="lt-field">
            <label className="lt-label">Number of Messages</label>
            <input
              className="lt-input"
              type="number"
              min={1}
              max={100_000}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            />
          </div>

          {/* Template selector */}
          {templates.length > 0 && (
            <div className="lt-field">
              <label className="lt-label">Load from Template</label>
              <select className="lt-select" value={selectedTpl} onChange={handleTemplateSelect}>
                <option value="">— select a template —</option>
                {templates.map((t) => {
                  const catName = t.category ? catMap.get(t.category) : undefined
                  return (
                    <option key={t.id} value={t.id}>
                      {catName ? `[${catName}] ${t.name}` : t.name}
                    </option>
                  )
                })}
              </select>
            </div>
          )}

          {/* JSON textarea */}
          <div className="lt-field">
            <label className="lt-label">Message Template (JSON)</label>
            <textarea
              className={`lt-textarea${jsonError ? ' lt-textarea--error' : ''}`}
              placeholder={'Paste JSON template here, e.g.\n{\n  "event": "order",\n  "id": 123,\n  "userId": "abc-123"\n}'}
              value={jsonText}
              onChange={(e) => loadJson(e.target.value)}
              rows={8}
              spellCheck={false}
              autoComplete="off"
            />
            {jsonError && <div className="lt-validation-error">{jsonError}</div>}
          </div>

          {/* Field randomization */}
          {leafFields.length > 0 && (
            <div className="lt-field">
              <div className="lt-label-row">
                <label className="lt-label">Randomize Fields</label>
                {randomizableCount > 0 && (
                  <label className="lt-toggle-all">
                    <input
                      type="checkbox"
                      checked={allRandomized}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                    All
                  </label>
                )}
              </div>
              <div className="lt-fields-table">
                <div className="lt-fields-header">
                  <span>Field</span>
                  <span>Example Value</span>
                  <span>Type</span>
                  <span className="lt-col-check">Randomize</span>
                </div>
                {leafFields.map((f) => (
                  <div key={f.path} className={`lt-fields-row${randomized.has(f.path) ? ' lt-fields-row--active' : ''}`}>
                    <span className="lt-field-path"><code>{f.path}</code></span>
                    <span className="lt-field-value">
                      <code>{String(f.value).slice(0, 36)}{String(f.value).length > 36 ? '…' : ''}</code>
                    </span>
                    <span>
                      <span className={`lt-type-badge lt-type-${f.type}`}>{f.type}</span>
                    </span>
                    <span className="lt-col-check">
                      <input
                        type="checkbox"
                        checked={randomized.has(f.path)}
                        onChange={() => toggleField(f.path)}
                        disabled={f.type === 'other'}
                      />
                    </span>
                  </div>
                ))}
              </div>
              {randomized.size === 0 && (
                <div className="lt-fields-hint">No fields randomized — all messages will be identical.</div>
              )}
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="lt-progress">
              <div className="lt-progress-bar-wrap">
                <div
                  className="lt-progress-bar"
                  style={{ width: `${Math.round((progress.sent + progress.errors) / progress.total * 100)}%` }}
                />
              </div>
              <div className="lt-progress-stats">
                <span>{progress.sent.toLocaleString()} sent</span>
                {progress.errors > 0 && <span className="lt-progress-errors">{progress.errors.toLocaleString()} failed</span>}
                <span className="lt-progress-total">/ {progress.total.toLocaleString()}</span>
              </div>
              {done && (
                <div className={`lt-result ${progress.errors === 0 ? 'lt-result--success' : 'lt-result--partial'}`}>
                  {progress.errors === 0
                    ? `All ${progress.sent.toLocaleString()} messages sent successfully.`
                    : `Done: ${progress.sent.toLocaleString()} sent, ${progress.errors.toLocaleString()} failed.`}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lt-footer">
          <button className="lt-cancel-btn" onClick={onClose} disabled={sending}>Cancel</button>
          {sending ? (
            <button className="lt-stop-btn" onClick={handleStop}>Stop Sending</button>
          ) : (
            <button className="lt-send-btn" onClick={handleSend} disabled={!canSend}>
              Send {count.toLocaleString()} Messages
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
