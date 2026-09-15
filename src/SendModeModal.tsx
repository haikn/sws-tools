import './SendModeModal.css'

interface Props {
  onSingle: () => void
  onLoadTest: () => void
  onClose: () => void
}

export default function SendModeModal({ onSingle, onLoadTest, onClose }: Props) {
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="smode-overlay" onClick={handleOverlayClick}>
      <div className="smode-modal">
        <div className="smode-header">
          <h2>Send Message</h2>
          <button className="smode-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="smode-body">
          <p className="smode-subtitle">How do you want to send messages?</p>
          <div className="smode-options">
            <button className="smode-option" onClick={onSingle}>
              <span className="smode-option-icon">✉</span>
              <div className="smode-option-content">
                <div className="smode-option-title">Single Message</div>
                <div className="smode-option-desc">Send one message with a custom JSON body to a queue</div>
              </div>
              <span className="smode-option-arrow">›</span>
            </button>
            <button className="smode-option" onClick={onLoadTest}>
              <span className="smode-option-icon">⚡</span>
              <div className="smode-option-content">
                <div className="smode-option-title">Load Test</div>
                <div className="smode-option-desc">Send thousands of messages with randomized field values</div>
              </div>
              <span className="smode-option-arrow">›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
