import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';
import { extractUnifiedDiff } from '../utils/diffApplier';

export async function runFixBugCommand(nim: NimClient): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file and select code to fix.');
    return undefined;
  }

  const selected = editor.document.getText(editor.selection) || editor.document.getText();
  const file = vscode.workspace.asRelativePath(editor.document.uri);

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.0,
    messages: [
      { role: 'system', content: 'Fix bugs in the provided code. Output only unified diff.' },
      { role: 'user', content: `Target file: ${file}\n${selected}` }
    ]
  });

  return extractUnifiedDiff(content);
}
