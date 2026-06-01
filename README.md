# NIM Coder

NIM Coder is a production-focused VS Code extension that connects to free NVIDIA NIM models through their OpenAI-compatible API.

## Features

- Inline ghost-text completions with fast model routing
- Sidebar chat panel with streaming tokens, model selector, and prompt enhancement
- Unified diff proposal workflow with accept/reject actions
- Right-click code actions:
  - Explain Code
  - Refactor This
  - Fix Bug
  - Add Documentation
  - Generate Unit Tests
  - Optimize Performance
- Diagnostic quick fix: ✨ Fix with NIM Coder
- Autonomous agent loop with workspace context and terminal feedback
- Smart context packing with TF-IDF relevance scoring
- Secure API key storage via VS Code SecretStorage

## Requirements

- VS Code 1.85+
- Node.js 18+

## Install and Run

1. Install dependencies:
	- npm install
2. Compile the extension:
	- npm run compile
3. Press F5 in VS Code to launch Extension Development Host.

## First-time Onboarding

On first activation, NIM Coder opens a welcome setup panel:

1. Get your free key at https://build.nvidia.com
2. Paste the API key
3. Pick your default model
4. Test connection

You can also run command:

- NIM Coder: Set API Key

## Command List

- NIM Coder: Open Chat
- NIM Coder: Focus Chat
- NIM Coder: Start Agent Task
- NIM Coder: Set API Key
- NIM Coder: Explain Code
- NIM Coder: Refactor This
- NIM Coder: Fix Bug
- NIM Coder: Add Documentation
- NIM Coder: Generate Unit Tests
- NIM Coder: Optimize Performance

## Settings

- nimcoder.completions.enabled
- nimcoder.completions.triggerDelay
- nimcoder.preferredChatModel
- nimcoder.preferredAgentModel
- nimcoder.maxContextTokens
- nimcoder.showTokenCounter
- nimcoder.agent.requireConfirmation

## Security

- API key is stored only in VS Code SecretStorage under nimcoder.apiKey
- API keys are never logged to output
- Chat webview enforces Content-Security-Policy

## NVIDIA NIM Endpoint

- Base URL: https://integrate.api.nvidia.com/v1

## Development Notes

The bundle is built with esbuild to dist/extension.js.

Compile command:

- esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node