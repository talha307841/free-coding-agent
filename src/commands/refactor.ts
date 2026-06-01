import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';
import { extractUnifiedDiff } from '../utils/diffApplier';

export async function runRefactorCommand(nim: NimClient): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file and select code to refactor.');
    return undefined;
  }

  const selection = editor.document.getText(editor.selection) || editor.document.getText();
  const file = vscode.workspace.asRelativePath(editor.document.uri);

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: 'Refactor code while preserving behavior. Output unified diff only.'
      },
      {
        role: 'user',
        content: `Target file: ${file}\n\n${selection}`
      }
    ]
  });

  return extractUnifiedDiff(content);
}
