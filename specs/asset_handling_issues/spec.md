# MCP Bridge 资源处理问题综合分析规范

## 背景

基于 [AssetDB 文件管理机制分析报告](file:///c:/Users/Firekula/.gemini/antigravity/brain/36485cf1-2949-4f47-8716-7029f7a881ab/asset_db_analysis.md.resolved) ，对 MCP Bridge 插件中所有资源处理相关的代码进行系统性审计。

插件的资源管理涉及 7 个核心函数和 1 个辅助函数，均位于 [main.js](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js)：

| 函数               | 行号       | 负责的资源类型       |
| ------------------ | ---------- | -------------------- |
| `manageAsset`      | L1684-1748 | 通用资源 (任意类型)  |
| `manageScript`     | L1549-1647 | 脚本 (TS/JS)         |
| `manageTexture`    | L2215-2422 | 纹理 (PNG/JPG)       |
| `manageMaterial`   | L2115-2213 | 材质 (.mtl)          |
| `manageShader`     | L2002-2113 | 着色器 (.effect)     |
| `sceneManagement`  | L1750-1835 | 场景 (.fire)         |
| `prefabManagement` | L1837-1926 | 预制体 (.prefab)     |
| `_ensureParentDir` | L1980-2000 | 辅助：确保父目录存在 |

---

## 问题一览

### 问题 P1：目录创建方式不一致（3种模式并存）

当前插件中 `create` 流程存在 **三种不同的目录处理模式**，导致行为不一致且难以维护：

| 模式                                   | 使用者                                            | 实现方式                                                        | 是否等待 refresh |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- | :--------------: |
| **A: 裸 `fs.mkdirSync`**               | `manageAsset`、`manageScript`、`sceneManagement`  | `fs.mkdirSync` → 不刷新                                         |        ❌        |
| **B: `fs.mkdirSync` + 无回调 refresh** | `prefabManagement`                                | `fs.mkdirSync` → `Editor.assetdb.refresh(targetDir)` **无回调** |        ❌        |
| **C: `_ensureParentDir` 辅助函数**     | `manageTexture`、`manageMaterial`、`manageShader` | `fs.mkdirSync` → `Editor.assetdb.refresh` **有回调**            |        ✅        |

> [!CAUTION]
> **模式 A** 完全没有通知 AssetDB 注册新目录，是最严重的问题。
> **模式 B** 调用了 refresh 但**未等待回调**，存在竞态条件——后续 `Editor.assetdb.create()` 可能在 refresh 完成前执行。

**影响**：通过模式 A/B 创建的资源，其父目录不会出现在编辑器树形结构中，需要重启编辑器才能看到正确层级。

---

### 问题 P2：`manageAsset` create 缺少 AssetDB 注册

**位置**: [manageAsset L1688-1702](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1688-L1702)

```javascript
case "create":
    // ...
    const absolutePath = Editor.assetdb.urlToFspath(path);
    const dirPath = pathModule.dirname(absolutePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true }); // ← 绕过 AssetDB
    }
    Editor.assetdb.create(path, content || "", (err) => {
        callback(err, err ? null : `资源已创建: ${path}`);
        // ← 创建后无 refresh
    });
```

**两个问题**：

1. 目录创建后未调用 `Editor.assetdb.refresh` 注册新目录
2. `Editor.assetdb.create` 成功后**未刷新**，与 `manageScript` / `manageMaterial` 等函数行为不一致

---

### 问题 P3：`manageScript` create 的目录处理

**位置**: [manageScript L1553-1598](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1553-L1598)

```javascript
case "create":
    const absolutePath = Editor.assetdb.urlToFspath(scriptPath);
    const dirPath = pathModule.dirname(absolutePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true }); // ← 绕过 AssetDB
    }
    Editor.assetdb.create(scriptPath, content || ..., (err) => {
        // 创建后有 refresh ✅，但目录创建没有 refresh ❌
        Editor.assetdb.refresh(scriptPath, (refreshErr) => { ... });
    });
```

**问题**：虽然创建后有 refresh 文件（这是正确的），但 `fs.mkdirSync` 后未刷新父目录。如果路径类似 `db://assets/scripts/game/Player.ts`，中间目录 `scripts/game/` 不会出现在 Assets 面板中。

---

### 问题 P4：`sceneManagement` create/duplicate 的目录处理

**位置**: [sceneManagement L1759-1813](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1759-L1813)

```javascript
// create 分支: L1766-1768
if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true }); // ← 绕过 AssetDB，无 refresh
}
Editor.assetdb.create(path, getNewSceneTemplate(), (err) => {
    callback(err, ...); // ← 也没有创建后 refresh
});

// duplicate 分支: L1805-1807 — 同样的问题
if (!fs.existsSync(targetDirPath)) {
    fs.mkdirSync(targetDirPath, { recursive: true }); // ← 绕过 AssetDB
}
```

**问题**：

1. **create 分支**：目录不刷新 + 创建后不刷新（双重缺失）
2. **duplicate 分支**：目录不刷新，但创建后有 refresh（稍好，但仍不完整）

---

### 问题 P5：`prefabManagement` create 的 refresh 竞态

**位置**: [prefabManagement L1854-1877](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1854-L1877)

```javascript
if (!fs.existsSync(dirPath)) {
	fs.mkdirSync(dirPath, { recursive: true });
	Editor.assetdb.refresh(targetDir); // ← refresh 无回调！
}
// 300ms 后直接开始创建预制体
setTimeout(() => {
	this._createPrefabViaSceneScript(nodeId, createdPrefabUrl, callback);
}, 300);
```

**问题**：`Editor.assetdb.refresh` 是**异步**操作，通过任务队列串行执行。此处没有等待 refresh 完成就通过 `setTimeout(300ms)` 开始创建预制体。如果 AssetDB 队列前面有其他任务（如大量资源导入），300ms 可能不够，导致创建时 AssetDB 仍未注册该目录。

---

### 问题 P6：`_ensureParentDir` 的刷新层级可能不足

**位置**: [\_ensureParentDir L1986-2000](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1986-L2000)

```javascript
_ensureParentDir(dbUrl, done) {
    const absolutePath = Editor.assetdb.urlToFspath(dbUrl);
    const dirPath = pathModule.dirname(absolutePath);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        const parentUrl = dbUrl.substring(0, dbUrl.lastIndexOf("/"));
        Editor.assetdb.refresh(parentUrl, (err) => { done(); });
    } else {
        done();
    }
}
```

根据 AssetDB 分析报告中的关键发现：

> **路径查找逻辑**: 当刷新的路径不在 `_path2uuid` 中时，会**自动向上查找**最近的已注册祖先目录。

**分析**：这意味着对于 `db://assets/a/b/c/d.png`：

- `parentUrl` = `db://assets/a/b/c`
- 物理目录 `a/b/c/` 是新建的，均不在 `_path2uuid` 中
- refresh 会**向上查找**到已注册的祖先（`db://assets`），触发 `assets` 的全量扫描
- **根据报告的 `_initMetas()` 流程，refresh 会扫描目录并注册中间目录**，所以这里的逻辑实际上是**正确的**——AssetDB 的 refresh 会递归处理

> [!NOTE]
> `_ensureParentDir` 的实现是**七个函数中最正确的**。它的核心思路正确：先创建物理目录 → 刷新并**等待回调** → 再继续后续操作。唯一的性能隐患是，如果 `parentUrl` 向上回溯到了很高层级的目录（如 `db://assets`），可能导致不必要的大范围扫描。

---

### 问题 P7：`manageAsset` create 缺少创建后 refresh

**位置**: [manageAsset L1700-1702](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1700-L1702)

`manageAsset` 是通用的资源管理工具，其 `create` 操作在 `Editor.assetdb.create` 成功后直接返回，**未调用 `Editor.assetdb.refresh`**。

根据 AssetDB 分析报告，`Editor.assetdb.create()` 内部**已经包含完整的导入和注册流程**（`_importAsset` → `postImport` → `_dbAdd`），所以创建后再 refresh 是**冗余的**。

> [!TIP]
> `Editor.assetdb.create()` 的内部流程已包含 `_dbAdd` 注册和事件分发。**创建后不 refresh 并不是 bug**——只有在通过 `fs.writeFile` 绕过 AssetDB 写入时才需要 refresh。`manageScript` 的 create 后 refresh 实际上是多余的（但无害）。

---

### 问题 P8：`manageTexture` create 绕过 `Editor.assetdb.create()`

**位置**: [manageTexture L2236-2287](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L2236-L2287)

```javascript
// 2. 写入物理文件（绕过 AssetDB）
fs.writeFileSync(absolutePath, buffer);
// 3. 刷新该资源以生成 Meta
Editor.assetdb.refresh(path, (err, results) => { ... });
```

`manageTexture` 的 create 使用 `fs.writeFileSync` 写入文件然后 `refresh`，而非 `Editor.assetdb.create()`。这种模式之所以存在，是因为纹理数据是 **二进制 Buffer**，而 `Editor.assetdb.create()` 也支持 Buffer 参数。

**风险分析**：虽然 `_ensureParentDir` + `fs.writeFileSync` + `refresh` 的组合最终也能正确工作，但：

- 绕过了 AssetDB 内置的**文件名去重**机制（`_ensureDirSync` 中的 `foo - 001` 后缀）
- 绕过了 AssetDB 的**备份机制**
- 如果文件已存在（但 `Editor.assetdb.exists` 因未注册返回 false），`writeFileSync` 会**静默覆盖**

---

## 问题严重程度总结

| 问题 | 影响                                                   | 严重程度 | 修复难度 |
| ---- | ------------------------------------------------------ | :------: | :------: |
| P1   | 目录创建方式不一致，行为不可预期                       |  🔴 高   |    低    |
| P2   | `manageAsset` 新目录中的资源不可见                     |  🔴 高   |    低    |
| P3   | `manageScript` 新目录中的脚本不可见                    |  🔴 高   |    低    |
| P4   | `sceneManagement` 新目录/场景不可见                    |  🔴 高   |    低    |
| P5   | `prefabManagement` 在 AssetDB 繁忙时创建预制体可能失败 |  🟡 中   |    中    |
| P6   | `_ensureParentDir` 多级目录时可能触发大范围扫描        |  🟢 低   |    低    |
| P7   | `manageAsset` create 后无 refresh（实为误报）          |  ⚪ 无   |    —     |
| P8   | `manageTexture` 绕过 `create()` 使用 `fs` 直写         |  🟡 中   |    中    |

---

## 功能需求

### FR-1: 统一所有 create 流程的目录处理

所有 7 个资源管理函数的 `create` 分支应统一使用 `_ensureParentDir` 处理目录创建，具体需要修改的函数：

- `manageAsset.create` — 当前使用裸 `fs.mkdirSync`
- `manageScript.create` — 当前使用裸 `fs.mkdirSync`
- `sceneManagement.create` — 当前使用裸 `fs.mkdirSync`
- `sceneManagement.duplicate` — 当前使用裸 `fs.mkdirSync`
- `prefabManagement.create` — 当前使用 `fs.mkdirSync` + 无回调 `refresh`

已使用 `_ensureParentDir` 的函数**无需修改**：

- `manageTexture.create` ✅
- `manageMaterial.create` ✅
- `manageShader.create` ✅

### FR-2: 修复 `prefabManagement` 的 refresh 竞态

将 `prefabManagement.create` 从「`fs.mkdirSync` + 无回调 refresh + setTimeout(300)」改为使用 `_ensureParentDir` 并在回调中继续后续操作，彻底消除竞态条件。

---

## 边界情况

| 场景                                        | 预期行为                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| 目录已存在                                  | `_ensureParentDir` 直接调用 `done()`，无额外操作                                  |
| 单级新目录 `db://assets/newDir/file.ext`    | 创建目录 → refresh → 创建文件，UI 立即正确                                        |
| 多级新目录 `db://assets/a/b/c/file.ext`     | 递归创建所有层级 → refresh 向上回溯到 `db://assets` 并递归扫描 → 所有中间目录注册 |
| 资源路径不含新目录                          | `fs.existsSync` 返回 `true`，跳过目录处理                                         |
| `Editor.assetdb.refresh` 失败               | 日志打印警告，继续执行（当前 `_ensureParentDir` 已有此行为）                      |
| 连续创建同目录下多个资源（`batch_execute`） | 第一次调用创建目录并 refresh；后续调用目录已存在，跳过                            |
| AssetDB 正在执行其他任务时创建              | 操作排入队列串行执行，不会冲突（AssetDB 内部保证）                                |
