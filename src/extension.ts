import * as vscode from 'vscode';
import { AgentRunner } from './providers/agentRunner';
import { runDocumentCommand } from './commands/document';
import { runExplainCommand } from './commands/explain';
import { runFixBugCommand } from './commands/fixBug';
import { runGenerateTestsCommand } from './commands/generateTests';
import { runOptimizeCommand } from './commands/optimize';
import { runRefactorCommand } from './commands/refactor';
import { ConfigService, MODELS, NIM_BASE_URL } from './config';
import { ContextBuilder } from './contextBuilder';
import { ModelRouter } from './modelRouter';
import { NimClient } from './nimClient';
import { ChatPanelProvider } from './providers/chatPanel';
import { NimDiagnosticFixCodeActionProvider, runDiagnosticFix } from './providers/diagnosticFixer';
import { NimInlineCompletionProvider } from './providers/inlineCompletion';
import { createDiffPreview, PendingDiff } from './utils/diffApplier';

let pendingDiff: PendingDiff | undefined;

function setStatus(statusItem: vscode.StatusBarItem, ok: boolean, message?: string): void {
  statusItem.text = '⚡ NIM';
  statusItem.color = ok
    ? new vscode.ThemeColor('charts.green')
    : new vscode.ThemeColor('charts.red');
  statusItem.tooltip = message ?? (ok ? 'NIM Coder connected' : 'NIM Coder error');
}

function getNonce(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function showWelcomeIfNeeded(
  context: vscode.ExtensionContext,
  config: ConfigService,
  output: vscode.OutputChannel,
  statusItem: vscode.StatusBarItem
): Promise<void> {
  const key = await config.getApiKey();
  if (key) {
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'nimcoder.welcome',
    'Welcome to NIM Coder',
    vscode.ViewColumn.Active,
    { enableScripts: true }
  );

  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `style-src ${panel.webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `img-src ${panel.webview.cspSource} https:`,
    `connect-src ${NIM_BASE_URL}`
  ].join('; ');

  panel.webview.html = `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>NIM Coder Setup</title>
<style>
body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); padding: 20px; }
button, input, select { width: 100%; margin-top: 8px; padding: 10px; border-radius: 6px; border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
a { color: var(--vscode-textLink-foreground); }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 10px; padding: 16px; }
</style>
</head>
<body>
  <div class="card">
    <h2>Welcome to NIM Coder</h2>
    <p>Step 1: Get your free NVIDIA NIM API key at <a href="https://build.nvidia.com">build.nvidia.com</a>.</p>
    <p>Step 2: Paste API key.</p>
    <input id="key" placeholder="nvapi-..." />
    <p>Step 3: Pick your default chat model.</p>
    <select id="model">
      <option value="qwen/qwen3-coder-480b-a35b-instruct">qwen3 coder 480b</option>
      <option value="deepseek-ai/deepseek-v4-flash">deepseek v4 flash</option>
      <option value="qwen/qwen3-235b-a22b-instruct">qwen3 235b</option>
      <option value="mistralai/devstral-small">devstral small</option>
    </select>
    <button id="save">Save API Key</button>
    <button id="test">Test Connection</button>
    <p id="status"></p>
    <p><a href="https://build.nvidia.com/models">Open model catalog</a></p>
  </div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const status = document.getElementById('status');
document.getElementById('save').addEventListener('click', () => {
  vscode.postMessage({ type: 'saveKey', key: document.getElementById('key').value, model: document.getElementById('model').value });
});
document.getElementById('test').addEventListener('click', () => {
  vscode.postMessage({ type: 'testKey', key: document.getElementById('key').value, model: document.getElementById('model').value });
});
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'status') {
    status.textContent = msg.text;
  }
});
</script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'saveKey') {
      await config.setApiKey(String(message.key ?? ''));
      await vscode.workspace.getConfiguration('nimcoder').update('preferredChatModel', String(message.model ?? MODELS.chatDefault), vscode.ConfigurationTarget.Global);
      panel.webview.postMessage({ type: 'status', text: 'Saved API key.' });
      setStatus(statusItem, true, 'API key configured');
    }

    if (message.type === 'testKey') {
      try {
        const response = await fetch(`${NIM_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${String(message.key ?? '')}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: String(message.model ?? MODELS.chatDefault),
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 8,
            stream: false
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        panel.webview.postMessage({ type: 'status', text: '✅ Connection successful' });
        setStatus(statusItem, true, 'NIM API connected');
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[welcome] connection test failed: ${msg}`);
        panel.webview.postMessage({ type: 'status', text: `❌ Connection failed: ${msg}` });
        setStatus(statusItem, false, msg);
      }
    }
  });
}

async function presentDiff(diff: string): Promise<void> {
  const built = await createDiffPreview(diff, 'NIM Coder — Proposed Changes');
  if (!built) {
    vscode.window.showWarningMessage('Could not parse diff from model output.');
    return;
  }

  pendingDiff = built;
  await vscode.commands.executeCommand(
    'setContext',
    'nimcoder.hasPendingDiff',
    true
  );

  await vscode.commands.executeCommand(
    'vscode.diff',
    built.previewOriginal,
    built.previewModified,
    built.title
  );

  const choice = await vscode.window.showInformationMessage(
    'Apply NIM Coder proposed changes?',
    'Accept',
    'Reject'
  );

  if (choice === 'Accept') {
    await vscode.commands.executeCommand('nimcoder.acceptDiff');
  } else if (choice === 'Reject') {
    await vscode.commands.executeCommand('nimcoder.rejectDiff');
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('NIM Coder');
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusItem.text = '⚡ NIM';
  statusItem.tooltip = 'Open NIM Coder settings';
  statusItem.command = 'workbench.action.openSettings';
  statusItem.show();

  context.subscriptions.push(output, statusItem);

  const config = new ConfigService(context);
  const router = new ModelRouter(output);
  const nim = new NimClient(config, router, output);
  const contextBuilder = new ContextBuilder();
  const chatPanel = new ChatPanelProvider(context, config, nim, contextBuilder, output);
  const agentRunner = new AgentRunner(nim, contextBuilder, config);

  await showWelcomeIfNeeded(context, config, output, statusItem);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatPanelProvider.viewId, chatPanel),
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, new NimInlineCompletionProvider(config, nim, output)),
    vscode.languages.registerCodeActionsProvider({ pattern: '**' }, new NimDiagnosticFixCodeActionProvider(), {
      providedCodeActionKinds: NimDiagnosticFixCodeActionProvider.providedCodeActionKinds
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('nimcoder.openChat', () => chatPanel.focus()),
    vscode.commands.registerCommand('nimcoder.focusChat', () => chatPanel.focus()),
    vscode.commands.registerCommand('nimcoder.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        title: 'NVIDIA NIM API Key',
        prompt: 'Paste your API key from build.nvidia.com',
        password: true,
        ignoreFocusOut: true
      });
      if (!key) {
        return;
      }
      await config.setApiKey(key);
      setStatus(statusItem, true, 'API key configured');
      vscode.window.showInformationMessage('NIM API key saved securely.');
    }),
    vscode.commands.registerCommand('nimcoder.startAgentTask', async () => {
      try {
        await agentRunner.runTask();
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[agent] failure: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(`NIM agent failed: ${msg}`);
      }
    }),
    vscode.commands.registerCommand('nimcoder.explainCode', async () => {
      try {
        await runExplainCommand(nim);
        setStatus(statusItem, true);
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] explain failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.refactorThis', async () => {
      try {
        const diff = await runRefactorCommand(nim);
        if (diff) {
          await presentDiff(diff);
          setStatus(statusItem, true);
        }
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] refactor failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.fixBug', async () => {
      try {
        const diff = await runFixBugCommand(nim);
        if (diff) {
          await presentDiff(diff);
          setStatus(statusItem, true);
        }
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] fixBug failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.addDocumentation', async () => {
      try {
        await runDocumentCommand(nim);
        setStatus(statusItem, true);
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] document failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.generateUnitTests', async () => {
      try {
        await runGenerateTestsCommand(nim);
        setStatus(statusItem, true);
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] generate tests failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.optimizePerformance', async () => {
      try {
        const diff = await runOptimizeCommand(nim);
        if (diff) {
          await presentDiff(diff);
          setStatus(statusItem, true);
        }
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[command] optimize failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.fixDiagnostic', async (uri: vscode.Uri, diagnostics: readonly vscode.Diagnostic[]) => {
      try {
        await runDiagnosticFix(nim, uri, diagnostics, output);
        setStatus(statusItem, true);
      } catch (error) {
        const msg = (error as Error).message;
        output.appendLine(`[diagnostic] fix failed: ${msg}`);
        setStatus(statusItem, false, msg);
        vscode.window.showErrorMessage(msg);
      }
    }),
    vscode.commands.registerCommand('nimcoder.acceptDiff', async () => {
      if (!pendingDiff) {
        return;
      }
      await vscode.workspace.applyEdit(pendingDiff.edit);
      pendingDiff = undefined;
      await vscode.commands.executeCommand('setContext', 'nimcoder.hasPendingDiff', false);
      vscode.window.showInformationMessage('NIM Coder changes applied.');
    }),
    vscode.commands.registerCommand('nimcoder.rejectDiff', async () => {
      pendingDiff = undefined;
      await vscode.commands.executeCommand('setContext', 'nimcoder.hasPendingDiff', false);
      vscode.window.showInformationMessage('NIM Coder changes discarded.');
    })
  );

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(async (event) => {
      for (const uri of event.uris) {
        const hasErrors = vscode.languages.getDiagnostics(uri)
          .some((d) => d.severity === vscode.DiagnosticSeverity.Error);
        if (hasErrors) {
          output.appendLine(`[diagnostics] errors detected in ${vscode.workspace.asRelativePath(uri)}`);
        }
      }
    })
  );

  await vscode.commands.executeCommand('setContext', 'nimcoder.hasPendingDiff', false);
}

export function deactivate(): void {
  pendingDiff = undefined;
}
