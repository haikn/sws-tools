# SWS Tools

SWS Tools is a VS Code developer toolkit for working with local and AWS-compatible services.

## Features

- SQS queue and message management
- DynamoDB table browsing and record CRUD
- PostgreSQL table browsing, editing, queries, views, routines, indexes, and triggers
- JSON formatter with formatted and tree views
- JWT decoder with claim explanations
- VS Code light/dark theme support

## Development

Requirements: Node.js, VS Code, PostgreSQL when using PostgreSQL tools, and LocalStack for SQS/DynamoDB.

```powershell
npm install
npm test -- --run
npm run build
```

Press `F5` in VS Code to launch the Extension Development Host. The debug setup watches webview assets, so saved CSS and React changes reload the open editor view.

Configure connections through **SWS Tools: Settings**. PostgreSQL passwords are stored in VS Code SecretStorage when running as an extension.

## Package Locally

```powershell
npx @vscode/vsce package
code --install-extension sws-tools-0.1.0.vsix
```

## License

MIT © KHN
