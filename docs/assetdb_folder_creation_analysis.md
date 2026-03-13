# AssetDB 文件夹创建机制与报错原因深度分析

在 Cocos Creator (2.4.x) 的插件开发中，很多开发者习惯使用 Node.js 原生的 `fs.mkdirSync` 创建多级目录，随后紧接着调用 `Editor.assetdb.refresh()` 来刷新资源。但在处理深层嵌套目录或批量创建资源时，经常会遇到如下报错和警告：

```text
[db-task][sync-changes] uuid collision, the uuid(...) is already used. A new uuid(...) will be assigned.
[db-task][sync-changes] path collision, the path for ... is already in used by .... This resource is about to be ignored.
[db-task][sync-changes] Failed to import asset ... message: Error: Can not find raw texture ... uuid not found
```

通过深入分析 `c:\ProgramData\cocos\editors\Creator\2.4.15\resources\app\asset-db\` 核心源码，我们得出了导致该问题的根本原因（**核心原因是异步刷新引发的竞态条件**）。

---

## 1. 原理剖析：`assetdb.refresh` 的工作方式

当插件调用 `Editor.assetdb.refresh('db://assets/f1/f2/f3')` 时，AssetDB 的内部流转如下（位于 [asset-db/lib/tasks.js](file:///c:/ProgramData/cocos/editors/Creator/2.4.15/resources/app/asset-db/lib/tasks.js)）：

1. **向上追溯已注册父节点**：AssetDB 发现 `f3` 甚至 `f1` 尚未在它的内部字典 `_path2uuid` 中注册（因为刚通过 [fs](file:///C:/Users/Firekula/.gemini/antigravity/brain/15d35841-20b4-4720-bdd4-65434ac1f30a/deps_src/internal.js#17-34) 创建，还没 meta）。它会**不断向上查找父级目录**，直到找到一个已被 AssetDB 记录的父目录（比如 `db://assets`）。
2. **向下广度/深度扫描**：一旦确定了根作用域，它会使用 `fast-glob` 从这个有效父目录开始，向下递归扫描**所有**尚未记录的文件和文件夹。
3. **异步处理 (`async.waterfall` / `async.eachLimit`)**：对于每个扫出来的新文件/目录，它会异步地为其生成 `.meta` 文件，并将 `[路径 -> UUID]` 和 `[UUID -> 路径]` 的映射关系注册到内存字典中（调用 [_dbAdd](file:///C:/Users/Firekula/.gemini/antigravity/brain/15d35841-20b4-4720-bdd4-65434ac1f30a/deps_src/internal.js#101-117) 方法）。

---

## 2. 为什么会产生 UUID 和 Path Collision（竞态条件）？

出错通常发生在你**循环调用**或**高频并发调用**了 `refresh`：

```javascript
// 错误示范：高频同步执行，未等待前一个 refresh 的回调
fs.mkdirSync('a/b/c/d1', { recursive: true });
Editor.assetdb.refresh('db://assets/a/b/c/d1');

fs.mkdirSync('a/b/c/d2', { recursive: true });
Editor.assetdb.refresh('db://assets/a/b/c/d2');
```

由于 `refresh` 是**高度异步**的：

1. **第一次 Refresh** 还没执行完，它正在扫描 `a/b/c` 及底下的文件并准备分配 UUID。
2. **第二次 Refresh** 立刻发起了。它同样向上追溯，发现 [a/](file:///C:/Users/Firekula/.gemini/antigravity/brain/15d35841-20b4-4720-bdd4-65434ac1f30a/deps_src/internal.js#17-34) 还没被完全注册结束，于是它**也开始大规模扫描** `a/b/c` 下的所有文件。
3. **💥 冲突发生（UUID Collision）：**
   - 第一次 Refresh 刚好给 `d1` 生成了 `.meta` 并写入磁盘，并将 UUID `UUID_A` 存入内存字典 `_uuid2path`。
   - 第二次 Refresh 扫描到了 `d1`，读取到了磁盘上刚热乎的 `.meta`，发现里面写着 `UUID_A`。
   - 接着第二次 Refresh 去查内存字典，发现 `UUID_A` **已经被占用**（被第一次 Refresh 占用的）。由于它不知道这是自己人，它判定为**UUID 冲突**，在控制台打印 `uuid collision` 警告，然后**强行给它分配一个新的 UUID** `UUID_B` 并覆写 `.meta`。
4. **💥 冲突升级（Path Collision）：**
   - 第二次 Refresh 拿着新的 `UUID_B`，试图调用 [_dbAdd(path, UUID_B)](file:///C:/Users/Firekula/.gemini/antigravity/brain/15d35841-20b4-4720-bdd4-65434ac1f30a/deps_src/internal.js#101-117) 将其绑定到 `d1` 的路径上。
   - 但是，`d1` 的路径**之前已经被第一次 Refresh 绑定给了 `UUID_A`**。
   - 这就触发了内部字典的冲突拦截：`path collision, the path ... is already in used by ...`。
5. **💥 彻底崩溃（导入报错）：**
   - 字典状态被彻底破坏：磁盘中的 `.meta` 是 `UUID_B`，内存中路径绑定的是 `UUID_A`。
   - 随后的 `import` 阶段试图读取实际原始资源时，找不到正确的对应关系，于是抛出致命错误：`Failed to import asset ... uuid not found`。

---

## 3. AssetDB 内部是如何安全创建文件夹的？

在 [asset-db/lib/internal.js](file:///c:/ProgramData/cocos/editors/Creator/2.4.15/resources/app/asset-db/lib/internal.js) 的源码中，原生系统遇到需要层层创建文件夹时，使用的是属于内部保护 API 的完全同步方法 [_ensureDirSync(path)](file:///C:/Users/Firekula/.gemini/antigravity/brain/15d35841-20b4-4720-bdd4-65434ac1f30a/deps_src/internal.js#191-206)：

```javascript
// asset-db/lib/internal.js 节选
_ensureDirSync(t) {
    let i = [];
    for (s.ensureDirSync(t); !this._isMountPath(t); ) { // 从底向上遍历
        if (s.isDirSync(t)) {
            let e = t + ".meta";
            if (!s.existsSync(e)) {
                // 【关键】立刻同步生成 meta，立刻同步注入内存字典！
                let s = u.create(this, e);
                u.save(this, e, s);
                this._dbAdd(t, s.uuid);
                i.splice(0, 0, s);
            }
        }
        t = e.dirname(t);
    }
    return i;
}
```

AssetDB 内部处理新建目录时，**严格采用同步操作**阻塞住了事件循环。生成目录、生成 meta、更新内存字典，这三步一气呵成。因此引擎自身可以完美规避这种异步扫描造成的竞态条件。

---

## 4. 插件开发的正确解决方案

普通插件无法直接调用 `assetdb._ensureDirSync`。为了彻底解决创建多级目录和批量资源时的冲突问题，请遵循以下规范：

### 方案 A：批量操作后，全局触发一次 `refresh`（推荐）
不要在循环里刷新资源。先把所有的文件夹（`fs.mkdirSync`）和图片等文件全部创建、复制完毕后，在最外部调用**唯一一次** `refresh`。

```typescript
// 1. 同步进行所有文件落盘操作
fs.mkdirSync('a/b/c/d1', { recursive: true });
fs.writeFileSync('a/b/c/d1/img.png', data);
fs.mkdirSync('a/b/c/d2', { recursive: true });
// ... 各种 fs 拷贝操作

// 2. 全部结束后，仅调用一次 refresh，让 AssetDB 一次性扫描
Editor.assetdb.refresh('db://assets/a', (err, results) => {
    if (err) {
        Editor.error("刷新失败", err);
    } else {
        Editor.success("全部资源导入完成！");
    }
});
```

### 方案 B：利用回调实现链式刷新（异步串行化）
如果你的流程必须分散多次刷新，**必须等待前一次 refresh 的回调彻底完成**，再发起下一次，绝不能并发！

```typescript
Editor.assetdb.refresh('db://assets/dir1', (err) => {
    if (err) return;
    
    // 确保第一个刷新结束后再 fs + 刷新第二个
    fs.mkdirSync('dir2');
    Editor.assetdb.refresh('db://assets/dir2', (err) => {
        // ...
    });
});
```

### 方案 C：使用 Promise 封装 `refresh`
将回调包装成 async/await 形式，确保执行时序强制串行。

```typescript
function refreshAssetAsync(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
        Editor.assetdb.refresh(url, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function createAndRefresh() {
    fs.mkdirSync('path1');
    await refreshAssetAsync('db://assets/path1');
    
    fs.mkdirSync('path2');
    await refreshAssetAsync('db://assets/path2');
}
```

### 总结
Cocos Creator 2.4.x 的 `assetdb.refresh` 是通过底层扫描来对比差异的异步操作。并发调用它扫描互相覆盖的父子目录，会导致 `Fast-Glob` 返回重叠的结果交由异步流水线处理，从而产生多个任务抢注同一个物理文件的 UUID 竞态问题。统一收拢文件写入后再单次 Refresh，是性能最好、最安全的做法。
