# 修复 AssetDB 目录刷新问题 — 实施计划

## 1. 架构

### 变更文件

| 文件                                                               | 变更类型 | 说明                                               |
| ------------------------------------------------------------------ | :------: | -------------------------------------------------- |
| [main.js](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js) |  MODIFY  | 三个函数的 `create` 分支各增加 1 行 `refresh` 调用 |

> [!NOTE]
> 本次修复极为聚焦——只在已有的 `if (!fs.existsSync(dirPath))` 分支内追加一行代码，不引入新函数、新文件或新依赖。变更模式与 [prefab_management L1856-1857](file:///d:/Project/cocos_plugins/mcp-bridge/src/main.js#L1856-L1857) 完全一致。

### 变更模式（通用 Diff）

```diff
 if (!fs.existsSync(dirPath)) {
     fs.mkdirSync(dirPath, { recursive: true });
+    // 通知 AssetDB 注册新建目录，避免编辑器 UI 层级显示错误
+    const parentUrl = path.substring(0, path.lastIndexOf("/"));
+    Editor.assetdb.refresh(parentUrl);
 }
```

---

## 2. 实施步骤

### [Backend] 代码修改

- [x] **Step 1**: 修改 `manageTexture` create 分支（L2213-2215）
    - 在 `fs.mkdirSync` 后增加 `Editor.assetdb.refresh(parentUrl)`
    - 变量名：`const parentUrl = path.substring(0, path.lastIndexOf("/"));`

- [x] **Step 2**: 修改 `manageShader` create 分支（L1992-1994）
    - 同上模式，注意此函数中路径变量名为 `effectPath`

- [x] **Step 3**: 修改 `manageMaterial` create 分支（L2109-2111）
    - 同上模式，注意此函数中路径变量名为 `matPath`

### [Backend] 验证

- [x] **Step 4**: 手动测试 `manage_texture` 中间目录创建
    1. 确保 Cocos Creator 编辑器已打开、MCP Bridge 服务已启动
    2. 执行以下命令创建纹理至不存在的目录：
        ```bash
        curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"create\",\"path\":\"db://assets/_test_dir_refresh/sub_dir/TestTex.png\"}}"
        ```
    3. **不重启编辑器**，在资源管理器中确认 `_test_dir_refresh/sub_dir/TestTex.png` 层级正确
    4. 验证 `get_info` 能正常获取该纹理：
        ```bash
        curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"get_info\",\"path\":\"db://assets/_test_dir_refresh/sub_dir/TestTex.png\"}}"
        ```

- [x] **Step 5**: 手动测试 `manage_shader` 和 `manage_material`
    - 同样创建到不存在的目录，确认 UI 层级正确

- [x] **Step 6**: 清理测试资源
    ```bash
    curl -X POST http://localhost:12321/mcp -H "Content-Type: application/json" -d "{\"name\":\"manage_texture\",\"args\":{\"action\":\"delete\",\"path\":\"db://assets/_test_dir_refresh/sub_dir/TestTex.png\"}}"
    ```
