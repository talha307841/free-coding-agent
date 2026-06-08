# Chat UI Behavior

## Modes

The chat panel supports five modes:

- Chat, Discuss, Plan, and Research are non-editing modes. They should answer, explain, or plan without writing files or emitting action JSON.
- Agent mode is the code-change mode. It asks the model for a unified diff and shows a review action in the response.

## Change Safety

The hand button in the header controls `nimcoder.agent.requireConfirmation`.

- `Ask` means proposed changes stay in chat until the user clicks **Review proposed changes**.
- `Auto` lets Agent mode open the diff review automatically, but VS Code still requires accepting the diff before edits are applied.
- Chat text is never scanned for filename fences or action blocks to write files automatically.
- Code block **Save** buttons are explicit user actions.

## Message Layout

Messages are rendered as vertical bubbles inside the scroll area. Each bubble has a fixed avatar column and a flexible content column with `min-width: 0`, so long words, markdown, tables, and code blocks cannot push the response sideways.

Code blocks scroll horizontally inside their own block. Normal prose wraps within the message bubble.

## Streaming Status

Generation status is attached to the assistant response being generated. Status updates such as `Thinking...`, `Reading...`, `Writing...`, and `Running...` appear at the top of the active assistant bubble and are hidden when generation finishes.
