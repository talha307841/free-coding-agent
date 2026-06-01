import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';
import { extractUnifiedDiff } from '../utils/diffApplier';

export async function runOptimizeCommand(nim: NimClient): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file and select code to optimize.');
    return undefined;
  }

  const selection = editor.document.getText(editor.selection) || editor.document.getText();
  const file = vscode.workspace.asRelativePath(editor.document.uri);

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.7,
    messages: [
      { role: 'system', content: 'Optimize performance without changing behavior. Output unified diff only.' },
      { role: 'user', content: `FILE: ${file}\n${selection}` }
    ]
  });

  return extractUnifiedDiff(content);
}
