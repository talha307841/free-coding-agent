import OpenAI from 'openai';
import * as vscode from 'vscode';
import { ConfigService, NIM_BASE_URL } from './config';
import { ModelRouter, RouteKind } from './modelRouter';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export class NimClient {
  public constructor(
    private readonly config: ConfigService,
    private readonly router: ModelRouter,
    private readonly output: vscode.OutputChannel
  ) {}

  private async getClient(): Promise<OpenAI> {
    const apiKey = await this.config.getApiKey();
    if (!apiKey) {
      throw new Error('NVIDIA NIM API key is not configured.');
    }

    return new OpenAI({
      apiKey,
      baseURL: NIM_BASE_URL
    });
  }

  private async withRetry<T>(op: () => Promise<T>, model: string, attempts = 3): Promise<T> {
    const delays = [500, 1000, 2000];
    let lastError: unknown;

    for (let i = 0; i < attempts; i += 1) {
      try {
        return await op();
      } catch (error) {
        lastError = error;
        const maybeStatus = (error as { status?: number }).status;
        if (maybeStatus === 429) {
          this.router.recordRateLimit(model);
        }
        if (i < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, delays[i]));
        }
      }
    }

    throw lastError;
  }

  public async chat(request: ChatRequest): Promise<string> {
    const client = await this.getClient();
    const started = Date.now();

    const result = await this.withRetry(async () => {
      const response = await client.chat.completions.create({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: false
      }, { signal: request.signal });

      return response.choices[0]?.message?.content ?? '';
    }, request.model);

    this.router.recordLatency(request.model, Date.now() - started);
    return result;
  }

  public async *chatStream(request: ChatRequest): AsyncGenerator<string> {
    const client = await this.getClient();
    const started = Date.now();

    const stream = await this.withRetry(async () => {
      return client.chat.completions.create({
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        stream: true
      }, { signal: request.signal });
    }, request.model);

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) {
          yield delta;
        }
      }
    } finally {
      this.router.recordLatency(request.model, Date.now() - started);
    }
  }

  public selectRoutedModel(kind: RouteKind, preferred: string): string {
    return this.router.selectModel(kind, preferred);
  }

  public async completeFIM(prefix: string, suffix: string, signal?: AbortSignal): Promise<string> {
    const model = this.selectRoutedModel('completion', 'mistralai/devstral-small');
    const prompt = `${prefix}${suffix}`;

    const system = 'Complete the code at cursor location with minimal, valid continuation only.';
    const content = await this.chat({
      model,
      temperature: 0.1,
      maxTokens: 128,
      signal,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ]
    });

    this.output.appendLine(`[completion] model=${model} chars=${content.length}`);
    return content;
  }
}
