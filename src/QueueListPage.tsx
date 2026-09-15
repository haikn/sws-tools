import { useEffect, useRef, useState } from 'react'
import { fetchQueues, setRegion, getRegion } from './sqs'
import { getSettings } from './store'
import type { QueueInfo } from './sqs'
import QueueDetail from './QueueDetail'
import CreateQueueModal from './CreateQueueModal'
import SendMessageModal from './SendMessageModal'
import SendModeModal from './SendModeModal'
import LoadTestModal from './LoadTestModal'
import './QueueListPage.css'

const REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'ap-south-1',
  'sa-east-1', 'ca-central-1',
]

type LiveStatus = 'connecting' | 'live' | 'disconnected'

interface Props {
  settingsVersion: number
}

export default function QueueListPage({ settingsVersion }: Props) {
  const [queues, setQueues] = useState<QueueInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [initialLoad, setInitialLoad] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('connecting')
  const [selectedQueue, setSelectedQueue] = useState<QueueInfo | null>(null)
  const [region, setRegionState] = useState(getRegion())
  const [showCreate, setShowCreate] = useState(false)
  const [sendMode, setSendMode] = useState<null | 'mode' | 'single' | 'load'>(null)
  const [paused, setPaused] = useState(false)

  const pausedRef = useRef(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  function copyUrl(e: React.MouseEvent, url: string) {
    e.stopPropagation()
    navigator.clipboard.writeText(url).then(() => {
      setCopiedUrl(url)
      setTimeout(() => setCopiedUrl((cur) => (cur === url ? null : cur)), 1500)
    })
  }

  // ── Manual refresh ────────────────────────────────────────────────────────
  async function refresh() {
    setRefreshing(true)
    try {
      const data = await fetchQueues()
      setQueues(data)
      setLastRefresh(new Date())
      setError(null)
      setInitialLoad(false)
      setLiveStatus('live')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLiveStatus('disconnected')
    } finally {
      setRefreshing(false)
    }
  }

  function changeRegion(r: string) {
    setRegion(r)
    setRegionState(r)
    refresh()
  }

  function togglePause() {
    setPaused((p) => {
      pausedRef.current = !p
      return !p
    })
  }

  // ── Polling interval — fetch on mount, then every refreshSeconds ──────────
  useEffect(() => {
    let active = true
    if (settingsVersion > 0) {
      const s = getSettings()
      Promise.resolve().then(() => {
        if (!active) return
        setRegion(s.defaultRegion)
        setRegionState(s.defaultRegion)
      })
    }

    void Promise.resolve().then(() => {
      if (active) return refresh()
      return undefined
    })

    const intervalMs = getSettings().refreshSeconds * 1000
    const timer = setInterval(() => {
      if (!pausedRef.current) refresh()
    }, intervalMs)

    return () => {
      active = false
      clearInterval(timer)
    }
  }, [settingsVersion])

  // ── Queue detail view ──────────────────────────────────────────────────────
  if (selectedQueue) {
    return (
      <QueueDetail
        queue={selectedQueue}
        onBack={() => setSelectedQueue(null)}
        onDeleted={() => { setSelectedQueue(null); refresh() }}
      />
    )
  }

  const totalVisible = queues.reduce((s, q) => s + q.visible, 0)

  return (
    <div className="ql-page">
      {showCreate && (
        <CreateQueueModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh() }}
        />
      )}
      {sendMode === 'mode' && (
        <SendModeModal
          onSingle={() => setSendMode('single')}
          onLoadTest={() => setSendMode('load')}
          onClose={() => setSendMode(null)}
        />
      )}
      {sendMode === 'single' && (
        <SendMessageModal
          queues={queues}
          onClose={() => setSendMode(null)}
        />
      )}
      {sendMode === 'load' && (
        <LoadTestModal
          queues={queues}
          onClose={() => setSendMode(null)}
        />
      )}

      <header className="ql-header">
        <div className="ql-header-left">
          <select
            className="ql-region-select"
            value={region}
            onChange={(e) => changeRegion(e.target.value)}
          >
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <span className="badge neutral">{queues.length} queues</span>
          {totalVisible > 0 && (
            <span className="badge danger">{totalVisible} messages</span>
          )}
        </div>

        <div className="ql-header-right">
          {/* Live status indicator */}
          <span className={`ql-live-badge ql-live-badge--${liveStatus}`}>
            <span className="ql-live-dot" />
            {liveStatus === 'connecting' && 'Connecting…'}
            {liveStatus === 'live' && (paused ? `Paused · ${lastRefresh?.toLocaleTimeString()}` : 'Live')}
            {liveStatus === 'disconnected' && 'Disconnected'}
          </span>

          <label className="ql-pause-toggle">
            <input type="checkbox" checked={paused} onChange={togglePause} />
            Pause
          </label>

          <button
            className="btn-send"
            onClick={() => setSendMode('mode')}
            disabled={queues.length === 0}
          >
            &#9658; Send Message
          </button>
          <button className="btn-create" onClick={() => setShowCreate(true)}>
            + New Queue
          </button>
          <button className="btn-refresh" onClick={refresh} disabled={refreshing}>
            {refreshing ? '⟳' : '↻'} Refresh
          </button>
        </div>
      </header>

      <div className="ql-body">
        {error && (
          <div className="alert error">
            <strong>Cannot reach LocalStack</strong>
            <p>{error}</p>
          </div>
        )}

        {!error && initialLoad && (
          <div className="ql-loading">Connecting to LocalStack…</div>
        )}

        {!error && !initialLoad && queues.length === 0 && (
          <div className="alert info">No queues found in LocalStack.</div>
        )}

        {queues.length > 0 && (
          <table className="queue-table">
            <thead>
              <tr>
                <th>Queue Name</th>
                <th>Visible</th>
                <th>In-Flight</th>
                <th>Delayed</th>
                <th>Type</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr
                  key={q.url}
                  className={`row-clickable${q.isDlq ? ' row-dlq' : ''}`}
                  onClick={() => setSelectedQueue(q)}
                >
                  <td className="queue-name">
                    <code>{q.name}</code>
                    {q.isDlq && <span className="badge warning">DLQ</span>}
                  </td>
                  <td className="col-count">
                    {q.visible > 0
                      ? <span className="badge danger">{q.visible}</span>
                      : <span className="zero">0</span>}
                  </td>
                  <td className="col-count">
                    {q.inFlight > 0
                      ? <span className="badge warning">{q.inFlight}</span>
                      : <span className="zero">0</span>}
                  </td>
                  <td className="col-count">
                    {q.delayed > 0
                      ? <span className="badge info">{q.delayed}</span>
                      : <span className="zero">0</span>}
                  </td>
                  <td className="col-count">
                    <span className={`badge ${q.isFifo ? 'fifo' : 'neutral'}`}>
                      {q.isFifo ? 'FIFO' : 'Standard'}
                    </span>
                  </td>
                  <td className="col-copy">
                    <button
                      className={`btn-copy-url${copiedUrl === q.url ? ' btn-copy-url--copied' : ''}`}
                      onClick={(e) => copyUrl(e, q.url)}
                      title={q.url}
                    >
                      {copiedUrl === q.url ? '✓ Copied' : 'Copy URL'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
