# Canvas-Aware UI Creation Spec

## Overview
Currently, the AI frequently creates UI nodes (Sprites, Buttons, Labels) directly under the Scene root or at `(0, 0)`, ignoring the Canvas design resolution. While this could be addressed by creating an AI "Skill" (a markdown SOP guiding the AI to manually find the Canvas and add `cc.Widget`), a **better and more robust way** is to encapsulate this logic directly within the `create_node` MCP tool and `scene-script.js`. This reduces AI hallucination, saves token usage, and guarantees reliable layout.

## 核心痛点与解决方案 (Core Problem & Solution)

### 问题 (The Problem)
AI 在创建 UI 节点时，缺乏场景全局上下文（如 Canvas 尺寸），导致：
1. UI 节点经常被挂载到 Scene 根目录而非 Canvas 下（渲染异常或层级错误）。
2. AI 试图手动设置坐标（x/y），经常计算错误，导致节点在屏幕外部。
3. AI 忘记挂载 `cc.Widget` 组件，或者挂载后不了解各个边缘对齐参数的正确含义。
4. 如果纯粹依靠写一个 Skill 让 AI 自己通过多步调用（找 Canvas -> 创节点 -> 加 Widget -> 设参数），流程极长，极易由于网络或单步错误导致中断。

### 更好的方案 (The Better Way: Native Code Encapsulation)
利用代码级别的封装，扩展现有的 `create-node` 和添加特定的 UI 布局能力，而不是强行用 prompt 约束 AI。
1. **自动挂载 Canvas (Auto-Canvas Parenting)**：在 `scene-script.js` 的 `create-node` 中，如果节点类型是 UI 组件且没有指定 `parentId`，引擎自动查找当前场景的 `cc.Canvas`，并将其设为父节点。
2. **集成快捷布局参数 (Quick Layout Parameter)**：为 `create_node` 扩展一个可选参数 `layoutType` （如 `center`, `top-left`, `stretch` 面向意图的声明式参数）。Cocos 侧接收后，自动挂载 `cc.Widget` 并根据预设配好对齐常量。

## Visual Requirements
- 所有的 UI 元素（Button, Label, Sprite等）默认都必须在 Canvas 的可视范围内。
- 当使用了特定的 `layoutType` 后，节点在 Cocos Creator 的编辑器中应当能正确展示 `cc.Widget` 的蓝色对齐边框，并自动吸附。

## Functional Requirements

### 1. `scene-script.js` 中的逻辑改造
针对 `create-node` IPC 消息处理函数：
- **Canvas 嗅探**：如果 `type` 是 `sprite`, `button`, 或 `label`，并且接收到的 `parentId` 为空：
  - 代码内部通过 `cc.director.getScene().getComponentInChildren(cc.Canvas)` 获取当前的有效 Canvas 节点。
  - 获取成功则自动将该 UI 节点 parent 设置为 Canvas 所在的节点。
  - 获取失败则降级到 Scene Root 并警告。
- **Widget 自动化填充**：如果 JSON 参数中携带了 `layout` 字段（如 `center`, `top`, `full`）：
  - 自动为新节点执行 `newNode.addComponent(cc.Widget)`。
  - 根据 `layout` 的值，自动配置对齐选项。例如 `center`: 开启水平和垂直居中；`full`: 上下左右都对齐，边距为 0；`top-left`: 开启顶部和左侧对齐。

### 2. `main.js` 中 `create_node` 工具界面的扩展
在 `getToolsList` 返回的 `create_node` schema 中，增加 `layout` 字段：
```json
layout: {
    type: "string",
    enum: ["center", "top", "bottom", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right", "full"],
    description: "自动挂载 cc.Widget 并进行快捷排版适配。推荐绝大多数 UI 元素在创建时使用此参数替代手动指定坐标。"
}
```

### 3. 工具响应信息的增强
在 `create_node` 成功创建节点返回时，附带当前命中 Canvas 的分辨率信息，使 AI 拥有感知能力：
```js
event.reply(null, `节点创建成功 UUID: xxx, 父节点: Canvas(960x640)`);
```

### 4. 场景创建模板的升级 (Scene Template Upgrade)
当前 `create_scene` 工具生成的是一个完全空白的场景结构，导致后续 UI 创建时找不到基础环境。
- **模板替换**：将 `main.js` 中的 `getNewSceneTemplate()` 升级为读取 Cocos Creator 安装目录下的内置模板文件（例如：`Editor.url('db://internal/template/new-scene.fire')` 对应的内部实际文件，或参照 `e:\CocosEditor\Creator\2.4.15\resources\static\template\new-scene.fire` 建立一个本地硬编码/读取的完整模板）。
- **默认包含节点**：新生成的场景必须默认包含 `Canvas` 节点（预设 960x640）、`Main Camera` 节点以及 `cc.Widget` 和 `cc.Canvas` 组件，与引擎原生“新建场景”保持完全一致。这样为后续的自动 Canvas 挂载提供基础保障。

## Edge Cases (边缘情况处理)
- **场景中不存在 Canvas**：如果 `parent` 解析失败且场景中确实找不到 Canvas，应该退回到 Scene 的下层，并在日志/返回集中向 AI 发出明确警告：“Warning: No Canvas found in scene, spawned at Scene Root.”
- **带偏移量的布局**：如果用户希望偏移（例如左上角但边距 20px），AI 依然可以使用 `manage_components` 来精确调整已被自动挂载上的 `cc.Widget` 的 `top`/`left` 属性。`layout` 参数仅负责初始化基准对齐方式。
- **多次覆盖/误操作**：如果是用现有的 `update_node_transform` 工具，必须注意 `cc.Widget` 开启状态下手动修改 x/y 可能无效，应提醒 AI 通过 `manage_components` 去更新 `cc.Widget` 的偏移值。
- **⚠️ 核心生命周期陷阱 (Widget & Transform Update)**：在原生插件开发中（或通过场景脚本当帧注入节点），**绝不可**在挂载 `cc.Widget` 后立刻同帧同步调用 `widget.updateAlignment()` 并试图获取坐标分配，更**不可**同时设置 `node.x` / `node.y`。这会导致引擎编辑器视口的矩阵拉伸（例如 Canvas 在编辑器变为 1770x1180）被反向误写入 `cc.Widget` 的边距（例如 `bottom=-295`），从而在运行时彻底飞出屏幕。标准流程是：只赋语义属性（`bottom: 0`），将其交由引擎在下一帧 `LateUpdate` 时依照真实包围盒自动对齐！
