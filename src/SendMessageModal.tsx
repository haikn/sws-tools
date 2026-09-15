import { useRef, useState } from 'react'
import type { QueueInfo } from './sqs'
import { sendMessage } from './sqs'
import { getTemplates, getCategories } from './store'
import './SendMessageModal.css'

interface Props {
  queues: QueueInfo[]
  onClose: () => void
}

function validateJson(text: string): string | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid JSON'
  }
}

export default function SendMessageModal({ queues, onClose }: Props) {
  const templates = getTemplates()
  const catMap = new Map(getCategories().map((c) => [c.id, c.name]))
  const [selectedUrl, setSelectedUrl] = useState(queues[0]?.url ?? '')
  const [selectedTpl, setSelectedTpl] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sentId, setSentId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleTemplateSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedTpl('')          // reset select back to placeholder immediately
    if (!id) return
    const tpl = templates.find((t) => t.id === id)
    if (tpl) handleTextChange(tpl.content)
  }

  function handleTextChange(text: string) {
    setJsonText(text)
    setSentId(null)
    setSendError(null)
    setJsonError(validateJson(text))
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? ''
      setJsonText(text)
      setSentId(null)
      setSendError(null)
      setJsonError(validateJson(text))
    }
    reader.readAsText(file)
    // Reset so the same file can be re-selected
    e.target.value = ''
  }

  async function handleSend() {
    const trimmed = jsonText.trim()
    if (!trimmed) {
      setJsonError('JSON content is required.')
      return
    }
    const err = validateJson(trimmed)
    if (err) { setJsonError(err); return }

    setSending(true)
    setSentId(null)
    setSendError(null)
    try {
      const normalized = JSON.stringify(JSON.parse(trimmed))
      const id = await sendMessage(selectedUrl, normalized)
      setSentId(id)
      setJsonText('')
      setJsonError(null)
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  const hasContent = jsonText.trim().length > 0
  const isValid = hasContent && !jsonError

  return (
    <div className="sm-overlay" onClick={handleOverlayClick}>
      <div className="sm-modal">
        <div className="sm-header">
          <h2>Send Message</h2>
          <button className="sm-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="sm-body">
          <div className="sm-field">
            <label className="sm-label">Queue</label>
            {queues.length === 0 ? (
              <div className="sm-no-queues">No queues available.</div>
            ) : (
              <select
                className="sm-select"
                value={selectedUrl}
                onChange={(e) => setSelectedUrl(e.target.value)}
              >
                {queues.map((q) => (
                  <option key={q.url} value={q.url}>{q.name}</option>
                ))}
              </select>
            )}
          </div>

          {templates.length > 0 && (
            <div className="sm-field">
              <label className="sm-label">Load from Template</label>
              <select
                className="sm-select"
                value={selectedTpl}
                onChange={handleTemplateSelect}
              >
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

          <div className="sm-field">
            <div className="sm-label-row">
              <label className="sm-label">JSON Body</label>
              <button
                className="sm-browse-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse file…
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json,text/plain"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </div>
            <textarea
              className={`sm-textarea${jsonError ? ' sm-textarea--error' : ''}`}
              placeholder={'Paste JSON here, e.g.\n{\n  "event": "update",\n  "id": 123\n}'}
              value={jsonText}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={12}
              spellCheck={false}
              autoComplete="off"
            />
            {jsonError && (
              <div className="sm-validation-error">{jsonError}</div>
            )}
          </div>

          {sendError && (
            <div className="sm-send-error">
              <strong>Failed to send:</strong> {sendError}
            </div>
          )}

          {sentId && (
            <div className="sm-success">
              Message sent — ID: <code>{sentId}</code>
            </div>
          )}
        </div>

        <div className="sm-footer">
          <button className="sm-cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="sm-send-btn"
            onClick={handleSend}
            disabled={!isValid || sending || queues.length === 0}
          >
            {sending ? 'Sending…' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  )
}
