import * as vscode from 'vscode';

export interface ScannedFile {
  path: string;
  uri: vscode.Uri;
  content: string;
}

const DEFAULT_EXCLUDES = '**/{.git,node_modules,dist,out,build,.next,target,coverage}/**';

export async function listWorkspaceFiles(): Promise<vscode.Uri[]> {
  return vscode.workspace.findFiles('**/*', DEFAULT_EXCLUDES);
}

export async function scanWorkspaceFiles(maxFileSizeBytes = 512000): Promise<ScannedFile[]> {
  const uris = await listWorkspaceFiles();
  const scanned: ScannedFile[] = [];

  for (const uri of uris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.size > maxFileSizeBytes) {
        continue;
      }
      const bytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(bytes).toString('utf8');
      if (content.includes('\u0000')) {
        continue;
      }
      scanned.push({ path: vscode.workspace.asRelativePath(uri), uri, content });
    } catch {
      // Ignore unreadable files and continue scanning.
    }
  }

  return scanned;
}

export async function getWorkspaceTree(limit = 300): Promise<string[]> {
  const uris = await listWorkspaceFiles();
  return uris.slice(0, limit).map((uri) => vscode.workspace.asRelativePath(uri));
}
