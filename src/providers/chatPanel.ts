import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConfigService, MODELS } from '../config';
import { ContextBuilder } from '../contextBuilder';
import { NimClient } from '../nimClient';
import {
  buildWorkspaceEditFromDiff,
  computePatchStats,
  extractUnifiedDiff,
  parseUnifiedDiff,
  serializePatch
} from '../utils/diffApplier';
import { createReadAnnotation } from '../utils/readAnnotations';
import { estimateTokens } from '../utils/tokenCounter';
import { WorkflowStateMachine } from '../workflow/stateMachine';

interface ChatEntry {
  role: 'user' | 'assistant';
  content: string;
}

type ChatMode = 'chat' | 'agent' | 'plan' | 'research' | 'discuss';

type DiffAction =
  | { action: 'accept' }
  | { action: 'modify'; prompt: string }
  | { action: 'reject' };

type RejectedAction = 'skip' | 'retry' | 'abort';

interface ContextFileState {
  filePath: string;
  read: boolean;
  modified: boolean;
  pending: boolean;
}

function nonce(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeMode(value: unknown): ChatMode {
  const mode = String(value ?? 'chat');
  return ['chat', 'agent', 'plan', 'research', 'discuss'].includes(mode)
    ? mode as ChatMode
    : 'chat';
}

function buildSystemPrompt(mode: ChatMode): string {
  const base = [
    'You are NIM Coder, an expert software engineer assistant running on NVIDIA free inference.',
    'You write clean, idiomatic, production-quality code.',
    'Be concise. Think step by step silently, only show the answer.',
    'When you discuss repository findings, name the exact files or code areas you used as evidence.'
  ];

  if (mode === 'agent') {
    return [
      ...base,
      'When executing workflow stages, always provide concrete plan steps first, then diff-only proposals in unified diff format.',
      'Do not claim edits are applied unless explicitly told they were accepted.',
      'Do not emit action JSON.'
    ].join(' ');
  }

  const modeInstructions: Record<Exclude<ChatMode, 'agent'>, string> = {
    chat: 'Answer as a coding chat assistant. Do not edit files, do not create files, and do not output action JSON.',
    plan: 'Create a clear implementation plan. Do not edit files, do not create files, and do not output a patch unless the user explicitly asks for a patch.',
    research: 'Explain findings and tradeoffs. Do not edit files, do not create files, and do not output action JSON.',
    discuss: 'Discuss the topic conversationally. Do not edit files, do not create files, and do not output a patch unless the user explicitly asks for one.'
  };

  return [...base, modeInstructions[mode]].join(' ');
}

function parseNumberedSteps(planText: string): string[] {
  const lines = planText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const steps = lines.filter((line) => /^\d+[.)]\s+/.test(line)).map((line) => line.replace(/^\d+[.)]\s+/, '').trim());
  if (steps.length > 0) {
    return steps;
  }
  return lines.slice(0, 6);
}

function shortSummary(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= 120) {
    return compact;
  }
  return `${compact.slice(0, 117)}...`;
}

export class ChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'nimcoder.chatView';

  private view?: vscode.WebviewView;
  private abortController?: AbortController;
  private history: ChatEntry[] = [];
  private chatSummary = '';
  private tokenCount = 0;
  private lastFoundDiff?: string;
  private _activeMode = 'chat';

  private workflowLog: string[] = [];
  private contextFiles = new Map<string, ContextFileState>();
  private pendingPlanResolver?: (result: { approved: boolean; notes?: string }) => void;
  private pendingDiffResolvers = new Map<string, (result: DiffAction) => void>();
  private pendingRejectResolvers = new Map<string, (result: RejectedAction) => void>();
  private terminalSessions = new Map<string, ChildProcessWithoutNullStreams>();

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
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'media')
      ]
    };

    view.webview.html = await this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.type) {
          case 'chat':
            await this.onSend(String(message.content ?? ''), String(message.model ?? ''), normalizeMode(message.mode ?? this._activeMode));
            break;
          case 'send':
            await this.onSend(String(message.text ?? ''), String(message.model ?? ''), normalizeMode(this._activeMode));
            break;
          case 'stopGeneration':
          case 'stop':
            this.abortController?.abort();
            break;
          case 'clearChat':
          case 'clear':
            this.history = [];
            this.chatSummary = '';
            this.tokenCount = 0;
            this.lastFoundDiff = undefined;
            this.workflowLog = [];
            this.contextFiles.clear();
            this.post({ type: 'cleared' });
            break;
          case 'summarizeChat':
            await this.summarizeChatHistory();
            break;
          case 'enhancePrompt': {
            const enhanced = await this.enhancePrompt(String(message.text ?? ''));
            this.post({ type: 'enhancedPrompt', text: enhanced });
            break;
          }
          case 'modeChanged':
            this._activeMode = normalizeMode(message.mode ?? 'chat');
            break;
          case 'setAskBeforeChanges':
            await vscode.workspace
              .getConfiguration('nimcoder')
              .update('agent.requireConfirmation', Boolean(message.enabled), vscode.ConfigurationTarget.Global);
            break;
          case 'saveFile': {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceRoot) {
              vscode.window.showErrorMessage('No workspace open');
              return;
            }
            const filename = String(message.filename ?? 'untitled');
            const fileUri = vscode.Uri.joinPath(workspaceRoot, filename);
            const content = Buffer.from(String(message.content ?? ''), 'utf8');
            await vscode.workspace.fs.writeFile(fileUri, content);
            vscode.window.showInformationMessage(`Created ${filename}`);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
            this.post({ type: 'fileCreated', path: fileUri.toString(), filename });
            break;
          }
          case 'openFile': {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (!workspaceRoot) {
              vscode.window.showErrorMessage('No workspace open');
              return;
            }
            const pathStr = String(message.path ?? '');
            const uri = pathStr.includes(':') ? vscode.Uri.parse(pathStr) : vscode.Uri.joinPath(workspaceRoot, pathStr);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
            break;
          }
          case 'runTerminal':
            await this.runTerminalCommand(String(message.command ?? ''), true);
            break;
          case 'listFiles': {
            const query = String(message.query ?? '').toLowerCase();
            const files = (await vscode.workspace.findFiles('**/*', '**/{.git,node_modules,dist}/**', 200))
              .map((uri) => vscode.workspace.asRelativePath(uri))
              .filter((file) => file.toLowerCase().includes(query))
              .slice(0, 20);
            this.post({ type: 'fileSuggestions', files });
            break;
          }
          case 'openDiff': {
            if (this.lastFoundDiff) {
              Promise.resolve(vscode.commands.executeCommand('nimcoder.presentDiffFromProvider', this.lastFoundDiff)).catch(() => {});
            } else {
              this.post({ type: 'streamError', message: 'No diff available' });
            }
            break;
          }
          case 'planDecision':
            this.pendingPlanResolver?.({
              approved: Boolean(message.approved),
              notes: String(message.notes ?? '')
            });
            this.pendingPlanResolver = undefined;
            break;
          case 'diffDecision': {
            const diffId = String(message.diffId ?? '');
            const resolver = this.pendingDiffResolvers.get(diffId);
            if (!resolver) {
              break;
            }
            const action = String(message.action ?? 'reject');
            if (action === 'accept') {
              resolver({ action: 'accept' });
            } else if (action === 'modify') {
              resolver({ action: 'modify', prompt: String(message.prompt ?? '') });
            } else {
              resolver({ action: 'reject' });
            }
            this.pendingDiffResolvers.delete(diffId);
            break;
          }
          case 'rejectDecision': {
            const diffId = String(message.diffId ?? '');
            const resolver = this.pendingRejectResolvers.get(diffId);
            if (resolver) {
              const action = String(message.action ?? 'skip') as RejectedAction;
              resolver(action);
              this.pendingRejectResolvers.delete(diffId);
            }
            break;
          }
          case 'stopTerminal': {
            const terminalId = String(message.terminalId ?? '');
            const proc = this.terminalSessions.get(terminalId);
            if (proc) {
              proc.kill();
              this.terminalSessions.delete(terminalId);
            }
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

  public sendToWebview(payload: unknown): void {
    this.post(payload);
  }

  private async onSend(userMessage: string, selectedModel: string, mode: ChatMode): Promise<void> {
    if (!userMessage.trim()) {
      return;
    }

    if (mode === 'agent') {
      await this.runAgentWorkflow(userMessage, selectedModel);
      return;
    }

    await this.runStandardChat(userMessage, selectedModel, mode);
  }

  private async runStandardChat(userMessage: string, selectedModel: string, mode: ChatMode): Promise<void> {
    const active = vscode.window.activeTextEditor;
    const activeContext = active
      ? `ACTIVE_FILE_CONTEXT_ONLY: ${vscode.workspace.asRelativePath(active.document.uri)}\nCURSOR: ${active.selection.active.line + 1}:${active.selection.active.character + 1}\nNOTE: This active file is context only. Do not edit it unless the user explicitly asked for this file.\n${active.document.getText()}`
      : 'ACTIVE_FILE: none';

    let workspaceContext = '';
    if (userMessage.includes('@workspace')) {
      const files = await this.contextBuilder.topRelevant(userMessage, 5);
      workspaceContext = files
        .map((file: { path: string; content: string }) => `FILE: ${file.path}\n${file.content}`)
        .join('\n\n');
    }

    const fileMentions = [...userMessage.matchAll(/@file\s+([^\s]+)/g)].map((match) => match[1]);
    if (fileMentions.length > 0) {
      for (const file of fileMentions) {
        const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders?.[0]?.uri ?? vscode.Uri.file('.'), file);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          workspaceContext += `\n\nFILE: ${file}\n${Buffer.from(bytes).toString('utf8')}`;
        } catch {
          workspaceContext += `\n\nFILE: ${file}\n[missing file]`;
        }
      }
    }

    const systemPrompt = buildSystemPrompt(mode);
    const priorHistory = this.buildHistoryMessages();

    this.abortController = new AbortController();
    const finalModel = selectedModel || this.config.getPreferredChatModel();
    const routedModel = this.nim.selectRoutedModel('chat', finalModel);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: [
          systemPrompt,
          this.chatSummary ? `COMPRESSED_CHAT_HISTORY:\n${this.chatSummary}` : ''
        ].filter(Boolean).join('\n\n')
      },
      ...priorHistory,
      {
        role: 'user',
        content: [activeContext, workspaceContext, `REQUEST:\n${userMessage}`].filter(Boolean).join('\n\n')
      }
    ];

    this.history.push({ role: 'user', content: userMessage });

    this.post({ type: 'setStatus', phase: 'thinking' });
    this.post({ type: 'streamStart', model: routedModel, mode });

    let assistantText = '';
    try {
      for await (const token of this.nim.chatStream({
        model: routedModel,
        messages,
        temperature: 0.3,
        maxTokens: 2000,
        signal: this.abortController.signal
      })) {
        if (token.includes('```')) {
          this.post({ type: 'setStatus', phase: 'writing' });
        }
        assistantText += token;
        this.post({ type: 'streamToken', token });
      }

      this.history.push({ role: 'assistant', content: assistantText });
      this.tokenCount += estimateTokens(userMessage) + estimateTokens(assistantText);
      this.post({ type: 'streamEnd', tokenCount: this.tokenCount });

      const diff = extractUnifiedDiff(assistantText);
      if (diff) {
        this.lastFoundDiff = diff;
        this.post({ type: 'foundDiff', diff });
        if (!this.config.getAgentRequiresConfirmation() && mode === 'agent') {
          Promise.resolve(vscode.commands.executeCommand('nimcoder.presentDiffFromProvider', diff)).catch(() => {});
        }
      }
    } catch (error) {
      const msg = (error as Error).message;
      this.output.appendLine(`[chat] stream error: ${msg}`);
      this.post({ type: 'streamError', message: msg });
      vscode.window.showErrorMessage(`NIM chat failed: ${msg}`);
    } finally {
      this.abortController = undefined;
    }
  }

  private async runAgentWorkflow(userMessage: string, selectedModel: string): Promise<void> {
    const machine = new WorkflowStateMachine();
    const routedModel = this.nim.selectRoutedModel('chat', selectedModel || this.config.getPreferredAgentModel());
    const maxContext = 128000;
    this.history.push({ role: 'user', content: userMessage });

    this.workflowLog.push(`Request: ${shortSummary(userMessage)}`);
    this.emitContextStats(maxContext);
    this.post({ type: 'workflowStart', request: userMessage });

    try {
      machine.transition('PLAN');
      this.post({ type: 'setStatus', phase: 'reading', detail: 'Collecting files' });
      const files = await this.contextBuilder.topRelevant(userMessage, 6);
      const readSnippets: string[] = [];

      for (const file of files.slice(0, 4)) {
        const text = file.content;
        const lines = text.split(/\r?\n/);
        const startLine = 1;
        const endLine = Math.min(lines.length, 220);
        const snippet = lines.slice(startLine - 1, endLine).join('\n');
        const annotation = createReadAnnotation(file.path, startLine, endLine, snippet);
        this.post({
          type: 'readCard',
          id: `read-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          annotation,
          content: snippet
        });
        this.markFileRead(file.path);
        readSnippets.push(`FILE: ${file.path} (lines ${startLine}-${endLine})\n${snippet}`);
        this.workflowLog.push(`Read ${file.path}:${startLine}-${endLine}`);
      }
      this.emitContextFiles();

      this.post({ type: 'setStatus', phase: 'thinking' });
      const planningPrompt = [
        `User request: ${userMessage}`,
        `Summary of prior actions: ${this.workflowSummary()}`,
        'Create a numbered implementation plan with 3-6 concise steps for this request.',
        ...readSnippets
      ].join('\n\n');
      const planResponse = await this.nim.chat({
        model: routedModel,
        temperature: 0.2,
        maxTokens: 900,
        messages: [
          { role: 'system', content: buildSystemPrompt('agent') },
          { role: 'user', content: planningPrompt }
        ]
      });
      const planSteps = parseNumberedSteps(planResponse);
      this.workflowLog.push(`Planned ${planSteps.length} steps`);

      machine.transition('CONFIRM_PLAN');
      this.post({ type: 'planCard', steps: planSteps, raw: planResponse });
      const planDecision = await this.waitForPlanDecision();
      if (!planDecision.approved) {
        this.post({ type: 'setStatus', phase: 'thinking', detail: 'Updating plan' });
        const revisedPlan = await this.nim.chat({
          model: routedModel,
          temperature: 0.2,
          maxTokens: 900,
          messages: [
            { role: 'system', content: buildSystemPrompt('agent') },
            {
              role: 'user',
              content: [
                `Original request: ${userMessage}`,
                `Current plan:\n${planSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`,
                `User modification request: ${planDecision.notes || 'Revise for clarity.'}`,
                `Summary of prior actions: ${this.workflowSummary()}`,
                'Return only a revised numbered plan.'
              ].join('\n\n')
            }
          ]
        });
        const revisedSteps = parseNumberedSteps(revisedPlan);
        this.post({ type: 'planCard', steps: revisedSteps, raw: revisedPlan, revised: true });
        const secondDecision = await this.waitForPlanDecision();
        if (!secondDecision.approved) {
          machine.transition('ABORTED');
          this.post({ type: 'workflowDone', summary: 'Workflow aborted during plan confirmation.' });
          return;
        }
      }

      machine.transition('EXECUTE');
      const executableSteps = planSteps.length > 0 ? planSteps : ['Implement requested changes'];

      for (let stepIndex = 0; stepIndex < executableSteps.length; stepIndex += 1) {
        const step = executableSteps[stepIndex];
        const targetFiles = files.slice(0, 3).map((file) => file.path);
        this.post({
          type: 'workflowProgress',
          label: `Step ${stepIndex + 1}/${executableSteps.length}: ${step}`,
          current: stepIndex + 1,
          total: executableSteps.length,
          filePath: targetFiles[0] ?? ''
        });
        this.post({ type: 'setStatus', phase: 'thinking', detail: `Planning edits for step ${stepIndex + 1}` });

        const diffPrompt = [
          `User request: ${userMessage}`,
          `Current step: ${step}`,
          `Candidate files: ${targetFiles.join(', ')}`,
          `Summary of prior actions: ${this.workflowSummary()}`,
          'Respond with a unified diff only. Include --- a/path and +++ b/path headers. Edit only files relevant to this step.'
        ].join('\n\n');

        const diffResponse = await this.nim.chat({
          model: routedModel,
          temperature: 0.1,
          maxTokens: 2400,
          messages: [
            { role: 'system', content: buildSystemPrompt('agent') },
            { role: 'user', content: diffPrompt }
          ]
        });

        const diffText = extractUnifiedDiff(diffResponse);
        if (!diffText) {
          this.post({ type: 'notice', text: `No diff generated for step ${stepIndex + 1}.` });
          continue;
        }

        const patches = parseUnifiedDiff(diffText);
        for (const patch of patches) {
          const filePath = patch.newPath || patch.oldPath;
          const stats = computePatchStats(patch);
          const patchText = serializePatch(patch);
          const diffId = `diff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          this.markFilePending(filePath);
          this.emitContextFiles();

          this.post({ type: 'setStatus', phase: 'writing', detail: `Proposing changes to ${filePath}` });
          this.post({
            type: 'diffCard',
            diffId,
            filePath,
            diff: patchText,
            stats,
            step: stepIndex + 1,
            totalSteps: executableSteps.length
          });

          let decision = await this.waitForDiffDecision(diffId);
          if (decision.action === 'modify') {
            const modifiedResponse = await this.nim.chat({
              model: routedModel,
              temperature: 0.1,
              maxTokens: 1800,
              messages: [
                { role: 'system', content: buildSystemPrompt('agent') },
                {
                  role: 'user',
                  content: [
                    `User request: ${userMessage}`,
                    `File: ${filePath}`,
                    `Current proposed diff:\n${patchText}`,
                    `User modification request: ${decision.prompt || 'Adjust implementation.'}`,
                    `Summary of prior actions: ${this.workflowSummary()}`,
                    'Return a revised unified diff only for this file.'
                  ].join('\n\n')
                }
              ]
            });
            const revisedDiffText = extractUnifiedDiff(modifiedResponse);
            if (revisedDiffText) {
              const revisedPatch = parseUnifiedDiff(revisedDiffText)[0];
              if (revisedPatch) {
                const revisedStats = computePatchStats(revisedPatch);
                const revisedText = serializePatch(revisedPatch);
                const revisedId = `diff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
                this.post({
                  type: 'diffCard',
                  diffId: revisedId,
                  filePath,
                  diff: revisedText,
                  stats: revisedStats,
                  step: stepIndex + 1,
                  totalSteps: executableSteps.length,
                  revised: true
                });
                decision = await this.waitForDiffDecision(revisedId);
                if (decision.action === 'modify') {
                  decision = { action: 'reject' };
                }
                if (decision.action === 'accept') {
                  await this.applyPatchAndReport(filePath, revisedText, revisedStats);
                  continue;
                }
              }
            }
            decision = { action: 'reject' };
          }

          if (decision.action === 'accept') {
            await this.applyPatchAndReport(filePath, patchText, stats);
            continue;
          }

          this.post({ type: 'diffRejected', diffId, filePath });
          const next = await this.waitForRejectedDecision(diffId);
          if (next === 'abort') {
            machine.transition('ABORTED');
            this.post({ type: 'workflowDone', summary: 'Workflow aborted after diff rejection.' });
            return;
          }
          if (next === 'retry') {
            stepIndex = Math.max(-1, stepIndex - 1);
            break;
          }
          this.markFileUnpending(filePath);
        }
      }

      machine.transition('VERIFY');
      this.post({ type: 'setStatus', phase: 'running', detail: 'Running verification commands' });
      const verification = await this.runVerificationLoop();
      this.workflowLog.push(`Verification completed: ${verification}`);

      machine.transition('DONE');
      this.post({ type: 'setStatus', phase: 'done' });
      this.post({
        type: 'workflowDone',
        summary: `Completed workflow with verification result: ${verification}`
      });
      this.history.push({ role: 'assistant', content: `Workflow complete. ${verification}` });
      this.tokenCount += estimateTokens(userMessage) + estimateTokens(this.workflowSummary());
      this.emitContextStats(maxContext);
    } catch (error) {
      const msg = (error as Error).message;
      this.output.appendLine(`[agent-workflow] ${msg}`);
      this.post({ type: 'setStatus', phase: 'failed', detail: msg });
      this.post({ type: 'workflowDone', summary: `Failed: ${msg}` });
    }
  }

  private async applyPatchAndReport(filePath: string, patchText: string, stats: { added: number; removed: number }): Promise<void> {
    const edit = await buildWorkspaceEditFromDiff(patchText);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error(`Failed to apply patch for ${filePath}`);
    }
    this.markFileModified(filePath);
    this.emitContextFiles();
    this.workflowLog.push(`Applied ${filePath} (+${stats.added}/-${stats.removed})`);
    this.post({
      type: 'diffApplied',
      filePath,
      added: stats.added,
      removed: stats.removed,
      message: `${filePath} updated`
    });
  }

  private waitForPlanDecision(): Promise<{ approved: boolean; notes?: string }> {
    return new Promise((resolve) => {
      this.pendingPlanResolver = resolve;
    });
  }

  private waitForDiffDecision(diffId: string): Promise<DiffAction> {
    return new Promise((resolve) => {
      this.pendingDiffResolvers.set(diffId, resolve);
    });
  }

  private waitForRejectedDecision(diffId: string): Promise<RejectedAction> {
    return new Promise((resolve) => {
      this.pendingRejectResolvers.set(diffId, resolve);
    });
  }

  private markFileRead(filePath: string): void {
    const current = this.contextFiles.get(filePath) ?? {
      filePath,
      read: false,
      modified: false,
      pending: false
    };
    current.read = true;
    this.contextFiles.set(filePath, current);
  }

  private markFilePending(filePath: string): void {
    const current = this.contextFiles.get(filePath) ?? {
      filePath,
      read: false,
      modified: false,
      pending: false
    };
    current.pending = true;
    this.contextFiles.set(filePath, current);
  }

  private markFileUnpending(filePath: string): void {
    const current = this.contextFiles.get(filePath);
    if (!current) {
      return;
    }
    current.pending = false;
    this.contextFiles.set(filePath, current);
  }

  private markFileModified(filePath: string): void {
    const current = this.contextFiles.get(filePath) ?? {
      filePath,
      read: false,
      modified: false,
      pending: false
    };
    current.modified = true;
    current.pending = false;
    this.contextFiles.set(filePath, current);
  }

  private emitContextFiles(): void {
    this.post({
      type: 'contextFiles',
      files: [...this.contextFiles.values()]
    });
  }

  private workflowSummary(): string {
    if (this.workflowLog.length === 0) {
      return 'No prior actions.';
    }
    return this.workflowLog.slice(-20).join(' | ');
  }

  private emitContextStats(maxContextTokens: number): void {
    const used = estimateTokens(this.chatSummary) + estimateTokens(this.history.map((entry) => entry.content).join('\n')) + estimateTokens(this.workflowSummary());
    this.post({
      type: 'contextStats',
      used,
      max: maxContextTokens,
      warn: used >= Math.floor(maxContextTokens * 0.8)
    });
  }

  private async runVerificationLoop(): Promise<string> {
    const commands = ['npm run compile', 'npx tsc --noEmit'];
    const summaries: string[] = [];
    for (const command of commands) {
      const result = await this.runTerminalCommand(command, false);
      summaries.push(`${command}: exit ${result}`);
      if (result !== 0) {
        return summaries.join(', ');
      }
    }
    return summaries.join(', ');
  }

  private async runTerminalCommand(command: string, announceOnly: boolean): Promise<number> {
    if (!command.trim()) {
      return 0;
    }

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return 1;
    }

    const terminalId = `term-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    this.post({ type: 'terminalStart', terminalId, command });

    return new Promise((resolve) => {
      const child = spawn(command, {
        cwd: root,
        shell: true,
        env: process.env
      });
      this.terminalSessions.set(terminalId, child);

      const emit = (chunk: string): void => {
        const lines = chunk.split(/\r?\n/);
        for (const line of lines) {
          if (line.trim().length === 0) {
            continue;
          }
          this.post({ type: 'terminalChunk', terminalId, line });
        }
      };

      child.stdout.on('data', (data) => emit(String(data)));
      child.stderr.on('data', (data) => emit(String(data)));

      child.on('close', (code) => {
        const exitCode = Number(code ?? 1);
        this.terminalSessions.delete(terminalId);
        this.post({ type: 'terminalEnd', terminalId, exitCode });
        resolve(exitCode);
      });

      if (announceOnly) {
        this.output.appendLine(`[terminal] started: ${command}`);
      }
    });
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

  private buildHistoryMessages(): ChatEntry[] {
    const maxTurns = 12;
    const maxChars = 24000;
    const recent = this.history.slice(-maxTurns);
    const kept: ChatEntry[] = [];
    let chars = 0;

    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const entry = recent[index];
      chars += entry.content.length;
      if (chars > maxChars) {
        break;
      }
      kept.unshift(entry);
    }

    return kept;
  }

  private async summarizeChatHistory(): Promise<void> {
    if (this.history.length === 0 && !this.chatSummary) {
      this.post({ type: 'summaryUnavailable' });
      return;
    }

    this.post({ type: 'setStatus', phase: 'thinking' });
    const transcript = [
      this.chatSummary ? `Existing compressed history:\n${this.chatSummary}` : '',
      ...this.history.map((entry) => `${entry.role.toUpperCase()}:\n${entry.content}`)
    ].filter(Boolean).join('\n\n');

    const model = this.nim.selectRoutedModel('chat', this.config.getPreferredChatModel());
    const summary = await this.nim.chat({
      model,
      temperature: 0.2,
      maxTokens: 700,
      messages: [
        {
          role: 'system',
          content: 'Compress this coding chat into durable context for future turns. Preserve user goals, decisions, files mentioned, bugs found, and pending tasks. Be concise.'
        },
        { role: 'user', content: transcript }
      ]
    });

    this.chatSummary = summary.trim();
    this.history = [];
    this.tokenCount = estimateTokens(this.chatSummary);
    this.post({ type: 'summaryDone', text: this.chatSummary, tokenCount: this.tokenCount });
  }

  private async renderHtml(webview: vscode.Webview): Promise<string> {
    const htmlPath = path.join(this.context.extensionPath, 'src', 'webview', 'chatPanel.html');
    const raw = await fs.readFile(htmlPath, 'utf8');
    const token = nonce();

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com https://fonts.googleapis.com`,
      `script-src 'nonce-${token}' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net`,
      `font-src ${webview.cspSource} https://cdnjs.cloudflare.com https://fonts.gstatic.com`,
      `connect-src https://integrate.api.nvidia.com`
    ].join('; ');

    return raw
      .replace(/{{NONCE}}/g, token)
      .replace('{{CSP}}', csp)
      .replace('{{PREFERRED_MODEL}}', this.config.getPreferredChatModel())
      .replace('{{ASK_BEFORE_CHANGES}}', String(this.config.getAgentRequiresConfirmation()));
  }

  private post(payload: unknown): void {
    this.view?.webview.postMessage(payload);
  }
}
