import * as path from 'node:path';
import * as vscode from 'vscode';
import { NimClient } from '../nimClient';
import { MODELS } from '../config';

function testFilePath(sourcePath: string): string {
  const ext = path.extname(sourcePath);
  const base = sourcePath.slice(0, -ext.length);
  if (base.endsWith('.test') || base.endsWith('_test')) {
    return sourcePath;
  }
  if (ext === '.go') {
    return `${base}_test${ext}`;
  }
  return `${base}.test${ext || '.ts'}`;
}

export async function runGenerateTestsCommand(nim: NimClient): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showInformationMessage('Open a source file to generate tests.');
    return;
  }

  const source = editor.document.getText();
  const rel = vscode.workspace.asRelativePath(editor.document.uri);

  const content = await nim.chat({
    model: MODELS.chatDefault,
    temperature: 0.3,
    maxTokens: 1600,
    messages: [
      { role: 'system', content: 'Generate complete unit tests for the provided file. Return code only.' },
      { role: 'user', content: `SOURCE_FILE: ${rel}\n\n${source}` }
    ]
  });

  const destRel = testFilePath(rel);
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) {
    return;
  }

  const uri = vscode.Uri.joinPath(root, destRel);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}
