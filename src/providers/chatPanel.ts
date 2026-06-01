import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConfigService, MODELS } from '../config';
import { ContextBuilder } from '../contextBuilder';
import { NimClient } from '../nimClient';
import { estimateTokens } from '../utils/tokenCounter';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

function nonce(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'nimcoder.chatView';

  private view?: vscode.WebviewView;
  private abortController?: AbortController;
  private history: ChatEntry[] = [];
  private tokenCount = 0;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly config: ConfigService,
    private readonly nim: NimClient,
    private readonly contextBuilder: ContextBuilder,
    private readonly output: vscode.OutputChannel
  ) {}

  public async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview')
      ]
    };

    view.webview.html = await this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case 'send':
            await this.onSend(message.text as string, message.model as string);
            break;
          case 'stop':
            this.abortController?.abort();
            break;
          case 'clear':
            this.history = [];
            this.tokenCount = 0;
            this.post({ type: 'cleared' });
            break;
          case 'enhancePrompt': {
            const enhanced = await this.enhancePrompt(message.text as string);
            this.post({ type: 'enhancedPrompt', text: enhanced });
            break;
          }
          case 'listFiles': {
            const query = String(message.query ?? '').toLowerCase();
            const files = (await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist}/**', 200))
              .map((uri) => vscode.workspace.asRelativePath(uri))
              .filter((f) => f.toLowerCase().includes(query))
              .slice(0, 20);
            this.post({ type: 'fileSuggestions', files });
            break;
          }
          default:
            break;
        }
      } catch (error) {
        const msg = (error as Error).message;
        this.output.appendLine(`[chat] message error: ${msg}`);
        vscode.window.showErrorMessage(`NIM Coder chat error: ${msg}`);
      }
    });
  }

  public focus(): void {
    this.view?.show?.(true);
    this.post({ type: 'focusInput' });
  }

  private async onSend(userMessage: string, selectedModel: string): Promise<void> {
    if (!userMessage.trim()) {
      return;
    }

    const active = vscode.window.activeTextEditor;
    const activeContext = active
      ? `ACTIVE_FILE: ${vscode.workspace.asRelativePath(active.document.uri)}\nCURSOR: ${active.selection.active.line + 1}:${active.selection.active.character + 1}\n${active.document.getText()}`
      : 'ACTIVE_FILE: none';

    let workspaceContext = '';
    if (userMessage.includes('@workspace')) {
      const files = await this.contextBuilder.topRelevant(userMessage, 5);
      workspaceContext = files
        .map((file: { path: string; content: string }) => `FILE: ${file.path}\n${file.content}`)
        .join('\n\n');
    }

    const fileMentions = [...userMessage.matchAll(/@file\s+([^\s]+)/g)].map((m) => m[1]);
    if (fileMentions.length > 0) {
      for (const file of fileMentions) {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0].uri ?? vscode.Uri.file('.'), file);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          workspaceContext += `\n\nFILE: ${file}\n${Buffer.from(bytes).toString('utf8')}`;
        } catch {
          workspaceContext += `\n\nFILE: ${file}\n[missing file]`;
        }
      }
    }

    const systemPrompt = [
      'You are NIM Coder, an expert software engineer assistant running on NVIDIA free inference.',
      'You write clean, idiomatic, production-quality code.',
      'When showing code changes, always output a unified diff (--- a/file\\n+++ b/file).',
      'Be concise. Think step by step silently, only show the answer.'
    ].join(' ');

    this.history.push({ role: 'user', content: userMessage });
    this.post({ type: 'message', role: 'user', content: userMessage });

    this.abortController = new AbortController();

    const finalModel = selectedModel || this.config.getPreferredChatModel();
    const routedModel = this.nim.selectRoutedModel('chat', finalModel);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: [activeContext, workspaceContext, `REQUEST:\n${userMessage}`].filter(Boolean).join('\n\n')
      }
    ];

    this.post({ type: 'streamStart', model: routedModel });

    let assistantText = '';
    try {
      for await (const token of this.nim.chatStream({
        model: routedModel,
        messages,
        temperature: 0.3,
        maxTokens: 2000,
        signal: this.abortController.signal
      })) {
        assistantText += token;
        this.post({ type: 'streamToken', token });
      }

      this.history.push({ role: 'assistant', content: assistantText });
      this.tokenCount += estimateTokens(userMessage) + estimateTokens(assistantText);
      this.post({ type: 'streamEnd', tokenCount: this.tokenCount });
    } catch (error) {
      const msg = (error as Error).message;
      this.output.appendLine(`[chat] stream error: ${msg}`);
      this.post({ type: 'streamError', message: msg });
      vscode.window.showErrorMessage(`NIM chat failed: ${msg}`);
    } finally {
      this.abortController = undefined;
    }
  }

  private async enhancePrompt(userMessage: string): Promise<string> {
    const model = this.nim.selectRoutedModel('completion', MODELS.completion);
    const prompt = `Rewrite this vague developer request as a precise, specific coding instruction in <=2 sentences. Original: ${userMessage}`;
    const response = await this.nim.chat({
      model,
      temperature: 0.2,
      maxTokens: 140,
      messages: [
        { role: 'system', content: 'Rewrite prompts for coding precision.' },
        { role: 'user', content: prompt }
      ]
    });
    return response.trim();
  }

  private async renderHtml(webview: vscode.Webview): Promise<string> {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'chatPanel.html');
    const raw = await fs.readFile(htmlPath, 'utf8');
    const token = nonce();

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com`,
      `script-src 'nonce-${token}' https://cdnjs.cloudflare.com`,
      `font-src ${webview.cspSource} https://cdnjs.cloudflare.com`,
      `connect-src https://integrate.api.nvidia.com`
    ].join('; ');

    return raw
      .replace(/{{NONCE}}/g, token)
      .replace('{{CSP}}', csp);
  }

  private post(payload: unknown): void {
    this.view?.webview.postMessage(payload);
  }
}
