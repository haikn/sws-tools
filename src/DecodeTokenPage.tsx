import { useState } from 'react'
import JsonHighlight from './JsonHighlight'
import './DecodeTokenPage.css'

interface DecodedToken {
  header: unknown
  payload: unknown
}

type TokenView = 'decoded' | 'claims'

const CLAIM_DESCRIPTIONS: Record<string, string> = {
  iss: 'Registered JWT claim. Identifies the principal that issued this token. A relying application commonly compares it with a trusted issuer URL before accepting the token.',
  sub: 'Registered JWT claim. A locally unique identifier for the subject represented by this token. Its meaning and stability are defined by the issuer.',
  aud: 'Registered JWT claim. Identifies the recipient this token is intended for. A service should only accept a token when its own identifier appears in this value.',
  exp: 'Registered JWT claim. A NumericDate defining when the token expires. A recipient must reject the token on or after this time, allowing only any configured clock skew.',
  nbf: 'Registered JWT claim. A NumericDate before which the token must not be accepted. It prevents the token from being used before its intended validity window.',
  iat: 'Registered JWT claim. A NumericDate indicating when the token was issued. It can help assess token age but does not, by itself, define when the token expires.',
  jti: 'Registered JWT claim. A case-sensitive identifier for this individual token. Issuers and recipients can use it to detect replay or correlate token events.',
  name: 'OpenID Connect standard claim. The end user display name intended for presentation, not a durable authorization identifier.',
  email: 'OpenID Connect standard claim. The end user preferred email address. Its presence does not guarantee that the address has been verified unless the issuer provides a separate verification claim.',
  preferred_username: 'OpenID Connect standard claim. A human-readable username suitable for display or sign-in hints. Do not use it as a stable identifier because it can change.',
  given_name: 'OpenID Connect standard claim. The end user given name or first name.',
  family_name: 'OpenID Connect standard claim. The end user surname or last name.',
  middle_name: 'OpenID Connect standard claim. The end user middle name or names.',
  nickname: 'OpenID Connect standard claim. A casual name that may be used when displaying the end user.',
  picture: 'OpenID Connect standard claim. A URL to the end user profile picture.',
  locale: 'OpenID Connect standard claim. The end user locale, usually a language or language-region tag.',
  auth_time: 'OpenID Connect standard claim. A NumericDate for the time when the end user authenticated. It is commonly present when the client requested a maximum authentication age.',
  nonce: 'OpenID Connect standard claim. A value supplied by the client and returned in an ID token to help associate the token with the original authentication request.',
  acr: 'OpenID Connect standard claim. Authentication Context Class Reference: the authentication context or policy used for the sign-in.',
  amr: 'OpenID Connect standard claim. Authentication Methods References: the methods used to authenticate the end user, such as password or multi-factor authentication.',
  oid: 'Microsoft Entra ID claim. Immutable object identifier of the user or service principal in the tenant. Together with tid, it is a reliable identity key for directory objects.',
  tid: 'Microsoft Entra ID claim. Immutable tenant identifier for the Microsoft Entra ID directory that issued the token.',
  azp: 'OpenID Connect authorized-party claim. Identifies the client application that requested the token when it differs from the token audience.',
  appid: 'Microsoft Entra ID claim. The application (client) ID of the app that requested the token. Newer Entra token versions commonly use azp instead.',
  app_displayname: 'Microsoft Entra ID claim. Human-readable display name of the client application that requested the token.',
  scp: 'Microsoft Entra ID delegated-permissions claim. A space-delimited list of OAuth scopes granted to the client on behalf of the signed-in user.',
  roles: 'Microsoft Entra ID application-roles claim. Roles assigned to the signed-in user or calling application for the target resource.',
  groups: 'Microsoft Entra ID claim. Object IDs of groups to which the signed-in user belongs. Large memberships can be represented by an overage indicator instead.',
  upn: 'Microsoft Entra ID claim. User principal name, generally a sign-in name in the form of an email-like identifier. It can change and is not a stable key.',
  unique_name: 'Microsoft Entra ID legacy claim. A human-readable name for the user, often a sign-in name; use oid and tid for durable identification.',
  ver: 'Microsoft Entra ID claim. Token version, which identifies the claim-set conventions used by the issuer.',
  uti: 'Microsoft Entra ID claim. Internal token identifier used by Microsoft services for diagnostics and correlation.',
  xms_mirid: 'Microsoft Entra ID claim. Azure Resource Manager identifier of the managed identity associated with the token, when applicable.',
}

function formatClaimValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

function formatTimestamp(value: unknown): string | null {
  if (typeof value !== 'number') return null
  const date = new Date(value * 1000)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString()
}

function decodeSegment(segment: string): unknown {
  if (!segment || !/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new Error('Token segments must be Base64URL encoded.')
  }

  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(base64 + padding)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

function decodeToken(token: string): DecodedToken {
  const segments = token.trim().split('.')
  if (segments.length < 2) {
    throw new Error('Enter a JWT with header and payload segments separated by periods.')
  }

  return {
    header: decodeSegment(segments[0]),
    payload: decodeSegment(segments[1]),
  }
}

export default function DecodeTokenPage() {
  const [token, setToken] = useState('')
  const [decoded, setDecoded] = useState<DecodedToken | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<TokenView>('decoded')

  function handleTokenChange(value: string) {
    setToken(value)

    if (!value.trim()) {
      setDecoded(null)
      setError(null)
      return
    }

    try {
      setDecoded(decodeToken(value))
      setError(null)
    } catch (decodeError) {
      setDecoded(null)
      setError(decodeError instanceof Error ? decodeError.message : 'Unable to decode this token.')
    }
  }

  const claims = decoded && decoded.payload && typeof decoded.payload === 'object' && !Array.isArray(decoded.payload)
    ? Object.entries(decoded.payload as Record<string, unknown>)
    : []

  return (
    <div className="dt-page">
      <header className="dt-header">
        <div>
          <h1>Decode Token</h1>
          <p>Paste a JSON Web Token to inspect its header and claims.</p>
        </div>
      </header>

      <section className="dt-input-section" aria-label="JWT token input">
        <div className="dt-label-row">
          <label htmlFor="jwt-token">Encoded token</label>
          <button className="dt-clear" type="button" onClick={() => handleTokenChange('')} disabled={!token}>
            Clear
          </button>
        </div>
        <textarea
          id="jwt-token"
          className={`dt-textarea${error ? ' dt-textarea--error' : ''}`}
          value={token}
          onChange={(event) => handleTokenChange(event.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.signature"
          rows={6}
          spellCheck={false}
          autoComplete="off"
        />
        {error && <p className="dt-error" role="alert">{error}</p>}
      </section>

      {decoded ? (
        <>
          <div className="dt-tabs" role="tablist" aria-label="Decoded token views">
            <button className={`dt-tab${view === 'decoded' ? ' dt-tab--active' : ''}`} type="button" role="tab" aria-selected={view === 'decoded'} onClick={() => setView('decoded')}>
              Decoded Token
            </button>
            <button className={`dt-tab${view === 'claims' ? ' dt-tab--active' : ''}`} type="button" role="tab" aria-selected={view === 'claims'} onClick={() => setView('claims')}>
              Claims
            </button>
          </div>

          {view === 'decoded' ? (
            <div className="dt-panels">
              <section className="dt-panel" aria-labelledby="decoded-header">
                <h2 id="decoded-header">Header</h2>
                <JsonHighlight json={JSON.stringify(decoded.header, null, 2)} />
              </section>
              <section className="dt-panel" aria-labelledby="decoded-payload">
                <h2 id="decoded-payload">Payload</h2>
                <JsonHighlight json={JSON.stringify(decoded.payload, null, 2)} />
              </section>
            </div>
          ) : (
            <section className="dt-claims" aria-label="Decoded token claims">
              {claims.map(([name, value]) => {
                const timestamp = ['exp', 'nbf', 'iat'].includes(name) ? formatTimestamp(value) : null
                return (
                  <article className="dt-claim" key={name}>
                    <div className="dt-claim-heading">
                      <code>{name}</code>
                      <span>{CLAIM_DESCRIPTIONS[name] ?? 'Custom claim supplied by the token issuer.'}</span>
                    </div>
                    <div className="dt-claim-value">{formatClaimValue(value)}</div>
                    {timestamp && <div className="dt-claim-timestamp">{timestamp}</div>}
                  </article>
                )
              })}
            </section>
          )}
        </>
      ) : !error && !token.trim() && (
        <div className="dt-empty">Decoded header and payload will appear here.</div>
      )}
    </div>
  )
}