import { useState } from 'react'
import { createQueue, getRegion } from './sqs'
import { getSettings } from './store'
import type { CreateQueueParams } from './sqs'
import './CreateQueueModal.css'

interface Props {
  onClose: () => void
  onCreated: () => void
}

const DEFAULTS: CreateQueueParams = {
  name: '',
  fifo: false,
  visibilityTimeout: 30,
  retentionPeriod: 345600,
  maxMessageSize: 262144,
  delaySeconds: 0,
  receiveWaitTime: 0,
}

const PRESET_QUEUES = [
  'local-public-ecu-update-orders-events',
  'local-public-ecu-update-orders-events-dlq',
  'local-public-ecu-update-orders-commands',
  'local-public-ecu-update-orders-commands-dlq',
  'software-update-events',
  'software-update-events-dlq',
  'software-update-internal-events',
  'software-update-internal-events-dlq',
  'jps-events',
  'jps-events-dlq'
]

type Tab = 'custom' | 'defaults'
type QueueStatus = 'idle' | 'creating' | 'done' | 'error'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="cq-field">
      <label className="cq-label">{label}{hint && <span className="cq-hint">{hint}</span>}</label>
      {children}
    </div>
  )
}

export default function CreateQueueModal({ onClose, onCreated }: Props) {
  const [tab, setTab] = useState<Tab>('custom')

  // Custom tab state
  const [form, setForm] = useState<CreateQueueParams>(DEFAULTS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Defaults tab state
  const [selected, setSelected] = useState<Set<string>>(new Set(PRESET_QUEUES))
  const [statuses, setStatuses] = useState<Record<string, { status: QueueStatus; error?: string }>>({})
  const [defaultsBusy, setDefaultsBusy] = useState(false)

  function set<K extends keyof CreateQueueParams>(key: K, value: CreateQueueParams[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function toggleQueue(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  const previewName = form.fifo && form.name && !form.name.endsWith('.fifo')
    ? `${form.name}.fifo`
    : form.name

  async function submitCustom(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createQueue({ ...form, name: form.name.trim() })
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  async function createDefaults() {
    const toCreate = PRESET_QUEUES.filter((q) => selected.has(q))
    if (toCreate.length === 0) return

    setDefaultsBusy(true)
    const initial: Record<string, { status: QueueStatus }> = {}
    for (const q of toCreate) initial[q] = { status: 'creating' }
    setStatuses(initial)

    let anyError = false
    for (const name of toCreate) {
      try {
        await createQueue({ ...DEFAULTS, name })
        setStatuses((s) => ({ ...s, [name]: { status: 'done' } }))
      } catch (err) {
        anyError = true
        setStatuses((s) => ({
          ...s,
          [name]: { status: 'error', error: err instanceof Error ? err.message : String(err) },
        }))
      }
    }

    setDefaultsBusy(false)
    if (!anyError) onCreated()
  }

  const allDone = PRESET_QUEUES.filter((q) => selected.has(q)).every(
    (q) => statuses[q]?.status === 'done'
  )

  return (
    <div className="cq-overlay" onClick={onClose}>
      <div className="cq-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cq-modal-header">
          <h2>Create Queue</h2>
          <button className="cq-close" onClick={onClose}>✕</button>
        </div>

        <div className="cq-tabs">
          <button
            className={`cq-tab${tab === 'custom' ? ' cq-tab--active' : ''}`}
            onClick={() => setTab('custom')}
          >
            Custom
          </button>
          <button
            className={`cq-tab${tab === 'defaults' ? ' cq-tab--active' : ''}`}
            onClick={() => setTab('defaults')}
          >
            Defaults
          </button>
        </div>

        {tab === 'custom' && (
          <form onSubmit={submitCustom}>
            <div className="cq-info-row">
              <span className="cq-info-label">Endpoint</span>
              <code className="cq-info-value">{getSettings().baseUrl}</code>
              <span className="cq-info-label">Region</span>
              <code className="cq-info-value">{getRegion()}</code>
            </div>

            <Field label="Queue name" hint="required">
              <input
                className="cq-input"
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="my-queue"
                required
                autoFocus
              />
              {previewName && previewName !== form.name && (
                <span className="cq-preview">Will be created as: <code>{previewName}</code></span>
              )}
            </Field>

            <Field label="FIFO queue">
              <label className="cq-toggle">
                <input
                  type="checkbox"
                  checked={form.fifo}
                  onChange={(e) => set('fifo', e.target.checked)}
                />
                <span>Enable FIFO (exactly-once ordering)</span>
              </label>
            </Field>

            <div className="cq-grid">
              <Field label="Visibility timeout" hint="seconds">
                <input
                  className="cq-input"
                  type="number"
                  min={0} max={43200}
                  value={form.visibilityTimeout}
                  onChange={(e) => set('visibilityTimeout', Number(e.target.value))}
                />
              </Field>

              <Field label="Message retention" hint="seconds">
                <input
                  className="cq-input"
                  type="number"
                  min={60} max={1209600}
                  value={form.retentionPeriod}
                  onChange={(e) => set('retentionPeriod', Number(e.target.value))}
                />
                <span className="cq-preview">{(form.retentionPeriod / 86400).toFixed(1)} days</span>
              </Field>

              <Field label="Max message size" hint="bytes">
                <input
                  className="cq-input"
                  type="number"
                  min={1024} max={262144}
                  value={form.maxMessageSize}
                  onChange={(e) => set('maxMessageSize', Number(e.target.value))}
                />
                <span className="cq-preview">{(form.maxMessageSize / 1024).toFixed(0)} KB</span>
              </Field>

              <Field label="Delay" hint="seconds">
                <input
                  className="cq-input"
                  type="number"
                  min={0} max={900}
                  value={form.delaySeconds}
                  onChange={(e) => set('delaySeconds', Number(e.target.value))}
                />
              </Field>

              <Field label="Long-poll wait" hint="seconds">
                <input
                  className="cq-input"
                  type="number"
                  min={0} max={20}
                  value={form.receiveWaitTime}
                  onChange={(e) => set('receiveWaitTime', Number(e.target.value))}
                />
              </Field>
            </div>

            {error && <div className="cq-error">{error}</div>}

            <div className="cq-footer">
              <button type="button" className="cq-btn-cancel" onClick={onClose}>Cancel</button>
              <button type="submit" className="cq-btn-create" disabled={busy || !form.name.trim()}>
                {busy ? 'Creating…' : 'Create Queue'}
              </button>
            </div>
          </form>
        )}

        {tab === 'defaults' && (
          <div className="cq-defaults">
            <p className="cq-defaults-hint">Select the queues to create with default settings.</p>

            <ul className="cq-preset-list">
              {PRESET_QUEUES.map((name) => {
                const st = statuses[name]
                return (
                  <li key={name} className="cq-preset-item">
                    <label className="cq-preset-label">
                      <input
                        type="checkbox"
                        checked={selected.has(name)}
                        onChange={() => toggleQueue(name)}
                        disabled={defaultsBusy || !!st}
                      />
                      <code className="cq-preset-name">{name}</code>
                    </label>
                    {st?.status === 'creating' && <span className="cq-preset-status creating">Creating…</span>}
                    {st?.status === 'done' && <span className="cq-preset-status done">✓ Created</span>}
                    {st?.status === 'error' && (
                      <span className="cq-preset-status err" title={st.error}>✕ Failed</span>
                    )}
                  </li>
                )
              })}
            </ul>

            {Object.values(statuses).some((s) => s.status === 'error') && (
              <div className="cq-error">
                Some queues failed to create. They may already exist.
              </div>
            )}

            <div className="cq-footer">
              <button type="button" className="cq-btn-cancel" onClick={onClose}>
                {allDone ? 'Close' : 'Cancel'}
              </button>
              {!allDone && (
                <button
                  className="cq-btn-create"
                  onClick={createDefaults}
                  disabled={defaultsBusy || selected.size === 0}
                >
                  {defaultsBusy ? 'Creating…' : `Create ${selected.size} Queue${selected.size !== 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
