# CHANGELOG

## 2026-06-08 - Workflow and UI Rebuild

### src/providers/chatPanel.ts
- Rebuilt agent mode into a staged workflow engine: `PLAN -> CONFIRM_PLAN -> EXECUTE -> VERIFY -> DONE`.
- Added in-chat plan confirmation gate with approval/modification handling.
- Added per-file diff review flow with `Accept / Modify / Reject` decisions.
- Added rejection follow-up handling (`skip / retry / abort`).
- Added read-card emission for file reads with line ranges and summaries.
- Added multi-file context tracking state and webview sync.
- Added rolling workflow summary and context budget indicator events.
- Added streamed terminal command cards with stop support and exit status reporting.
- Preserved regular chat modes and backward-compatible webview message handling.

### src/webview/chatPanel.html
- Replaced UI with a redesigned responsive layout.
- Added animated status indicator with three pulsing dots and phase-specific labels/icons.
- Implemented structured read cards with collapsible code view and file-type tagging.
- Implemented custom diff viewer with line numbers, add/remove highlighting, and collapsed unchanged context.
- Added diff action controls: `Accept Changes`, `Modify`, and `Reject`.
- Added inline reject resolution controls (`Skip`, `Retry`, `Abort`).
- Added terminal output cards with streamed lines, stop button, and exit code state.
- Reworked bottom tab bar into pill buttons with active/inactive states and transitions.
- Reworked sticky input area with attachment button, expandable textarea, token estimate, enhance action, and send-state handling.
- Added context sidebar for files-in-context and preview/open actions.

### src/utils/diffApplier.ts
- Added diff line stats helper for added/removed line counts.
- Added patch serializer for per-file diff cards and apply actions.
- Added pure patch apply helper export for testability.

### src/utils/readAnnotations.ts
- Added read annotation helpers:
  - file-path to language tag mapping,
  - snippet summary extraction,
  - normalized line-range annotation construction.

### src/workflow/stateMachine.ts
- Added explicit workflow stage machine with guarded transitions and timeline history.

### test/suite/extension.test.ts
- Replaced placeholder assertion with tests for:
  - unified diff apply behavior,
  - read annotation behavior,
  - workflow state transitions and invalid transition rejection.
