import * as vscode from 'vscode';
import { ConfigService, MODELS } from '../config';
import { NimClient } from '../nimClient';

function delay(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    token.onCancellationRequested(() => {
      clearTimeout(timer);
      reject(new Error('Cancelled'));
    });
  });
}

function extractImportBlock(text: string): string {
  const lines = text.split(/\r?\n/);
  const importLines: string[] = [];
  for (const line of lines.slice(0, 200)) {
    const trimmed = line.trim();
    if (/^(import\s|from\s+.+\s+import\s|const\s+.+\s*=\s*require\(|using\s)/.test(trimmed)) {
      importLines.push(line);
    }
  }
  return importLines.join('\n');
}

function extractFunctionSignature(textBeforeCursor: string): string {
  const lines = textBeforeCursor.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    if (/^(export\s+)?(async\s+)?function\s+/.test(line) || /=>\s*\{?$/.test(line) || /^(def|func)\s+/.test(line)) {
      return line;
    }
  }
  return '';
}

function tailByChars(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return input.slice(input.length - maxChars);
}

function headByChars(input: string, maxChars: number): string {
  if (input.length <= maxChars) {
    return input;
  }
  return input.slice(0, maxChars);
}

export class NimInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  public constructor(
    private readonly config: ConfigService,
    private readonly client: NimClient,
    private readonly output: vscode.OutputChannel
  ) {}

  public async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | vscode.InlineCompletionItem[] | undefined> {
    if (!this.config.getCompletionEnabled()) {
      return undefined;
    }

    try {
      await delay(this.config.getCompletionDelayMs(), token);
    } catch {
      return undefined;
    }

    if (token.isCancellationRequested) {
      return undefined;
    }

    const startedAt = Date.now();

    try {
      const fullText = document.getText();
      const before = document.getText(new vscode.Range(new vscode.Position(0, 0), position));
      const after = document.getText(new vscode.Range(position, document.positionAt(fullText.length)));

      const imports = extractImportBlock(fullText);
      const signature = extractFunctionSignature(before);
      const prefix = tailByChars(`${imports}\n${signature}\n${before}`, 8000);
      const suffix = headByChars(after, 2000);

      const completion = await this.client.chat({
        model: MODELS.completion,
        temperature: 0.1,
        maxTokens: 96,
        messages: [
          {
            role: 'system',
            content: 'You are a fill-in-the-middle completion model. Return only the continuation text to insert at cursor.'
          },
          {
            role: 'user',
            content: `${prefix}${suffix}`
          }
        ]
      });

      if (Date.now() - startedAt > 600 || token.isCancellationRequested) {
        return undefined;
      }

      const text = completion.trim();
      if (!text) {
        return undefined;
      }

      this.output.appendLine(`[inline] completion in ${Date.now() - startedAt}ms for ${document.languageId}`);
      return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
    } catch (error) {
      this.output.appendLine(`[inline] completion error: ${(error as Error).message}`);
      return undefined;
    }
  }
}
