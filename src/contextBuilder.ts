import * as vscode from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { scanWorkspaceFiles, ScannedFile } from './utils/fileScanner';
import { estimateTokens } from './utils/tokenCounter';

const execAsync = promisify(exec);

interface IndexedDoc {
  file: ScannedFile;
  terms: Map<string, number>;
}

export class ContextBuilder {
  private indexed: IndexedDoc[] = [];
  private idf = new Map<string, number>();

  public async refreshIndex(): Promise<void> {
    const scanned = await scanWorkspaceFiles();
    this.indexed = scanned.map((file) => ({ file, terms: this.termFreq(file.content) }));
    this.idf = this.computeIdf(this.indexed);
  }

  public async topRelevant(query: string, count: number): Promise<ScannedFile[]> {
    if (this.indexed.length === 0) {
      await this.refreshIndex();
    }

    const q = this.termFreq(query);
    const scored = this.indexed.map((doc) => ({
      doc,
      score: this.cosineTfidf(q, doc.terms)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, count).map((item) => item.doc.file);
  }

  public async buildContext(query: string, maxTokens: number): Promise<string> {
    if (this.indexed.length === 0) {
      await this.refreshIndex();
    }

    const sections: string[] = [];

    const active = vscode.window.activeTextEditor;
    if (active) {
      const pos = active.selection.active;
      sections.push(`ACTIVE_FILE: ${vscode.workspace.asRelativePath(active.document.uri)}\nCURSOR: ${pos.line + 1}:${pos.character + 1}\n${active.document.getText()}`);
    }

    const visible = vscode.window.visibleTextEditors.slice(0, 8);
    for (const editor of visible) {
      const lines = editor.document.getText().split(/\r?\n/).slice(0, 50).join('\n');
      sections.push(`OPEN_TAB_SUMMARY: ${vscode.workspace.asRelativePath(editor.document.uri)}\n${lines}`);
    }

    const identityFiles = ['package.json', 'pyproject.toml', 'go.mod'];
    for (const filename of identityFiles) {
      const uri = vscode.workspace.workspaceFolders?.[0]
        ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, filename)
        : undefined;
      if (!uri) {
        continue;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        sections.push(`PROJECT_IDENTITY: ${filename}\n${Buffer.from(bytes).toString('utf8')}`);
      } catch {
        // Ignore missing file.
      }
    }

    sections.push(`RECENT_GIT_DIFF_FILES:\n${(await this.recentGitFiles()).join('\n')}`);

    const relevant = await this.topRelevant(query, 50);
    for (const file of relevant) {
      sections.push(`FILE: ${file.path}\n${file.content}`);
    }

    let context = sections.join('\n\n');
    const budget = Math.max(2000, maxTokens);

    if (estimateTokens(context) <= budget) {
      return context;
    }

    const trimmed: string[] = [];
    for (const section of sections) {
      if (estimateTokens(trimmed.join('\n\n') + '\n\n' + section) <= budget) {
        trimmed.push(section);
      } else if (section.startsWith('FILE: ')) {
        const [header, body = ''] = section.split('\n', 2);
        trimmed.push(`${header}\nSUMMARY: ${body.slice(0, 200)}...`);
      }
      if (estimateTokens(trimmed.join('\n\n')) > budget) {
        break;
      }
    }

    context = trimmed.join('\n\n');
    return `${context}\n\n[NOTICE] Some files were summarized due to token budget limits.`;
  }

  private async recentGitFiles(): Promise<string[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      return [];
    }
    try {
      const { stdout } = await execAsync('git diff HEAD~1 --name-only', { cwd: root });
      return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 5);
    } catch {
      return [];
    }
  }

  private tokenize(input: string): string[] {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1);
  }

  private termFreq(input: string): Map<string, number> {
    const freq = new Map<string, number>();
    const tokens = this.tokenize(input);
    const total = tokens.length || 1;

    for (const token of tokens) {
      freq.set(token, (freq.get(token) ?? 0) + 1);
    }

    for (const [term, count] of freq.entries()) {
      freq.set(term, count / total);
    }

    return freq;
  }

  private computeIdf(docs: IndexedDoc[]): Map<string, number> {
    const idf = new Map<string, number>();
    const totalDocs = docs.length || 1;

    const docFreq = new Map<string, number>();
    for (const doc of docs) {
      for (const term of doc.terms.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
      }
    }

    for (const [term, count] of docFreq.entries()) {
      idf.set(term, Math.log((1 + totalDocs) / (1 + count)) + 1);
    }

    return idf;
  }

  private cosineTfidf(query: Map<string, number>, doc: Map<string, number>): number {
    let dot = 0;
    let qNorm = 0;
    let dNorm = 0;

    for (const [term, qtf] of query.entries()) {
      const idf = this.idf.get(term) ?? 0;
      const qValue = qtf * idf;
      const dValue = (doc.get(term) ?? 0) * idf;
      dot += qValue * dValue;
      qNorm += qValue * qValue;
    }

    for (const [term, dtf] of doc.entries()) {
      const idf = this.idf.get(term) ?? 0;
      const dValue = dtf * idf;
      dNorm += dValue * dValue;
    }

    if (qNorm === 0 || dNorm === 0) {
      return 0;
    }

    return dot / (Math.sqrt(qNorm) * Math.sqrt(dNorm));
  }
}
