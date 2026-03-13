# 资源处理问题统一修复 — 实施计划

## 一、架构

### 变更文件

| 文件                                                               | 变更类型 | 说明                                             |
| ------------------------------------------------------------------ | :------: | ------------------------------------------------ |
| [main.js](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js) |  MODIFY  | 统一 5 个函数的目录创建逻辑为 `_ensureParentDir` |

### 核心改动

唯一的改动文件是 `src/main.js`，**无新文件、无删除文件**。

改动策略：将 5 个函数中手工处理目录的代码替换为调用已有的 `_ensureParentDir(dbUrl, done)` 辅助函数，该函数已包含：

1. `fs.mkdirSync({ recursive: true })` 创建物理目录
2. `Editor.assetdb.refresh(parentUrl, callback)` 注册到 AssetDB
3. **等待回调**后才继续

---

## 二、实施步骤

### Step 1 — 修改 `manageAsset.create`（P2）

- [x] **[Backend]** 将 L1692-1699 的裸 `fs.mkdirSync` 替换为 `_ensureParentDir`，在回调中执行 `Editor.assetdb.create`

```diff
 case "create":
     if (Editor.assetdb.exists(path)) {
         return callback(`资源已存在: ${path}`);
     }
-    // 确保父目录存在
-    const fs = require("fs");
-    const pathModule = require("path");
-    const absolutePath = Editor.assetdb.urlToFspath(path);
-    const dirPath = pathModule.dirname(absolutePath);
-    if (!fs.existsSync(dirPath)) {
-        fs.mkdirSync(dirPath, { recursive: true });
-    }
-    Editor.assetdb.create(path, content || "", (err) => {
-        callback(err, err ? null : `资源已创建: ${path}`);
+    this._ensureParentDir(path, () => {
+        Editor.assetdb.create(path, content || "", (err) => {
+            callback(err, err ? null : `资源已创建: ${path}`);
+        });
     });
```

### Step 2 — 修改 `manageScript.create`（P3）

- [x] **[Backend]** 将 L1557-1562 的裸 `fs.mkdirSync` 替换为 `_ensureParentDir`，在回调中执行 `Editor.assetdb.create`

```diff
 case "create":
     if (Editor.assetdb.exists(scriptPath)) {
         return callback(`脚本已存在: ${scriptPath}`);
     }
-    // 确保父目录存在
-    const absolutePath = Editor.assetdb.urlToFspath(scriptPath);
-    const dirPath = pathModule.dirname(absolutePath);
-    if (!fs.existsSync(dirPath)) {
-        fs.mkdirSync(dirPath, { recursive: true });
-    }
-    Editor.assetdb.create(
-        scriptPath,
-        content || `...`,
-        (err) => { ... },
-    );
+    this._ensureParentDir(scriptPath, () => {
+        Editor.assetdb.create(
+            scriptPath,
+            content || `...`,
+            (err) => { ... },
+        );
+    });
```

### Step 3 — 修改 `sceneManagement.create`（P4）

- [x] **[Backend]** 将 L1763-1768 的裸 `fs.mkdirSync` 替换为 `_ensureParentDir`

```diff
 case "create":
     if (Editor.assetdb.exists(path)) {
         return callback(`场景已存在: ${path}`);
     }
-    // 确保父目录存在
-    const absolutePath = Editor.assetdb.urlToFspath(path);
-    const dirPath = pathModule.dirname(absolutePath);
-    if (!fs.existsSync(dirPath)) {
-        fs.mkdirSync(dirPath, { recursive: true });
-    }
-    Editor.assetdb.create(path, getNewSceneTemplate(), (err) => {
-        callback(err, err ? null : `场景已创建: ${path}`);
+    this._ensureParentDir(path, () => {
+        Editor.assetdb.create(path, getNewSceneTemplate(), (err) => {
+            callback(err, err ? null : `场景已创建: ${path}`);
+        });
     });
```

### Step 4 — 修改 `sceneManagement.duplicate`（P4）

- [x] **[Backend]** 将 L1803-1807 的裸 `fs.mkdirSync` 替换为 `_ensureParentDir`

```diff
-    // 确保目标目录存在
-    const targetAbsolutePath = Editor.assetdb.urlToFspath(targetPath);
-    const targetDirPath = pathModule.dirname(targetAbsolutePath);
-    if (!fs.existsSync(targetDirPath)) {
-        fs.mkdirSync(targetDirPath, { recursive: true });
-    }
-    // 创建复制的场景
-    Editor.assetdb.create(targetPath, content, (err) => {
+    this._ensureParentDir(targetPath, () => {
+        Editor.assetdb.create(targetPath, content, (err) => {
+            ...
+        });
     });
```

### Step 5 — 修改 `prefabManagement.create`（P5）

- [x] **[Backend]** 将 L1850-1877 的 `fs.mkdirSync` + 无回调 `refresh` + `setTimeout(300)` 替换为 `_ensureParentDir` + 回调链，消除竞态条件

```diff
-    // 从完整路径中提取 db:// 目录路径
-    const targetDir = prefabPath.substring(0, prefabPath.lastIndexOf("/"));
-    // 确保父目录存在
-    const absolutePath = Editor.assetdb.urlToFspath(prefabPath);
-    const dirPath = pathModule.dirname(absolutePath);
-    if (!fs.existsSync(dirPath)) {
-        fs.mkdirSync(dirPath, { recursive: true });
-        Editor.assetdb.refresh(targetDir);
-    }
-
     // 解析目标目录和文件名
+    const targetDir = prefabPath.substring(0, prefabPath.lastIndexOf("/"));
     const fileName = prefabPath.substring(prefabPath.lastIndexOf("/") + 1);
     const prefabName = fileName.replace(".prefab", "");

-    // 1. 重命名节点以匹配预制体名称
-    Editor.Ipc.sendToPanel("scene", "scene:set-property", { ... });
-
-    // 2. 使用自定义序列化创建预制体
-    const createdPrefabUrl = `${targetDir}/${prefabName}.prefab`;
-    setTimeout(() => {
-        this._createPrefabViaSceneScript(nodeId, createdPrefabUrl, callback);
-    }, 300);
+    this._ensureParentDir(prefabPath, () => {
+        // 1. 重命名节点以匹配预制体名称
+        Editor.Ipc.sendToPanel("scene", "scene:set-property", { ... });
+
+        // 2. 使用自定义序列化创建预制体
+        const createdPrefabUrl = `${targetDir}/${prefabName}.prefab`;
+        setTimeout(() => {
+            this._createPrefabViaSceneScript(nodeId, createdPrefabUrl, callback);
+        }, 300);
+    });
```

> **注意**：`setTimeout(300)` 保留，因为它等待的是 `scene:set-property` 的 IPC 完成（与 AssetDB 无关）。

### Step 6 — 验证

- [x] **[Backend]** 使用 HTTP 请求测试每个修改过的函数，验证新目录下创建资源时 UI 立即可见

---

## 三、验证计划

> [!IMPORTANT]
> 项目当前**无自动化测试**。所有验证通过 HTTP 请求 + 目视检查编辑器 UI 完成。

### 手动测试步骤

**前置条件**: Cocos Creator 编辑器已打开，MCP Bridge 已启动（默认端口 `12321`）。

#### 测试 1: `manage_asset` 在新目录下创建资源

```bash
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_asset\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/_test_asset_fix/sub/test_file.txt\",\"content\":\"hello\"}}"
```

- ✅ 编辑器 Assets 面板应立即显示 `_test_asset_fix/sub/test_file.txt` 的正确层级
- ❌ 不应只在 `assets` 根目录下平铺显示

#### 测试 2: `manage_script` 在新目录下创建脚本

```bash
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_script\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/_test_script_fix/game/TestScript.ts\"}}"
```

- ✅ 编辑器应立即显示 `_test_script_fix/game/TestScript.ts` 的正确层级

#### 测试 3: `scene_management` 在新目录下创建场景

```bash
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"scene_management\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/_test_scene_fix/levels/TestScene.fire\"}}"
```

- ✅ 编辑器应立即显示 `_test_scene_fix/levels/TestScene.fire` 的正确层级

#### 测试 4: `manage_texture` 回归验证（已使用 `_ensureParentDir`，不应受影响）

```bash
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/_test_texture_fix/icons/TestTex.png\"}}"
```

- ✅ 行为与修改前一致，编辑器正确显示

#### 清理测试资源

```bash
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_asset\",\"args\":{\"action\":\"delete\",\"path\":\"db://assets/_test_asset_fix\"}}"
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_script\",\"args\":{\"action\":\"delete\",\"path\":\"db://assets/_test_script_fix\"}}"
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"scene_management\",\"args\":{\"action\":\"delete\",\"path\":\"db://assets/_test_scene_fix\"}}"
curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"delete\",\"path\":\"db://assets/_test_texture_fix\"}}"
```

### 不在本次范围内

- **P6**（`_ensureParentDir` 性能优化）— 低风险，单独处理
- **P8**（`manageTexture` 绕过 `create()` 直写 fs）— 中风险，需要更深入评估是否改用 `Editor.assetdb.create` 传递 Buffer，属于重构范畴
