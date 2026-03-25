# Canvas-Aware UI Creation Plan

## Section 1: Architecture

### Changed Files
1. `src/main.js` [Backend/Main Process]
   - **`getNewSceneTemplate()`**: Will be replaced/updated. Instead of returning an empty scene array, it will return the JSON structure of Cocos Creator's default `new-scene.fire`, including `cc.Canvas`, `cc.Camera`, and `cc.Widget`. UUIDs inside this template will be uniquely generated to prevent collision.
   - **`getToolsList()`**: Update the JSON schema for the `create_node` tool to accept an optional `layout` parameter (enum: `center`, `top`, `full`, etc.).
2. `src/scene-script.js` [Frontend/Scene Process]
   - **`create-node` IPC Handler**: 
     - **Canvas Sniffing**: If `parentId` is empty and `type` is a UI node (`sprite`, `button`, `label`), find `cc.Canvas` in the scene. If found, use the node holding `cc.Canvas` as the parent.
     - **Layout Application**: After node creation, if `layout` is specified, call `addComponent(cc.Widget)` on the node and configure `isAlignHorizontalCenter`, `isAlignVerticalCenter`, `isAlignTop`, `top`, etc., based on the layout type.
     - **Response Update**: Reply message will indicate whether the node was appended to `Canvas` or `Scene` and provide the design resolution.

## Section 2: Step-by-Step

- [x] **[Backend] Update `getNewSceneTemplate` in `src/main.js`**
  - Extract the JSON array from `e:\CocosEditor\Creator\2.4.15\resources\static\template\new-scene.fire` (or a generic version of it).
  - Write a function that replaces the internal `_id` strings (like `"324247e8-..."`) with newly generated random UUIDs using `Editor.Utils.UuidUtils.uuid()` or crypto so each new scene is unique.
  - Return the updated template string instead of the old blank array.

- [x] **[Backend] Update `create_node` Schema in `src/main.js`**
  - In `getToolsList()`, locate the `create_node` definition.
  - Add mapping for `layout: { type: "string", enum: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right", "full"] }` to the properties.

- [x] **[Frontend] Implement Canvas Sniffing in `src/scene-script.js`**
  - In the `create-node` case, when `parentId` is NOT truthy and `type` is `"sprite"`, `"button"`, or `"label"`:
  - Search for canvas: `const canvasComp = scene.getComponentInChildren(cc.Canvas);`
  - If `canvasComp` exists, set `parent = canvasComp.node` instead of `parent = scene`.

- [x] **[Frontend] Implement Auto Layout in `src/scene-script.js`**
  - After `newNode.parent = parent;`, check if `args.layout` is provided.
  - If true, add `cc.Widget`: `const widget = newNode.addComponent(cc.Widget);`
  - Setup a switch-case or mapping for `layout` types (e.g. `center` sets `widget.isAlignHorizontalCenter = true`, `widget.isAlignVerticalCenter = true`).
  - **CRITICAL FIX**: Do *not* call `widget.updateAlignment()` synchronously in the same frame as node creation. Due to editor viewport stretching and stale matrix transformation, calling it immediately causes a 2x coordinate multiplier offset. Let the editor's async `LateUpdate` or `WidgetManager` align it naturally on the next tick.
  
- [x] **[Frontend] Enhance creation reply in `src/scene-script.js`**
  - Modify the `event.reply` at the end of `create-node` to include context.
  - Example: `event.reply(null, `节点创建成功 UUID: ${newNode.uuid}, 已自动挂载至 ${parent.name}`)`.
