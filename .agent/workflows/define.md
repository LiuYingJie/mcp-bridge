---
description: 创建单一且严谨的功能规格说明 (Spec)
---

## 用户输入
$ARGUMENTS

## 执行指令

1.  **上下文阅读**: 仔细阅读 `memory/constitution.md`，理解本项目架构限制与中文强制要求，并查看任何附加图片。
2.  **起草规格 (Draft Spec)**:
    * 仅创建或更新 **唯一一个文件**: `specs/[功能名称]/spec.md`。
    * **绝对不要** 创建额外的清单文件（checklist）。
    * **绝对不要** 创建分离的分析文件。
3.  **内容要求**:
    * 包含 "视觉需求 (Visual Requirements)" (若有视觉图片或 UI 设计要求，需考虑引入精确的坐标映射或 MCP CV 识别工具方案)。
    * 包含 "功能需求 (Functional Requirements)"（严格遵守进程隔离原则）。
    * 必须在 specs 文件中设立专门的 "边缘情况 (Edge Cases)" 章节。
    * **所有文档内容必须使用中文**。
4.  **最终输出**: 利用工具完成 `spec.md` 产出并告知用户。