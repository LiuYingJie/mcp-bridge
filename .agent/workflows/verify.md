---
description: 针对功能的视觉表现与业务逻辑进行深度验收
---

## Antigravity QA (AI质量保证) 执行指令

1. **环境准备**: 在内置终端/集成浏览器中启动相应的环境或测试面板。对于 MCP Bridge 插件，需确保扩展已刷新且 Node 服务就绪。
2. **视觉审查 (Visual Audit)**:
   - 导航至或开启新功能的界面。
   - **执行截图 (TAKE SCREENSHOT)**。
   - 严格比对截图与 `spec.md` 中的设计预期。若涉及 UI 切图拼接，需借助坐标验证。
   - 产出审查结论："像素级匹配 (Match)" 或 "存在偏差 (Discrepancy)"。
3. **逻辑审查 (Logic Audit)**:
   - 走一遍用户典型的 "愉快路径 (Happy Path)" 流程。
   - 仔细翻阅控制台日志或拦截器，确保没有任何潜在的挂起或错误回调。
   - 检查 IPC 通信消息流（如 `main.js` 发往 `scene-script.js` 并返回）是否畅通死锁。
4. **结项报告 (Report)**:
   - 生成一份标准的 **发布就绪验收报告 (Release Readiness Artifact)**。
   - **报告必须全文使用中文撰写**。