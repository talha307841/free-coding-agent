# NIM Coder Chat Panel Documentation

## Overview

The NIM Coder chat panel is a web-based interface embedded in Visual Studio Code that provides an interactive chat experience with AI coding assistants. It features multiple modes of operation and rich UI components for code interaction.

## UI Components

### Header
- **Logo**: NIM Coder branding with distinctive green lightning bolt icon
- **Model Selector**: Dropdown to choose between different AI models:
  - `mistralai/devstral-small`
  - `deepseek-ai/deepseek-v4-flash`
  - `qwen/qwen3-coder-480b-a35b-instruct`
- **Clear Button**: Trash icon to remove all chat history

### Main Content Area
- **Message Bubbles**: 
  - User messages (right-aligned, dark blue background)
  - Assistant responses (left-aligned, bordered with green accent)
- **Welcome Message**: Initial placeholder with app introduction

### Mode Selector
Five distinct modes for different workflows:
1. **Chat**: General conversation mode
2. **Agent**: Autonomous task execution mode
3. **Plan**: Feature planning mode
4. **Research**: In-depth research mode
5. **Discuss**: Collaborative discussion mode

### Input Area
- **Text Input**: Resizable textarea with smart placeholder text that changes per mode
- **Enhance Button**: Sparkle icon to improve prompts
- **Token Counter**: Estimates token usage in the input
- **Stop Button**: Square icon to halt generation
- **Send Button**: Green send arrow to submit messages

### Status Bar
- Shows current operation status:
  - Thinking...
  - Reading...
  - Writing...
  - Running...

## Features

### Code Block Interactions
- **Copy Button**: Copies code to clipboard with visual confirmation
- **Run Button**: Executes shell commands in VS Code terminal
- **Save Button**: Saves code blocks to files when labeled with filenames
- **Language Detection**: Shows language badge for syntax highlighting

### Message Handling
The interface supports:
- Real-time streaming of AI responses
- Markdown rendering for rich text formatting
- Syntax highlighting for code blocks
- Auto-scrolling to follow conversation
- Token estimation for input content

### Communication
Uses VS Code's messaging API for bidirectional communication between the webview and extension backend.

## Styling

The UI uses a dark theme optimized for code environments with:
- Nim green (#00FF87) as primary accent color
- Custom styling for user/assistant messages
- Responsive layout with proper spacing
- Custom SVG icons for all actions
- JetBrains Mono font for code elements

## Technical Implementation

- Uses `marked` for Markdown parsing
- Uses `highlight.js` for code syntax highlighting
- Implements a Content Security Policy for security
- Communicates with the extension backend through `vscode.postMessage`
- Fully self-contained in a single HTML file
