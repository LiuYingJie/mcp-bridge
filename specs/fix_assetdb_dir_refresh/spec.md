# Global Fix for AssetDB Directory Creation and UUID Collisions (V6)

## Problem Description

在 Cocos Creator (2.4.x) 中，当 MCP Bridge 尝试创建带有深层嵌套路径的各类资源（如脚本、材质、场景、预制体）时，频繁出现 `[db-task][sync-changes] uuid collision` 和 `path collision` 报错，导致资源导入报错或层级显示错乱，必须手动重启或刷新编辑器。

经过对 `assetdb_folder_creation_analysis.md` 的深度总结，导致该问题的**核心原因是异步刷新引发的竞态条件**。此前，我们已经在 `manageTexture` 中引入了 V5 版本的局部修复（基于原生 `fs.mkdirSync` 并在关闭 DB Watcher 下创建资源），但代码库中的其他绝大部分资源管理操作（`manageAsset`, `manageScript`, `manageShader`, `manageMaterial`, `sceneManagement`, `prefabManagement`）仍然遗留使用着含有根本性缺陷的 V4 版本的辅助函数 `_ensureParentDir`。

**旧版 (V4) 缺陷剖析**：

- 它错误地使用 `Editor.assetdb.create(targetDirUrl, "")` 逐级创建目录。这种方式实际上只会创建出无扩展名的空文件，而非真正的文件夹。
- 它在创建过程中未能关闭 DB Watcher。这不仅触发了底层任务竞态，还引发了并发的 `Editor.assetdb.refresh`，导致了大规模 UUID 冲突。

## Functional Requirements

1. **统一全局目录创建策略**：彻底废弃基于 `Editor.assetdb.create` 的伪目录创建辅助类。全局采用原生 `fs.mkdirSync({ recursive: true })` 进行物理路径的预创建。
2. **严格的环境隔离 (DB Watcher Pause)**：所有的内部写操作阶段（包含文件创建与附加属性写入）都必须在暂停快照监听 (`Editor.AssetDB.runDBWatch("off")`) 的状态下进行，防止 AssetDB 的底层自动扫描过早介入。
3. **精准的时序补偿 (Refresh)**：只有在实际创建了新物理目录的情况下，才对受影响的最近一级已有父目录，在**回调的最后周期**触发一次 `Editor.assetdb.refresh` 操作，以安全地生成 `.meta` 并驱动前端 UI 的层级刷新。
4. **统一的安全包装器**：提供高度内聚的统一接口，接管所有资源的创建底层调用，确保异步时序一致。

## Technical Implementation Details

1. **清理陈旧代码**：
    - 从 `src/main.js` 中彻底解耦并删除旧的 `_ensureParentDir(dbUrl, done)` 函数。

2. **新增统一的资源创建工具函数**：
   在 `main.js` 中增加 `_safeCreateAsset` 统一封装物理建目录、闭锁 Watcher、新建文件、解锁 Watcher 和单次 Refresh 的完整操作周期：

    ```javascript
    /**
     * 安全创建资源，自动处理物理目录、DB Watcher 隔离与父目录刷新
     * @param {string} path db:// 资源路径
     * @param {string|Buffer} content 文件内容
     * @param {Function} originalCallback 外层完毕回调 (err, msg)
     * @param {Function} [postCreateModifier] 在关闭 Watcher 的隔离区内执行的额外元数据修改回调
     */
    _safeCreateAsset(path, content, originalCallback, postCreateModifier = null) {
        let hasNewDir = false;
        try {
            hasNewDir = this._ensureParentDirSync(path);
        } catch (e) {
            return originalCallback(`创建物理目录失败: ${e.message}`);
        }

        const doneCreate = (err, msg) => {
            if (!Editor.App.focused) {
                Editor.AssetDB.runDBWatch("on");
            }
            if (err) return originalCallback(err);

            if (hasNewDir) {
                const dirUrl = path.substring(0, path.lastIndexOf("/"));
                addLog("info", `触发目录 ${dirUrl} 的刷新以补齐 Meta`);
                Editor.assetdb.refresh(dirUrl, (refreshErr) => {
                    if (refreshErr) addLog("warn", `刷新父目录失败: ${refreshErr}`);
                    originalCallback(null, msg);
                });
            } else {
                originalCallback(null, msg);
            }
        };

        Editor.AssetDB.runDBWatch("off");
        Editor.assetdb.create(path, content, (err) => {
            if (err) return doneCreate(err);
            if (postCreateModifier) {
                postCreateModifier(doneCreate);
            } else {
                doneCreate(null, `资源已创建: ${path}`);
            }
        });
    }
    ```

3. **重构各模块的创建逻辑以使用统一抽象**：
    - **`manageScript`** / **`manageAsset`** / **`manageShader`** / **`manageMaterial`** / **`sceneManagement` (create)**:
      将原先包裹着的 `this._ensureParentDir` + `Editor.assetdb.create` / `refresh` 全部剥离，改为直接调用 `this._safeCreateAsset(path, content, callback, null)`。
    - **`sceneManagement` (duplicate)**:
      读取源场景对应的物理文件内容后，直接调用 `this._safeCreateAsset(targetPath, content, callback, null)`。
    - **`prefabManagement` (create)**:
      在 `_createPrefabViaSceneScript` 内完成组件序列化后，将原有的 `Editor.assetdb.create` 直接替换为调用 `this._safeCreateAsset`，并通过 `postCreateModifier` 注入 `fixPrefabRootFileId` 修复逻辑。
    - **`manageTexture`**:
      通过 `postCreateModifier` 剥离掉其内部的 `loadMeta` 和 `saveMeta` 逻辑传递给 `_safeCreateAsset`，同时享受统一的目录处理。

## Edge Cases

1. **多个不同工具的连发请求竞态**：
    - 之前版本已确认 `batchExecute` 被重构成**严格串行执行**。
    - 现版本的 `_safeCreateAsset` 将 `Editor.assetdb.refresh` 置于全链条响应回调的最末端节点。这意味着，一个创建操作只要在进行刷新，随后的创建任务即使排队，也会被完全阻塞。这种机制满足了最佳实践中的**方案 B：异步串行化链式刷新**要求，绝不会导致内部快速循环调用的覆写和碰撞。
2. **Editor.App.focused 的兜底**：
    - 依据 Cocos 本身 IPC 操作的标准规范 (`asset-db:create-asset`)，在包含焦点的环境下引擎内部能自主触发 Watcher 的恢复。我们的统一帮助类严格遵守该检查机制以保证环境状态复位安全。
3. **保存并获取刚生成的 Meta 信息**：
    - 如 `manageTexture` 修改 `border`（9-slice）等操作，此时刚刚经历了 `create` ，虽然在同构环境中可继续以 `postCreateModifier` 回溯。由于内存落盘延迟存在，它会保留现有的 `setTimeout 100`，等待 AssetDB 的文件处理流走完再执行 `loadMeta`，保障资源稳妥。
