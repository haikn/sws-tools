import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { ExtensionSettingsService } from './extensionSettings.js'
import { PostgresService } from './postgresService.js'
import { DynamoService } from './dynamoService.js'
import { SqsService } from './sqsService.js'
import { validateBackendMessage, validateEditorPage } from './requestValidation.js'

const VIEW_ID = 'swsMonitor.view'

const TOOL_ITEMS = [
  { page: 'main', label: 'SQS Queues', icon: 'list-tree' },
  { page: 'dynamodb', label: 'DynamoDB', icon: 'database' },
  { page: 'postgres', label: 'PostgreSQL', icon: 'table' },
  { page: 'decode-token', label: 'Decode Token', icon: 'key' },
  { page: 'format-json', label: 'Format JSON', icon: 'bracket' },
  { page: 'templates', label: 'JSON Templates', icon: 'file-code' },
  { page: 'settings', label: 'Settings', icon: 'settings-gear' },
  { page: 'about', label: 'About', icon: 'info' },
] as const

interface BackendRequest {
  requestId: string
  type: 'backend.request' | 'open.editor'
  path?: string
  body?: Record<string, unknown>
  page?: string
}

class SqsMonitorViewProvider implements vscode.WebviewViewProvider {
  private editorPanel: vscode.WebviewPanel | undefined
  private reloadTimer: ReturnType<typeof setTimeout> | undefined
  private readonly settings: ExtensionSettingsService
  private readonly postgres: PostgresService
  private readonly dynamo: DynamoService
  private readonly sqs: SqsService

  constructor(private readonly extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
    this.settings = new ExtensionSettingsService(context)
    this.postgres = new PostgresService(this.settings)
    this.dynamo = new DynamoService(this.settings)
    this.sqs = new SqsService(this.settings)
    const distWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(extensionUri, 'dist/**/*'))
    const reload = () => {
      if (this.reloadTimer) clearTimeout(this.reloadTimer)
      this.reloadTimer = setTimeout(() => {
        this.reloadTimer = undefined
        this.editorPanel?.webview.postMessage({ type: 'reload' })
      }, 250)
    }
    distWatcher.onDidChange(reload, undefined, context.subscriptions)
    distWatcher.onDidCreate(reload, undefined, context.subscriptions)
    distWatcher.onDidDelete(reload, undefined, context.subscriptions)
    context.subscriptions.push(distWatcher)
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    }
    webviewView.webview.onDidReceiveMessage((message: BackendRequest) => {
      const validation = validateBackendMessage(message)
      if (validation.ok) void this.handleBackendRequest(webviewView.webview, { ...message, requestId: validation.requestId, path: validation.path, body: validation.body })
      else if (typeof message.requestId === 'string') webviewView.webview.postMessage({ requestId: message.requestId, ok: false, error: validation.error })
      if (message.type === 'open.editor' && validateEditorPage(message.page)) this.openEditorPage(message.page)
    }, undefined, [])
    webviewView.webview.html = this.getHtml(webviewView.webview, undefined, 'sidebar')
  }

  openEditorPage(page: string): void {
    if (this.editorPanel) {
      this.editorPanel.reveal(vscode.ViewColumn.One)
      void this.editorPanel.webview.postMessage({ type: 'navigate', page })
      return
    }

    this.editorPanel = vscode.window.createWebviewPanel('swsMonitor.detail', 'SWS Tools', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    })
    this.editorPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
    }
    this.editorPanel.webview.onDidReceiveMessage((message: BackendRequest) => {
      const validation = validateBackendMessage(message)
      if (validation.ok) void this.handleBackendRequest(this.editorPanel!.webview, { ...message, requestId: validation.requestId, path: validation.path, body: validation.body })
      else if (typeof message.requestId === 'string') this.editorPanel!.webview.postMessage({ requestId: message.requestId, ok: false, error: validation.error })
    }, undefined, [])
    this.editorPanel.onDidDispose(() => { this.editorPanel = undefined }, undefined, [])
    this.editorPanel.webview.html = this.getHtml(this.editorPanel.webview, page, 'editor')
  }

  private async handleBackendRequest(webview: vscode.Webview, request: BackendRequest): Promise<void> {
    try {
      if (request.path === '/_postgres' && request.body) {
        webview.postMessage({ requestId: request.requestId, ok: true, data: await this.postgres.execute(request.body) })
        return
      }
      if (request.path === '/_dynamodb' && request.body) {
        webview.postMessage({ requestId: request.requestId, ok: true, data: await this.dynamo.execute(request.body) })
        return
      }
      if (request.path === '/_sqs' && request.body) {
        webview.postMessage({ requestId: request.requestId, ok: true, data: await this.sqs.execute(request.body) })
        return
      }
    if (request.path === '/_extension_settings') {
      if (request.body?.action === 'get') {
        webview.postMessage({ requestId: request.requestId, ok: true, data: await this.settings.read() })
        return
      }
      if (request.body?.action === 'setPostgresPassword' && typeof request.body.password === 'string') {
        await this.settings.setPostgresPassword(request.body.password)
        webview.postMessage({ requestId: request.requestId, ok: true, data: { saved: true } })
        return
      }
      if (request.body?.action === 'setPostgresDatabase' && typeof request.body.database === 'string') {
        await vscode.workspace.getConfiguration('swsMonitor').update('postgres.database', request.body.database, vscode.ConfigurationTarget.Global)
        webview.postMessage({ requestId: request.requestId, ok: true, data: { saved: true } })
        return
      }
      if (request.body?.action === 'clearPostgresPassword') {
        await this.settings.clearPostgresPassword()
        webview.postMessage({ requestId: request.requestId, ok: true, data: { cleared: true } })
        return
      }
    }
    webview.postMessage({
      requestId: request.requestId,
      ok: false,
      error: `Extension backend is not implemented yet for ${request.path}. Phase 5 will connect this request to the database service.`,
    })
    } catch (error) {
      webview.postMessage({
        requestId: request.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async dispose(): Promise<void> {
    if (this.reloadTimer) clearTimeout(this.reloadTimer)
    await this.postgres.dispose()
    this.dynamo.dispose()
    this.sqs.dispose()
  }

  private getHtml(webview: vscode.Webview, initialPage?: string, surface: 'sidebar' | 'editor' = 'editor'): string {
    const indexPath = path.join(this.extensionUri.fsPath, 'dist', 'index.html')
    let html = fs.readFileSync(indexPath, 'utf8')
    const resourceUri = (relativePath: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', relativePath)).toString()

    html = html.replace(/(src|href)="\.\/([^"#?]+)"/g, (_match, attribute: string, relativePath: string) => `${attribute}="${resourceUri(relativePath)}"`)
    const nonce = createNonce()
    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">`)
    html = html.replace('<head>', `<head><script nonce="${nonce}">document.documentElement.classList.add('sws-vscode-webview');document.body?.classList.add('sws-vscode-webview');window.__SWS_SURFACE__=${JSON.stringify(surface)};</script>`)
    if (initialPage) html = html.replace('<head>', `<head><script nonce="${nonce}">window.__SWS_INITIAL_PAGE__=${JSON.stringify(initialPage)};</script>`)
    html = html.replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`)
    return html
  }
}

class SqsMonitorTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item }

  getChildren(): vscode.TreeItem[] {
    return TOOL_ITEMS.map((tool) => {
      const item = new vscode.TreeItem(tool.label, vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon(tool.icon)
      item.command = { command: 'swsMonitor.openPage', title: `Open ${tool.label}`, arguments: [tool.page] }
      return item
    })
  }
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new SqsMonitorViewProvider(context.extensionUri, context)
  context.subscriptions.push(vscode.window.registerTreeDataProvider(VIEW_ID, new SqsMonitorTreeProvider()))
  context.subscriptions.push({ dispose: () => { void provider.dispose() } })

  const commands = [
    vscode.commands.registerCommand('swsMonitor.open', () => provider.openEditorPage('main')),
    vscode.commands.registerCommand('swsMonitor.openPostgres', () => provider.openEditorPage('postgres')),
    vscode.commands.registerCommand('swsMonitor.openDynamoDB', () => provider.openEditorPage('dynamodb')),
    vscode.commands.registerCommand('swsMonitor.openSqs', () => provider.openEditorPage('main')),
    vscode.commands.registerCommand('swsMonitor.openPage', (page: string) => provider.openEditorPage(page)),
  ]
  context.subscriptions.push(...commands)
}

export function deactivate(): void {}
