import * as vscode from 'vscode';
import { MODELS } from './config';

interface ModelHealth {
  latencies: number[];
  rateLimitedUntil?: number;
}

export type RouteKind = 'completion' | 'chat' | 'agent';

export class ModelRouter {
  private readonly health = new Map<string, ModelHealth>();

  public constructor(private readonly output: vscode.OutputChannel) {}

  private ensure(model: string): ModelHealth {
    const existing = this.health.get(model);
    if (existing) {
      return existing;
    }
    const created: ModelHealth = { latencies: [] };
    this.health.set(model, created);
    return created;
  }

  public recordLatency(model: string, ms: number): void {
    const health = this.ensure(model);
    health.latencies.push(ms);
    if (health.latencies.length > 10) {
      health.latencies.shift();
    }
  }

  public recordRateLimit(model: string): void {
    const health = this.ensure(model);
    health.rateLimitedUntil = Date.now() + 30_000;
    this.output.appendLine(`[router] ${model} rate-limited, cooling down for 30s`);
  }

  public getAverageLatency(model: string): number {
    const health = this.ensure(model);
    if (health.latencies.length === 0) {
      return 0;
    }
    const total = health.latencies.reduce((sum, value) => sum + value, 0);
    return Math.round(total / health.latencies.length);
  }

  private isRateLimited(model: string): boolean {
    const health = this.ensure(model);
    return typeof health.rateLimitedUntil === 'number' && health.rateLimitedUntil > Date.now();
  }

  private routeCandidates(kind: RouteKind, preferred: string): string[] {
    const defaults: Record<RouteKind, string[]> = {
      completion: [MODELS.completion, MODELS.nemotron, MODELS.fallback],
      chat: [preferred, MODELS.chatDefault, MODELS.reasoning, MODELS.fallback],
      agent: [preferred, MODELS.agentDefault, MODELS.chatDefault, MODELS.fallback]
    };

    const unique: string[] = [];
    for (const model of defaults[kind]) {
      if (!unique.includes(model)) {
        unique.push(model);
      }
    }
    return unique;
  }

  public selectModel(kind: RouteKind, preferred: string): string {
    const candidates = this.routeCandidates(kind, preferred);
    for (const model of candidates) {
      if (this.isRateLimited(model)) {
        continue;
      }
      const avg = this.getAverageLatency(model);
      if (model === preferred && avg > 3000) {
        this.output.appendLine(`[router] downgrading from ${model} because avg latency is ${avg}ms`);
        continue;
      }
      this.output.appendLine(`[router] selected model=${model} kind=${kind} avgLatency=${avg}ms`);
      return model;
    }
    const fallback = MODELS.fallback;
    this.output.appendLine(`[router] all candidates unavailable; fallback model=${fallback}`);
    return fallback;
  }
}
