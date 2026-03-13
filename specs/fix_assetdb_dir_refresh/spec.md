# manage_texture 创建资源时中间目录显示异常分析

## 问题描述

用户反馈：使用 `manage_texture` 创建贴图并指定路径 `db://assets/textures/NewTexture2.png` 时，若中间目录 `textures/` 不存在：

- **文件系统层面**：目录和文件均正确创建
- **编辑器 UI 层面**：新建的纹理直接平铺显示在 `assets` 根目录下，而非嵌套在 `textures/` 目录内
- **需要重启编辑器**才能看到正确的层级结构

![用户截图——纹理平铺在 assets 根目录](file:///C:/Users/Firekula/.gemini/antigravity/brain/86e3a562-03f1-4896-b73e-ec7097232d7d/user_screenshot.png)

---

## 根因分析

### 核心问题：绕过 AssetDB 创建目录

[manageTexture create 操作](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L2206-L2280) 的流程如下：

```javascript
// L2211-2215: 使用 Node.js fs 直接创建目录
const absolutePath = Editor.assetdb.urlToFspath(path);
const dirPath = pathModule.dirname(absolutePath);
if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });  // ← 绕过 AssetDB
}

// L2227: 写入物理文件
fs.writeFileSync(absolutePath, buffer);

// L2230: 只刷新了文件路径，未刷新新建的父目录
Editor.assetdb.refresh(path, (err, results) => { ... });
```

> [!CAUTION]
> `fs.mkdirSync` 直接在文件系统创建了目录，但 **Cocos Creator 的 AssetDB 对此完全无感知**。后续 `Editor.assetdb.refresh(path)` 只刷新了文件本身（`NewTexture2.png`），并未通知 AssetDB「`textures/` 目录是新创建的」。

### AssetDB 内部机制

Cocos Creator 2.x 的 `Editor.assetdb` 维护了一个内部的 **资源 URL → UUID 映射表**（内存数据库）。当通过 `fs` 直接创建目录时：

1. AssetDB 的内部映射表中**不存在** `db://assets/textures/` 这个目录条目
2. `refresh(filePath)` 只对 **文件本身** 执行导入流程，不会向上递归注册父目录
3. 编辑器的资源管理器 UI 依赖内部映射表渲染树形结构
4. 由于映射表中没有 `textures/` 目录，UI 无法构建正确的层级 → 文件被显示为 `assets` 的直接子项

### 已有正确实现的对比

[prefab_management 的 create 流程](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1850-L1858) **已正确处理此问题**：

```diff
 if (!fs.existsSync(dirPath)) {
     fs.mkdirSync(dirPath, { recursive: true });
+    // 【增强】确保 AssetDB 刷新文件夹
+    Editor.assetdb.refresh(targetDir);
 }
```

---

## 影响范围

除 `manage_texture` 外，以下工具存在**完全相同的问题**：

| 工具                | 代码位置                                                                          | 是否有目录刷新 |
| ------------------- | --------------------------------------------------------------------------------- | :------------: |
| `prefab_management` | [L1854-1858](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1854-L1858) |   ✅ 已修复    |
| `manage_texture`    | [L2213-2215](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L2213-L2215) |    ❌ 缺失     |
| `manage_shader`     | [L1992-1994](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1992-L1994) |    ❌ 缺失     |
| `manage_material`   | [L2109-2111](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L2109-L2111) |    ❌ 缺失     |

---

## 潜在风险

### 1. AssetDB 路径解析失败（高风险）

后续工具调用中使用 `Editor.assetdb.urlToUuid("db://assets/textures/NewTexture2.png")` 可能返回 `null`，因为 AssetDB 映射表不完整。这会导致：

- `manage_texture` 的 `update` / `get_info` 操作失败
- 其他工具尝试引用该纹理时无法获取 UUID
- 组件赋值（如 `cc.Sprite.spriteFrame`）使用 UUID 查找时失败

### 2. 重复创建目录/文件（中风险）

由于 `Editor.assetdb.exists(path)` 查的是 AssetDB 内部映射，而非文件系统：

- 对已存在但未注册的目录路径，`exists()` 返回 `false`
- 再次 create 同一路径的资源时，`fs.writeFileSync` 会**静默覆盖**已有文件
- 没有 "已存在" 的保护机制生效

### 3. 多级嵌套目录问题（中风险）

如果指定 `db://assets/textures/ui/icons/icon.png`，`mkdirSync({ recursive: true })` 会创建多级目录，但 `Editor.assetdb.refresh` 即使刷新了最内层文件，中间的 `textures/`、`ui/`、`icons/` 目录都不会出现在编辑器树中。

### 4. `refresh` 竞态条件（低风险）

`Editor.assetdb.refresh(path)` 是异步的。在 `manage_texture` 的 create 中，文件写入（同步）后立即调用 `refresh`，但如果 AssetDB 尚未注册父目录，refresh 可能在某些边缘情况下静默失败或产生不完整的导入结果。

---

## 功能需求（修复方案）

### 核心修复

对 `manage_texture`、`manage_shader`、`manage_material` 三个工具的 `create` 分支，在 `fs.mkdirSync` 之后增加 `Editor.assetdb.refresh(parentDirUrl)` 调用，与 `prefab_management` 保持一致。

```javascript
// 修复模式（参照 prefab_management）
const targetDir = path.substring(0, path.lastIndexOf("/"));
const absolutePath = Editor.assetdb.urlToFspath(path);
const dirPath = pathModule.dirname(absolutePath);
if (!fs.existsSync(dirPath)) {
	fs.mkdirSync(dirPath, { recursive: true });
	Editor.assetdb.refresh(targetDir); // ← 关键：通知 AssetDB 注册新目录
}
```

### 需要修改的文件

#### [MODIFY] [main.js](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js)

三处修改点：

1. **`manageTexture` create**（L2213-2215）：增加 `Editor.assetdb.refresh(targetDir)`
2. **`manageShader` create**（L1992-1994）：增加 `Editor.assetdb.refresh(targetDir)`
3. **`manageMaterial` create**（L2109-2111）：增加 `Editor.assetdb.refresh(targetDir)`

---

## 边界情况

| 场景                                      | 预期行为                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| 目录已存在                                | 不执行 `mkdirSync`，不调用额外 `refresh`，无行为变化                                 |
| 单级新目录 `db://assets/tex/a.png`        | 创建 `tex/` 并刷新，UI 立即正确                                                      |
| 多级新目录 `db://assets/a/b/c/d.png`      | `recursive: true` 创建全部层级，`refresh("db://assets/a/b/c")` 触发 AssetDB 递归注册 |
| 资源路径不含新目录 `db://assets/test.png` | `fs.existsSync` 返回 `true`，跳过整个分支，无变化                                    |

---

## 验证方案

### 手动测试

1. 启动 Cocos Creator 编辑器，确保 MCP Bridge 已启动
2. 通过 HTTP 调用 `manage_texture` 创建纹理至一个**不存在的目录**：
    ```bash
    curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/test_dir_refresh/NewTexture.png\"}}"
    ```
3. **不重启编辑器**，检查资源管理器树中是否正确显示 `test_dir_refresh/` → `NewTexture.png` 的层级
4. 对 `manage_shader` 和 `manage_material` 重复类似测试
5. 清理测试资源
