# Implementation Plan: Fix AssetDB Directory Creation and UUID Collisions (V6)

## Section 1: Architecture

**Changed Files:**

- `src/main.js`: Main plugin backend script handling IPC requests to AssetDB.

**Data Models & API Updates:**

- **Added**: `_safeCreateAsset(path, content, originalCallback, postCreateModifier)` - A unified wrapper handling the `Editor.assetdb.create` lifecycle. Safely creates physical folders, disables the AssetDB Watcher to prevent sync collision, and properly handles a backend refresh callback post-creation.
- **Removed**: `_ensureParentDir(dbUrl, done)` - The flawed V4 directory creation method based on creating empty files.
- **Modified Endpoints**:
    - `manageScript` (create)
    - `manageAsset` (create, move)
    - `sceneManagement` (create, duplicate)
    - `prefabManagement` (create)
    - `manageShader` (create)
    - `manageMaterial` (create)
    - `manageTexture` (create) refactoring its internal logic to adopt the global `_safeCreateAsset` structure.

## Section 2: Step-by-Step

- [x] [Backend] Remove the flawed `_ensureParentDir` function from `src/main.js`.
- [x] [Backend] Implement the new `_safeCreateAsset` wrapper in `src/main.js` using `Editor.AssetDB.runDBWatch`.
- [x] [Backend] Update `manageTexture/create` to use `_safeCreateAsset`, and insert its `loadMeta/saveMeta` logic into the `postCreateModifier` callback.
- [x] [Backend] Update `manageAsset/create` and `manageAsset/move` to use `_safeCreateAsset` instead of `_ensureParentDir`.
- [x] [Backend] Update `manageScript/create` to use `_safeCreateAsset` instead of `_ensureParentDir`.
- [x] [Backend] Update `manageShader/create` and `manageMaterial/create` to use `_safeCreateAsset` instead of `_ensureParentDir`.
- [x] [Backend] Update `sceneManagement/create` and `sceneManagement/duplicate` to use `_safeCreateAsset` instead of `_ensureParentDir`.
- [x] [Backend] Update `prefabManagement/create` to use `_safeCreateAsset` instead of `_ensureParentDir`, invoking `fixPrefabRootFileId` via `postCreateModifier`.
