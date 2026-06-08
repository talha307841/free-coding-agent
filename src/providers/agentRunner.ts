import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { ConfigService } from '../config';
import { ContextBuilder } from '../contextBuilder';
import { NimClient } from '../nimClient';
import { getWorkspaceTree } from '../utils/fileScanner';

const exec = promisify(execCb);

type AgentAction =
  | { type: 'write_file'; path: string; content: string }
  | { type: 'run_terminal'; command: string }
  | { type: 'read_file'; path: string }
  | { type: 'done'; summary: string };

function parseActionBlock(text: string): AgentAction[] {
  const fenced = text.match(/```action\s*([\s\S]*?)```/i);
  const raw = fenced?.[1] ?? text;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('{') && line.endsWith('}'));

  const actions: AgentAction[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as AgentAction;
      actions.push(parsed);
    } catch {
      // Ignore malformed line.
    }
  }
  return actions;
}

export class AgentRunner {
  private readonly output = vscode.window.createOutputChannel('NIM Coder Agent');
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);

  public constructor(
    private readonly nim: NimClient,
    private readonly contextBuilder: ContextBuilder,
    private readonly config: ConfigService
  ) {
    this.status.text = '⚡ NIM Agent idle';
    this.status.show();
  }

  public async runTask(): Promise<void> {
    const task = await vscode.window.showInputBox({
      prompt: 'Describe what you want to build or fix...'
    });
    if (!task) {
      return;
    }

    this.output.show(true);
    let feedback = '';

    for (let step = 1; step <= 10; step += 1) {
      this.status.text = `⚡ NIM Agent running... (step ${step}/10)`;
      // notify webview we're thinking about next step
      try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { type: 'setStatus', phase: 'thinking' }); } catch {}

      const fileTree = await getWorkspaceTree();
      const context = await this.contextBuilder.buildContext(task, this.config.getMaxContextTokens());
      const prompt = [
        `TASK: ${task}`,
        `WORKSPACE_FILES:\n${fileTree.join('\n')}`,
        `CONTEXT:\n${context}`,
        feedback,
        'Respond using action JSON lines inside ```action block with one or more actions.',
        'Allowed actions: write_file, run_terminal, read_file, done.'
      ].filter(Boolean).join('\n\n');

      // indicate reading while preparing prompt
      try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { type: 'setStatus', phase: 'reading' }); } catch {}

      const content = await this.nim.chat({
        model: this.config.getPreferredAgentModel(),
        temperature: 0,
        maxTokens: 2000,
        messages: [
          { role: 'system', content: 'You are an autonomous coding agent. Use valid JSON action lines.' },
          { role: 'user', content: prompt }
        ]
      });

      // allow chat webview to scan assistant content for file creation
      try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { assistantContent: content }); } catch {}

      this.output.appendLine(`\n[step ${step}] raw response:\n${content}`);
      // if content includes code fences, tell webview we're writing
      if (content.includes('```')) {
        try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { type: 'setStatus', phase: 'writing' }); } catch {}
      }
      const actions = parseActionBlock(content);
      if (actions.length === 0) {
        feedback = `Previous attempt failed: no valid action block parsed. Try again with correct JSON lines.`;
        continue;
      }

      let doneSummary: string | undefined;
      let nextFeedback = '';
      for (const action of actions) {
        try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { type: 'setStatus', phase: action.type === 'run_terminal' ? 'running' : 'writing' }); } catch {}
        const result = await this.executeAction(action);
        // after action run, notify done/running back to idle
        try { await vscode.commands.executeCommand('nimcoder._broadcastStatus', { type: 'setStatus', phase: 'done' }); } catch {}
        this.output.appendLine(result.logLine);
        if (action.type === 'done') {
          doneSummary = action.summary;
          break;
        }
        if (result.feedback) {
          nextFeedback += `${result.feedback}\n`;
        }
      }

      if (doneSummary) {
        this.status.text = '⚡ NIM Agent idle';
        vscode.window.showInformationMessage(`NIM Agent complete: ${doneSummary}`);
        return;
      }

      feedback = `Terminal output: ${nextFeedback}\nContinue the task.`;
    }

    this.status.text = '⚡ NIM Agent idle';
    vscode.window.showWarningMessage('NIM Agent stopped after reaching 10 iterations.');
  }

  private async executeAction(action: AgentAction): Promise<{ logLine: string; feedback?: string }> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!root) {
      return { logLine: '[agent] no workspace root found' };
    }

    if (action.type === 'read_file') {
      const uri = vscode.Uri.joinPath(root, action.path);
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(bytes).toString('utf8');
      return {
        logLine: `[agent] read_file ${action.path}`,
        feedback: `READ_FILE ${action.path}:\n${content.slice(0, 12000)}`
      };
    }

    if (action.type === 'write_file') {
      if (this.config.getAgentRequiresConfirmation()) {
        const selection = await vscode.window.showWarningMessage(
          `NIM Agent wants to write ${action.path}. Continue?`,
          { modal: true },
          'Yes',
          'No'
        );
        if (selection !== 'Yes') {
          return { logLine: `[agent] write_file skipped by user: ${action.path}` };
        }
      }

      const uri = vscode.Uri.joinPath(root, action.path);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(action.content, 'utf8'));
      return { logLine: `[agent] write_file ${action.path}` };
    }

    if (action.type === 'run_terminal') {
      const terminal = vscode.window.createTerminal({ name: 'NIM Agent' });
      terminal.show(true);
      terminal.sendText(action.command, true);

      try {
        const { stdout, stderr } = await exec(action.command, { cwd: root.fsPath, maxBuffer: 1024 * 1024 });
        const combined = `${stdout}\n${stderr}`.trim();
        return {
          logLine: `[agent] run_terminal ${action.command}`,
          feedback: combined.slice(0, 12000)
        };
      } catch (error) {
        const message = (error as Error).message;
        return {
          logLine: `[agent] run_terminal failed ${action.command}: ${message}`,
          feedback: message
        };
      }
    }

    return { logLine: `[agent] done: ${action.summary}` };
  }
}
