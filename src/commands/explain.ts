import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';

export async function runExplainCommand(nim: NimClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a file and select code to explain.');
    return;
  }

  const selection = editor.document.getText(editor.selection) || editor.document.getText();
  const language = editor.document.languageId;

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.3,
    messages: [
      { role: 'system', content: `Explain ${language} code clearly for a developer.` },
      { role: 'user', content: selection }
    ]
  });

  const doc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# NIM Coder Explanation\n\n${content}`
  });
  await vscode.window.showTextDocument(doc, { preview: false });
}
