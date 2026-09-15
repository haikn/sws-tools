import { useEffect, useState } from 'react'
import {
  fetchQueueDetails,
  purgeQueue,
  deleteQueue,
  deleteMessage,
  recreateQueue,
} from './sqs'
import type { QueueDetails, QueueInfo } from './sqs'
import './QueueDetail.css'

const ATTR_LABELS: Record<string, string> = {
  QueueArn: 'ARN',
  VisibilityTimeout: 'Visibility Timeout',
  MaximumMessageSize: 'Max Message Size',
  MessageRetentionPeriod: 'Retention Period',
  DelaySeconds: 'Delay',
  ReceiveMessageWaitTimeSeconds: 'Long Poll Wait',
  CreatedTimestamp: 'Created',
  LastModifiedTimestamp: 'Last Modified',
  ApproximateNumberOfMessages: 'Visible Messages',
  ApproximateNumberOfMessagesNotVisible: 'In-Flight Messages',
  ApproximateNumberOfMessagesDelayed: 'Delayed Messages',
  SqsManagedSseEnabled: 'SSE Enabled',
}

function formatAttrValue(key: string, value: string): string {
  if (key.endsWith('Timestamp')) return new Date(parseInt(value) * 1000).toLocaleString()
  if (key === 'MaximumMessageSize') return `${(parseInt(value) / 1024).toFixed(0)} KB`
  if (key === 'MessageRetentionPeriod') {
    const days = parseInt(value) / 86400
    return `${days} day${days !== 1 ? 's' : ''}`
  }
  if (key.endsWith('Seconds') || key === 'VisibilityTimeout') return `${value}s`
  if (value === 'true') return 'Yes'
  if (value === 'false') return 'No'
  return value
}

const ATTR_ORDER = [
  'QueueArn',
  'ApproximateNumberOfMessages',
  'ApproximateNumberOfMessagesNotVisible',
  'ApproximateNumberOfMessagesDelayed',
  'VisibilityTimeout',
  'MessageRetentionPeriod',
  'MaximumMessageSize',
  'DelaySeconds',
  'ReceiveMessageWaitTimeSeconds',
  'SqsManagedSseEnabled',
  'CreatedTimestamp',
  'LastModifiedTimestamp',
]

type ConfirmAction = {
  title: string
  description: string
  label: string
  danger?: boolean
  onConfirm: () => Promise<void>
}

interface Props {
  queue: QueueInfo
  onBack: () => void
  onDeleted: () => void
}

export default function QueueDetail({ queue, onBack, onDeleted }: Props) {
  const [details, setDetails] = useState<QueueDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadKey, setLoadKey] = useState(0)
  const [completedKey, setCompletedKey] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [expandedMsg, setExpandedMsg] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const loading = completedKey < loadKey

  function load() {
    setLoadKey((k) => k + 1)
  }

  useEffect(() => {
    let cancelled = false
    fetchQueueDetails(queue.url)
      .then((data) => {
        if (cancelled) return
        setSelectedIds(new Set())
        setDetails(data)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (cancelled) return
        setCompletedKey(loadKey)
      })
    return () => { cancelled = true }
  }, [loadKey, queue.url])

  function ask(action: ConfirmAction) {
    setConfirm(action)
  }

  async function runConfirmed() {
    if (!confirm) return
    setBusy(true)
    setConfirm(null)
    try {
      await confirm.onConfirm()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else { next.add(id) }
      return next
    })
  }

  function toggleAll() {
    if (!details) return
    if (selectedIds.size === details.messages.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(details.messages.map((m) => m.messageId)))
    }
  }

  const sortedAttrs = details
    ? [
        ...ATTR_ORDER.filter((k) => k in details.attributes),
        ...Object.keys(details.attributes).filter((k) => !ATTR_ORDER.includes(k)),
      ]
    : []

  const allSelected = !!details && details.messages.length > 0 && selectedIds.size === details.messages.length

  return (
    <div className="detail">

      {/* Confirmation dialog */}
      {confirm && (
        <div className="confirm-overlay" onClick={() => setConfirm(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{confirm.title}</h3>
            <p>{confirm.description}</p>
            <div className="confirm-actions">
              <button className="btn-secondary" onClick={() => setConfirm(null)}>Cancel</button>
              <button
                className={`btn-action ${confirm.danger ? 'danger' : 'primary'}`}
                onClick={runConfirmed}
              >
                {confirm.label}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="detail-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <div className="detail-title">
          <code>{queue.name}</code>
          {queue.isDlq && <span className="badge warning">DLQ</span>}
          {queue.isFifo && <span className="badge fifo">FIFO</span>}
        </div>
        <div className="detail-actions">
          <button
            className="btn-action"
            disabled={busy || loading}
            onClick={() => ask({
              title: 'Purge queue?',
              description: `All messages in "${queue.name}" will be permanently deleted. This cannot be undone.`,
              label: 'Purge',
              danger: true,
              onConfirm: async () => { await purgeQueue(queue.url); load() },
            })}
          >
            Purge
          </button>
          <button
            className="btn-action"
            disabled={busy || loading}
            onClick={() => ask({
              title: 'Re-create queue?',
              description: `"${queue.name}" will be deleted and immediately re-created with the same configuration. All messages will be lost.`,
              label: 'Re-create',
              danger: true,
              onConfirm: async () => {
                await recreateQueue(queue.name, queue.url, details?.attributes ?? {})
                onDeleted()
              },
            })}
          >
            Re-create
          </button>
          <button
            className="btn-action danger"
            disabled={busy || loading}
            onClick={() => ask({
              title: 'Delete queue?',
              description: `"${queue.name}" and all its messages will be permanently deleted.`,
              label: 'Delete',
              danger: true,
              onConfirm: async () => { await deleteQueue(queue.url); onDeleted() },
            })}
          >
            Delete
          </button>
        </div>
        <button className="btn-refresh" onClick={load} disabled={loading || busy}>
          {loading ? '⟳' : '↻'} Refresh
        </button>
      </div>

      {error && <div className="alert error"><strong>Error</strong><p>{error}</p></div>}

      {details && (
        <>
          <section className="detail-section">
            <h2>Attributes</h2>
            <table className="attrs-table">
              <tbody>
                {sortedAttrs.map((key) => (
                  <tr key={key}>
                    <td className="attr-name">{ATTR_LABELS[key] ?? key}</td>
                    <td className="attr-value">{formatAttrValue(key, details.attributes[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="detail-section">
            <div className="section-heading">
              <h2>
                Messages
                <span className="section-note">(peek — up to 10, not consumed)</span>
              </h2>
              {selectedIds.size > 0 && (
                <button
                  className="btn-action danger"
                  disabled={busy}
                  onClick={() => ask({
                    title: `Delete ${selectedIds.size} message${selectedIds.size > 1 ? 's' : ''}?`,
                    description: 'Selected messages will be permanently deleted from the queue.',
                    label: `Delete ${selectedIds.size}`,
                    danger: true,
                    onConfirm: async () => {
                      const toDelete = details.messages.filter((m) => selectedIds.has(m.messageId))
                      await Promise.all(toDelete.map((m) => deleteMessage(queue.url, m.receiptHandle)))
                      load()
                    },
                  })}
                >
                  Delete selected ({selectedIds.size})
                </button>
              )}
            </div>

            {details.messages.length === 0 ? (
              <div className="alert info">Queue is empty.</div>
            ) : (
              <>
                <label className="select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                  Select all
                </label>
                <div className="messages-list">
                  {details.messages.map((msg) => (
                    <div
                      key={msg.messageId}
                      className={`message-card${expandedMsg === msg.messageId ? ' expanded' : ''}${selectedIds.has(msg.messageId) ? ' selected' : ''}`}
                      onClick={() => setExpandedMsg(expandedMsg === msg.messageId ? null : msg.messageId)}
                    >
                      <div
                        className="message-header"
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(msg.messageId)}
                          onChange={() => toggleSelect(msg.messageId)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <span className="message-id">{msg.messageId}</span>
                        {msg.sentAt && (
                          <span className="message-ts">{msg.sentAt.toLocaleString()}</span>
                        )}
                        <button
                          className="btn-msg-delete"
                          title="Delete message"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation()
                            ask({
                              title: 'Delete message?',
                              description: `Message ${msg.messageId} will be permanently deleted.`,
                              label: 'Delete',
                              danger: true,
                              onConfirm: async () => {
                                await deleteMessage(queue.url, msg.receiptHandle)
                                load()
                              },
                            })
                          }}
                        >
                          ✕
                        </button>
                        <span className="message-chevron">{expandedMsg === msg.messageId ? '▲' : '▼'}</span>
                      </div>
                      <div className="message-body-preview">
                        {msg.body.length > 120 && expandedMsg !== msg.messageId
                          ? msg.body.slice(0, 120) + '…'
                          : msg.body}
                      </div>
                      {expandedMsg === msg.messageId && Object.keys(msg.messageAttributes).length > 0 && (
                        <div className="message-attrs">
                          <strong>Message Attributes</strong>
                          <table className="attrs-table">
                            <tbody>
                              {Object.entries(msg.messageAttributes).map(([k, v]) => (
                                <tr key={k}>
                                  <td className="attr-name">{k}</td>
                                  <td className="attr-value">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
