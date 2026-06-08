import * as vscode from 'vscode';

export const NIM_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const SECRET_API_KEY = 'nimcoder.apiKey';

export const MODELS = {
  completion: 'mistralai/devstral-small',
  chatDefault: 'qwen/qwen3-coder-480b-a35b-instruct',
  agentDefault: 'deepseek-ai/deepseek-v4-flash',
  // Minimax (available model id observed from NIM model list)
  minimax: 'minimaxai/minimax-m2.7',
  reasoning: 'qwen/qwen3-235b-a22b-instruct',
  fallback: 'meta/llama-3.3-70b-instruct',
  nemotron: 'nvidia/llama-3.3-nemotron-super-49b-v1'
} as const;

export class ConfigService {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async getApiKey(): Promise<string | undefined> {
    return this.context.secrets.get(SECRET_API_KEY);
  }

  public async setApiKey(value: string): Promise<void> {
    await this.context.secrets.store(SECRET_API_KEY, value.trim());
  }

  public async clearApiKey(): Promise<void> {
    await this.context.secrets.delete(SECRET_API_KEY);
  }

  public get<T>(key: string, fallback: T): T {
    return vscode.workspace.getConfiguration('nimcoder').get<T>(key, fallback);
  }

  public getCompletionEnabled(): boolean {
    return this.get<boolean>('completions.enabled', true);
  }

  public getCompletionDelayMs(): number {
    return this.get<number>('completions.triggerDelay', 400);
  }

  public getPreferredChatModel(): string {
    return this.get<string>('preferredChatModel', MODELS.chatDefault);
  }

  public getPreferredAgentModel(): string {
    return this.get<string>('preferredAgentModel', MODELS.agentDefault);
  }

  public getMaxContextTokens(): number {
    return this.get<number>('maxContextTokens', 60000);
  }

  public getShowTokenCounter(): boolean {
    return this.get<boolean>('showTokenCounter', true);
  }

  public getAgentRequiresConfirmation(): boolean {
    return this.get<boolean>('agent.requireConfirmation', true);
  }
}
