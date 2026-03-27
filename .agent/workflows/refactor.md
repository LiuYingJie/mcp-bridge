---
description: 在开发新功能前的老旧代码重构与清理
---

## 用户输入

$ARGUMENTS

## 执行指令

1. **全面审计 (Audit)**: 扫描目标目录 `$ARGUMENTS` 下的相关代码。
2. **宪章对齐 (Constitution Check)**: 严格对照 `memory/constitution.md` 的规范（例如检查进程隔离是否到位、是否越界调用 `cc.`、有无遗留 `console.log()` 等）。
3. **安全重构 (Refactor)**: 
   * 采用现代 Node.js 范式（例如“将冗余的回调层级 Promise 化升维为 Async/Await”）。
   * 提防 `main.js` 的重复函数缺陷并予以清理。
   * **绝对不能** 改变现有的核心业务逻辑，且重构产生的所有注释都**必须使用中文**。
4. **回归验证 (Verify)**: 运行 `test/` 目录下相关的测试用例以确保没有引入退化故障 (Regression)。