import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';

export async function runDocumentCommand(nim: NimClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a function selection to document.');
    return;
  }

  const selection = editor.document.getText(editor.selection);
  if (!selection.trim()) {
    vscode.window.showInformationMessage('Select a function body to document.');
    return;
  }

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: 'Generate only a JSDoc/docstring block for the given function. Do not include other text.'
      },
      { role: 'user', content: selection }
    ]
  });

  await editor.edit((builder) => {
    builder.insert(editor.selection.start, `${content.trim()}\n`);
  });
}
