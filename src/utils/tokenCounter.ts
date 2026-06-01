export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(messages: Array<{ content: string }>): number {
  let total = 0;
  for (const message of messages) {
    total += estimateTokens(message.content) + 6;
  }
  return total;
}

export function mergeUsage(current: TokenUsage, delta: Partial<TokenUsage>): TokenUsage {
  const promptTokens = current.promptTokens + (delta.promptTokens ?? 0);
  const completionTokens = current.completionTokens + (delta.completionTokens ?? 0);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens
  };
}
