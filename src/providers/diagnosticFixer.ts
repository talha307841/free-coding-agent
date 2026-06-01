import * as vscode from 'vscode';
import { MODELS } from '../config';
import { NimClient } from '../nimClient';
import { buildWorkspaceEditFromDiff, extractUnifiedDiff } from '../utils/diffApplier';

export class NimDiagnosticFixCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const errors = context.diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
    if (errors.length === 0) {
      return [];
    }

    const action = new vscode.CodeAction('✨ Fix with NIM Coder', vscode.CodeActionKind.QuickFix);
    action.command = {
      command: 'nimcoder.fixDiagnostic',
      title: 'Fix with NIM Coder',
      arguments: [_document.uri, errors]
    };

    return [action];
  }
}

function rangeSnippet(document: vscode.TextDocument, line: number): string {
  const start = Math.max(0, line - 30);
  const end = Math.min(document.lineCount - 1, line + 30);
  return document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
}

export async function runDiagnosticFix(
  nim: NimClient,
  uri: vscode.Uri,
  diagnostics: readonly vscode.Diagnostic[],
  output: vscode.OutputChannel
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const errorDiagnostics = diagnostics.filter((d) => d.severity === vscode.DiagnosticSeverity.Error);
  if (errorDiagnostics.length === 0) {
    vscode.window.showInformationMessage('No error diagnostics found.');
    return;
  }

  let attempt = 0;
  while (attempt < 2) {
    attempt += 1;
    const primary = errorDiagnostics[0];
    const message = errorDiagnostics
      .map((d) => `line ${d.range.start.line + 1}: ${d.message}`)
      .join('\n');

    const content = await nim.chat({
      model: MODELS.agentDefault,
      temperature: 0,
      maxTokens: 1800,
      messages: [
        {
          role: 'system',
          content: 'Fix this error. Output only a unified diff. No explanation.'
        },
        {
          role: 'user',
          content: [
            `FILE: ${vscode.workspace.asRelativePath(uri)}`,
            `ERRORS:\n${message}`,
            `CONTEXT:\n${rangeSnippet(document, primary.range.start.line)}`,
            `FULL_FILE:\n${document.getText()}`
          ].join('\n\n')
        }
      ]
    });

    const diff = extractUnifiedDiff(content);
    if (!diff) {
      throw new Error('NIM did not return a unified diff for diagnostic fix.');
    }

    const edit = await buildWorkspaceEditFromDiff(diff);
    await vscode.workspace.applyEdit(edit);

    await document.save();
    const latestDiagnostics = vscode.languages.getDiagnostics(uri)
      .filter((d) => d.severity === vscode.DiagnosticSeverity.Error);

    if (latestDiagnostics.length === 0) {
      vscode.window.showInformationMessage('NIM Coder fixed all current errors.');
      return;
    }

    output.appendLine(`[diagnostic] retrying fix attempt ${attempt} due to remaining errors (${latestDiagnostics.length})`);
    if (attempt >= 2) {
      vscode.window.showWarningMessage('NIM Coder could not fully fix all diagnostics in 2 attempts.');
      return;
    }
  }
}
