import { useEffect, useState } from 'react'
import Layout from './Layout'
import type { Page } from './Layout'
import QueueListPage from './QueueListPage'
import SettingsPage from './SettingsPage'
import TemplatesPage from './TemplatesPage'
import AboutPage from './AboutPage'
import DecodeTokenPage from './DecodeTokenPage'
import FormatJsonPage from './FormatJsonPage'
import DynamoPage from './DynamoPage'
import PostgresPage from './PostgresPage'
import { getInitialPage, isExtensionWebview, isSidebarSurface, onEditorNavigation } from './platformApi'

export default function App() {
  const [page, setPage] = useState<Page>(() => getInitialPage<Page>('main'))
  const [settingsVersion, setSettingsVersion] = useState(0)

  useEffect(() => onEditorNavigation((nextPage) => {
    if (['main', 'dynamodb', 'postgres', 'decode-token', 'format-json', 'templates', 'settings', 'about'].includes(nextPage)) {
      setPage(nextPage as Page)
    }
  }), [])

  const sidebarOnly = isSidebarSurface()

  function pageContent() {
    if (page === 'main') return <QueueListPage settingsVersion={settingsVersion} />
    if (page === 'dynamodb') return <DynamoPage settingsVersion={settingsVersion} />
    if (page === 'postgres') return <PostgresPage />
    if (page === 'decode-token') return <DecodeTokenPage />
    if (page === 'format-json') return <FormatJsonPage />
    if (page === 'settings') return <SettingsPage onSaved={() => setSettingsVersion((v) => v + 1)} />
    if (page === 'templates') return <TemplatesPage />
    return <AboutPage />
  }

  if (!sidebarOnly && isExtensionWebview()) return <div className="extension-editor-surface">{pageContent()}</div>

  return (
    <Layout page={page} onNavigate={setPage}>
      {sidebarOnly ? <div className="sidebar-placeholder">Choose a tool to open it in the editor.</div> : pageContent()}
    </Layout>
  )
}
