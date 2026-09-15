import { describe, expect, it } from 'vitest'
import { validateBackendMessage, validateEditorPage } from './requestValidation'

describe('webview request validation', () => {
  it('rejects unknown paths and actions', () => {
    expect(validateBackendMessage({ type: 'backend.request', requestId: 'request-1234', path: '/_unknown', body: { action: 'run' } }).ok).toBe(false)
    expect(validateBackendMessage({ type: 'backend.request', requestId: 'request-1234', path: '/_postgres', body: { action: 'shell' } }).ok).toBe(false)
  })

  it('rejects malformed SQL requests before database execution', () => {
    expect(validateBackendMessage({ type: 'backend.request', requestId: 'request-1234', path: '/_postgres', body: { action: 'executeQuery', sql: '' } }).ok).toBe(false)
    expect(validateBackendMessage({ type: 'backend.request', requestId: 'request-1234', path: '/_postgres', body: { action: 'executeQuery', sql: 'SELECT 1' } }).ok).toBe(true)
  })

  it('allows only known editor pages', () => {
    expect(validateEditorPage('postgres')).toBe(true)
    expect(validateEditorPage('settings')).toBe(true)
    expect(validateEditorPage('javascript:alert(1)')).toBe(false)
    expect(validateEditorPage('__proto__')).toBe(false)
  })
})
