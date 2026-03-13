# Project Constitution — MCP Bridge (Cocos Creator 2.4.x Plugin)

## Article I: The Artifact Mandate
**Agents shall not perform work without a visible Artifact.**
- Every planning step must produce a Markdown Artifact (Plan, Spec, or Checklist).
- Never rely on "chat memory" alone. If it's important, write it to a file.

## Article II: Vision Verification
**Trust but Verify (Visually).**
- When implementing UI (Panel), the Agent MUST take a screenshot using the integrated Browser.
- Compare the screenshot to the original requirement/mockup.
- If pixels don't match, the task is incomplete.

## Article III: Agent Independence
**Build for Parallelism.**
- Tasks must be atomic.
- Main-process work and Scene-script work should be designed independently.
- Never block a thread waiting for another agent.

## Article IV: Code Health
- **Target Runtime**: Cocos Creator 2.4.x (Node.js style `require`, no ES Modules).
- **Syntax**: Use ES6+ features supported by the Cocos Creator main process (arrow functions, template literals, const/let, destructuring). No React, no TypeScript in the plugin itself.
- **No Legacy Patterns**: Prefer `async/await` where possible; use callbacks only when required by Cocos/Editor APIs.
- **Self-Correction**: If a test fails, attempt to fix it *once* before asking the user.

## Article V: Architecture Rules
- **Process Isolation**: `main.js` runs in Main Process (access `Editor.assetdb`, `Editor.Ipc`); `scene-script.js` runs in Renderer Process (access `cc.*`). **Never cross these boundaries.**
- **Path Resolution**: Always convert `db://` paths to UUID in `main.js` before passing to `scene-script.js`.
- **IPC Pattern**: HTTP Request → `main.js` → `Editor.Scene.callSceneScript()` → `scene-script.js` → result back.
- **Logging**: Use `addLog(type, message)` instead of `console.log()`.

## Article VI: Naming Conventions
| Type | Convention | Example |
|------|-----------|---------|
| Functions | camelCase | `handleMcpCall` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_PORT` |
| MCP Tool Names | snake_case | `get_selected_node` |
| IPC Messages | kebab-case | `get-hierarchy` |

## Article VII: Forbidden Patterns
- ❌ `console.log()` — use `addLog()` instead.
- ❌ Accessing `cc.*` from `main.js`.
- ❌ Accessing `Editor.assetdb` from `scene-script.js`.
- ❌ Duplicate function definitions in `main.js`.
- ❌ ES Modules (`import`/`export`) — use `require()`/`module.exports`.