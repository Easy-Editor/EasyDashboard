# 远程物料整体逻辑

## 一、系统架构

远程物料系统采用分层架构，自底向上分为：

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI 层 (React)                             │
│  RemoteSnippet / RemoteMaterialDialog / ConfigureSidebar         │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                    渲染层 (react-renderer-dashboard)              │
│  SimulatorRenderer → BaseRenderer → RemoteComponentLoading       │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                     管理层 (EasyDashboard)                        │
│  MaterialManager / SetterManager / VersionManager                │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                      加载层 (EasyDashboard)                       │
│  MaterialLoader / ScriptLoader / CdnProvider / VersionResolver   │
└─────────────────────────────────────────────────────────────────┘
                              ↑
┌─────────────────────────────────────────────────────────────────┐
│                      核心层 (@easy-editor/core)                   │
│  Materials → MaterialRegistry → MaterialEntry → ComponentMeta    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、核心层：MaterialRegistry

### 2.1 概念说明

MaterialRegistry 是物料系统的核心，统一管理所有物料的注册、卸载、状态追踪。

```
Materials（门面）
    └── MaterialRegistry（注册表）
            ├── entries: Map<componentName, MaterialEntry>  // 已激活物料
            ├── pendingEntries: Map<componentName, MaterialEntry>  // 懒加载占位
            └── _version: number  // 用于触发 MobX 依赖更新
```

### 2.2 MaterialEntry 结构

```typescript
interface MaterialEntry {
  componentName: string       // 组件名称（唯一标识，如 "AreaChart@1.0.0"）
  status: MaterialStatus      // 物料状态
  source: MaterialSource      // 物料来源
  meta: ComponentMeta         // 元数据包装
  component?: Component       // 组件实现（懒加载时可能为空）
  version?: string            // 版本号（远程物料）
  loadedAt: number            // 加载时间戳
  lastAccessedAt: number      // 最后访问时间戳
  usageCount: number          // 使用计数（画布上的实例数）
}
```

### 2.3 状态流转

```
                    ┌─────────────────────────────────────────┐
                    ↓                                         │
LOADING ───→ REGISTERED ───→ ACTIVE ───→ UNLOADING ───→ (移除)
   │              │             │              │
   │              │             │              └── 卸载中
   │              │             └── 组件已加载，可正常使用
   │              └── 元数据已加载，组件未加载
   └── 正在加载（pendingEntries 中的占位）
```

**状态说明**：
- **LOADING**：通过 `getOrCreate()` 懒加载时创建的占位，存放在 `pendingEntries`
- **REGISTERED**：元数据已注册，但组件代码未加载（远程物料首次加载 meta 时）
- **ACTIVE**：元数据和组件都已加载，可正常渲染
- **UNLOADING**：正在卸载（清理资源）

### 2.4 物料来源

```typescript
enum MaterialSource {
  BUILTIN = 'builtin',       // 内置物料（打包时包含）
  REMOTE = 'remote',         // 远程物料（CDN/NPM）
  DEBUG = 'debug'            // 本地调试物料
}
```

### 2.5 使用计数机制

```
画布添加组件 → incrementUsage(componentName) → usageCount++
画布删除组件 → decrementUsage(componentName) → usageCount--

卸载物料时：
├── usageCount > 0 → 拒绝卸载（除非 force: true）
└── usageCount = 0 → 允许卸载
```

### 2.6 componentsMap 计算

```typescript
@computed
get componentsMap(): Record<string, unknown> {
  const maps = {}
  this.entries.forEach((entry, key) => {
    const metadata = entry.meta.getMetadata()
    if (metadata.devMode === 'lowCode') {
      maps[key] = metadata.schema  // 低代码组件：使用 schema
    } else {
      maps[key] = entry.meta.advanced?.view ?? entry.component  // 普通组件：使用 view 或 component
    }
  })
  return maps
}
```

---

## 三、物料库设计

### 3.1 物料包结构

每个远程物料包导出以下内容：

```typescript
// src/index.tsx - 完整物料入口
export { default as component } from './component'
export { default as meta } from './meta'

// 构建产物
dist/
├── meta.min.js      # 仅元数据 UMD（首次加载）
├── component.min.js # 组件 UMD（动态加载）
├── index.min.js     # 完整物料 UMD（meta + component）
├── index.min.css    # 样式文件
└── index.d.ts       # 类型声明
```

### 3.2 双 React 实例问题

**问题**：主应用和远程物料各自打包 React，导致 Hooks 失效。

**解决方案**：

1. **主应用暴露全局变量**
   ```typescript
   // src/globals.ts
   window.React = React
   window.ReactDOM = ReactDOM
   window.jsxRuntime = { jsx, jsxs, Fragment }
   ```

2. **物料构建外部化**
   ```javascript
   // rollup.config.js
   external: ['react', 'react-dom', 'react/jsx-runtime']
   globals: { react: 'React', 'react-dom': 'ReactDOM' }
   ```

3. **开发模式虚拟模块**
   ```typescript
   // vite-plugin-external-deps.ts
   // 拦截 import React → 代理到 window.React
   ```

---

## 四、远程物料联调

### 4.1 开发服务器 API

物料开发时通过 Vite 插件提供：

| 端点 | 说明 |
|------|------|
| `GET /api/health` | 心跳检测，返回 `{ status: 'ok' }` |
| `GET /api/material` | 物料信息（name、version、entry 等） |
| `WebSocket /ws` | HMR 更新通知 |

### 4.2 联调流程

```
物料端: pnpm dev (启动 Vite 服务器 :5001)
    ↓
编辑器端: localLoader.connect({ devServerUrl })
    ↓
1. 健康检查 → GET /api/health
    ↓
2. 获取物料信息 → GET /api/material
    ↓
3. 动态导入模块 → import(`${baseUrl}${entry}?t=${timestamp}`)
    ↓
4. 注册到 materials 系统
    └── materials.createComponentMeta(meta, { source: DEBUG, component })
        └── registry.register() → entry.source = DEBUG
        └── 物料分组强制设置为 "DEBUG"
    ↓
5. 建立 WebSocket 连接 → 监听 HMR 更新
    ↓
6. 文件修改 → 收到 update 消息 → 重新加载模块 → 刷新组件
```

---

## 五、设计态加载机制

### 5.1 应用启动流程

```
main.tsx
    ↓
initGlobals()  // 暴露 React 到 window
    ↓
import src/editor/index.ts  // 顶层 await
    ├── 注册插件（DashboardPlugin, HotkeyPlugin, DataSourcePlugin）
    ├── 注册本地物料元数据 → materials.buildComponentMetasMap()
    │   └── 遍历本地物料 → registry.register(meta, { source: BUILTIN })
    ├── 注册本地设置器 → setters.registerSetter()
    └── 初始化引擎 → init()
    ↓
异步加载远程资源（不阻塞 UI）
    ├── materialManager.loadMetaMultiple(remoteMaterialsConfig)
    │   └── 并行加载所有远程物料的元数据
    └── setterManager.loadMultiple(remoteSettersConfig)
        └── 并行加载所有远程设置器
    ↓
React 应用渲染
```

### 5.2 新建项目 vs 已保存项目

| 场景 | Meta 加载 | Component 加载 |
|------|----------|----------------|
| 新建项目 | 启动时加载所有 meta | 拖拽到画布时按需加载 |
| 已保存项目 | 启动时加载所有 meta | 根据 schema.componentsMap 全量加载 |

**已保存项目加载流程**：

```
project.open(schema)
    ↓
提取 schema.componentsMap（包含所有使用的远程物料 npm 信息）
    ↓
loadRemoteMaterialsFromComponentsMap(componentsMap)
    ├── 遍历 componentsMap，提取所有 NpmInfo
    ├── 去重（按 package@version）
    └── materialManager.loadMetaMultiple(remoteMaterials)
```

### 5.3 完整数据流

#### 阶段一：加载远程物料元数据

```
materialManager.loadMetaMultiple(configs)
    ↓
并行执行 loadMeta(config) for each config
    ↓
materialLoader.loadMeta({ package, version, globalName })
    ├── versionResolver.resolve(package, version)
    │   └── 如果是 "latest" → 查询 npm registry → 返回具体版本
    ├── scriptLoader.loadWithFallback(package, version, 'dist/meta.min.js')
    │   ├── 构建 URL: https://unpkg.com/{package}@{version}/dist/meta.min.js
    │   ├── 动态创建 <script> 标签加载
    │   ├── 失败则尝试下一个 CDN (jsdelivr → fastly)
    │   └── 全部失败则抛出 RemoteLoadError
    └── 从 window[globalNameMeta] 获取元数据
    ↓
构建版本化 componentName
    └── versionedName = `${meta.componentName}@${version}`  // 如 "AreaChart@1.0.0"
    ↓
注册到物料系统
    └── materials.buildComponentMetasMap([{ ...meta, componentName: versionedName }])
        └── registry.register(metadata, { source: REMOTE })
            ├── 创建 MaterialEntry
            │   ├── status = REGISTERED（无组件）
            │   ├── source = REMOTE
            │   ├── component = undefined
            │   └── usageCount = 0
            └── 发送 REGISTERED 事件
    ↓
缓存到 materialManager
    └── remoteMaterialPackages.set(`${package}@${version}`, { meta, hasComponent: false })
    ↓
左侧物料面板渲染
    └── 遍历 componentMetasMap → 渲染 RemoteSnippet
```

#### 阶段二：拖拽添加到画布

```
用户拖拽 RemoteSnippet 到画布
    ↓
handleDragStart
    └── e.dataTransfer.setData('text/plain', `remote-material:${globalName}:${title}`)
    ↓
画布 drop 事件触发
    └── handleCanvasDrop(e)
        ├── 验证拖拽数据匹配
        ├── 计算 drop 坐标 → simulator.viewport.toLocalPoint()
        └── addSnippetToCanvas(canvasPos)
    ↓
addSnippetToCanvas(pos)
    ├── 检查组件是否已加载: remoteComponentsMap[componentName]
    │   └── 如果未加载 → materialManager.addComponent(package, version)
    │       ├── scriptLoader.loadWithFallback(package, version, 'dist/index.min.js')
    │       ├── 从 window[globalName] 获取 component
    │       ├── materials.createComponentMeta(meta, { component, source: REMOTE })
    │       │   └── registry.register()
    │       │       ├── 更新 entry.component = component
    │       │       ├── 更新 entry.status = ACTIVE
    │       │       └── 发送 UPDATED 事件
    │       ├── materials.refreshComponentMetasMap()
    │       │   └── registry.refresh()
    │       │       ├── _version++
    │       │       └── entries = new Map(entries)  // 触发 MobX 响应
    │       └── 更新缓存 hasComponent = true
    │
    ├── 构建节点 schema
    │   └── {
    │         componentName: "AreaChart",  // 原始名称（不带版本）
    │         npm: { package, version, globalName, componentName },
    │         $dashboard: { rect: { x, y, width, height } },
    │         props: { ... }
    │       }
    │
    └── 添加到文档
        └── currentDocument.insertNode(rootNode, nodeSchema, -1)
            ├── 创建 Node 实例
            ├── node.props.merge(schema.props, schema.npm, ...)
            ├── materials.incrementUsage(versionedComponentName)
            │   └── entry.usageCount++
            └── 触发 NODE_CHILDREN_CHANGE 事件
```

#### 阶段三：渲染器处理

```
SimulatorRenderer 监听 materials.componentsMap 变化
    ↓
host.connect() 回调触发
    └── runInAction(() => {
          // 访问 componentsMap 建立 MobX 依赖
          this.host.designer.materials.componentsMap

          if (_componentsMap !== materials.componentsMap) {
            _componentsMap = materials.componentsMap
            buildComponents()  // 重建组件映射
          }
        })
    ↓
渲染文档树
    ↓
BaseRenderer.__createVirtualDom(schema)
    ├── 检查是否为远程组件: isRemoteComponent(schema)
    │   └── return !!(schema.npm?.package && schema.npm.package !== 'builtin')
    │
    ├── 如果是远程组件
    │   ├── 构建版本化名称: `${componentName}@${npm.version}`
    │   ├── 查找组件: components[versionedName]
    │   │
    │   ├── 如果组件不存在（entry.status = REGISTERED）
    │   │   └── createElement(RemoteComponentLoading, { schema })
    │   │       └── 渲染白色蒙版 + pulse 动画
    │   │       └── 等待组件加载完成后自动刷新
    │   │
    │   └── 如果组件存在（entry.status = ACTIVE）
    │       └── superCreateVirtualDom(schema)
    │           └── 正常渲染组件
    │
    └── BaseRenderer.__getComponentView(schema)
        ├── isRemote → componentName = `${name}@${version}`
        └── return __components[componentName]
```

#### 阶段四：选中组件配置

```
用户选中画布上的远程组件
    ↓
右侧配置面板更新
    └── SettingRenderer 获取选中节点
        ↓
node.componentMeta (computed)
    ├── 判断是否远程: node.isRemote
    │   └── isRemoteComponent({ npm: node.getExtraPropValue('npm') })
    │
    └── 如果是远程组件
        └── componentName = `${this.componentName}@${npm.version}`
        └── return document.getComponentMeta(componentName)
            └── materials.getComponentMeta(versionedName)
                └── registry.getOrCreate(componentName)
                    └── 返回 entry.meta（ComponentMeta 实例）
    ↓
获取 meta.configure（属性配置）
    ↓
为每个字段查找 Setter
    └── setters.getSetter(field.setter)
    ↓
渲染配置 UI
```

#### 阶段五：组件版本更新

```
用户更新组件版本
    ↓
versionManager.updateNode(node, targetVersion)
    ↓
materialManager.loadComponentVersion(package, newVersion, oldVersion)
    ├── materialLoader.loadMaterial({ package, version: newVersion })
    ├── 构建新的版本化名称: `${componentName}@${newVersion}`
    ├── materials.createComponentMeta(newMeta, { component, source: REMOTE })
    │   └── registry.register() → 创建新的 entry（新版本）
    ├── materials.refreshComponentMetasMap()
    └── 缓存新版本
    ↓
更新节点属性
    └── node.setExtraPropValue('npm.version', newVersion)
    ↓
刷新配置面板
    └── node.refreshSettingEntry()
        ├── _settingEntry.purge()  // 销毁旧的配置入口
        ├── settingsManager._sessionId = ''  // 重置当前配置项 id
        └── settingsManager.setup([this])  // 重新设置，使用新版本的 meta
    ↓
渲染器自动更新
    └── node.componentMeta 重新计算
        └── 使用新的版本化名称查找 → 返回新版本的 ComponentMeta
```

#### 阶段六：删除组件

```
用户删除画布上的组件
    ↓
currentDocument.removeNode(node)
    ├── materials.decrementUsage(versionedComponentName)
    │   └── entry.usageCount--
    └── 触发 NODE_CHILDREN_CHANGE 事件
    ↓
如果 usageCount = 0 且需要卸载
    └── materials.registry.unload(componentName)
        ├── 检查 usageCount（force 模式跳过）
        ├── entry.status = UNLOADING
        ├── entry.meta.dispose()
        ├── entries.delete(componentName)
        ├── 发送 UNLOADED 事件
        └── registry.refresh()
```

---

## 六、CDN 加载与降级

### 6.1 CDN 提供商

| 优先级 | 名称 | URL 模板 |
|-------|------|----------|
| 1 | unpkg | `https://unpkg.com/{pkg}@{ver}/{file}` |
| 2 | jsdelivr | `https://cdn.jsdelivr.net/npm/{pkg}@{ver}/{file}` |
| 3 | fastly | `https://fastly.jsdelivr.net/npm/{pkg}@{ver}/{file}` |

### 6.2 降级机制

```
scriptLoader.loadWithFallback()
    ↓
创建 LoadContext { cdnIndex: 0, triedCdns: Set, abortController }
    ↓
loadScript(cdnUrl1)
    ├── 创建 <script src="..." async crossorigin="anonymous">
    ├── 设置超时定时器 (30s)
    ├── onload → resolve
    └── onerror / timeout → 降级
    ↓
失败 → context.cdnIndex++ → loadScript(cdnUrl2)
    ↓
失败 → context.cdnIndex++ → loadScript(cdnUrl3)
    ↓
全部失败 → throw RemoteLoadError(CDN_ALL_FAILED)
```

---

## 七、版本化组件名

### 7.1 设计原因

- 支持同一组件多版本共存
- 不同版本的配置项可能不同
- 不修改 schema.componentName，通过查找时拼接实现

### 7.2 命名规则

```
原始名称: "AreaChart"
版本化名称: "AreaChart@1.0.0"

schema 中存储:
{
  componentName: "AreaChart",       // 保持原始名称
  npm: { version: "1.0.0", ... }    // 版本信息单独存储
}

查找时拼接:
componentName = `${schema.componentName}@${schema.npm.version}`
component = componentsMap["AreaChart@1.0.0"]
```

### 7.3 缓存结构

```typescript
// MaterialManager 层缓存（应用层）
remoteMaterialPackages: Map<cacheKey, CachedMaterialPackage>
// key: "@easy-editor/materials-dashboard-text@0.0.14"
// value: { version, globalName, meta, component, hasComponent }

// MaterialRegistry 层（核心层）
entries: Map<componentName, MaterialEntry>
// key: "Text@0.0.14"（版本化组件名）
// value: MaterialEntry { status, source, meta, component, usageCount, ... }
```

---

## 八、MobX 响应式机制

### 8.1 依赖链

```
MaterialRegistry
    @observable entries = Map<string, MaterialEntry>
    @observable _version = 0
    @computed componentsMap  // 依赖 entries 和 _version
        ↓
Materials
    @computed componentsMap → registry.componentsMap
        ↓
SimulatorRenderer
    host.connect() 中访问 materials.componentsMap  // 建立依赖
    _componentsMap 更新 → buildComponents() → 重新渲染
```

### 8.2 强制刷新

```typescript
// 当需要强制触发更新时
materials.refreshComponentMetasMap()
    → registry.refresh()
        → _version++
        → entries = new Map(entries)  // 触发 MobX 响应
```

---

## 九、VersionManager 版本管理

### 9.1 版本检查

```
versionManager.checkNodeUpdate(node)
    ├── 获取 node.npm 信息
    ├── versionResolver.resolve(package, currentVersion)
    ├── versionResolver.resolve(package, 'latest')
    ├── 比较版本 → hasUpdate
    └── 返回 VersionCheckResult { currentVersion, latestVersion, hasUpdate }
```

### 9.2 批量检查

```
versionManager.checkAllNodesUpdate(rootNode)
    ├── 递归收集所有节点
    ├── 分批并发检查（限制并发数为 5）
    └── 返回所有有更新的节点列表
```

### 9.3 更新流程

```
versionManager.updateNode(node, targetVersion)
    ├── materialManager.loadComponentVersion(package, targetVersion, originVersion)
    ├── node.setExtraPropValue('npm.version', targetVersion)
    ├── 清除版本检查缓存
    ├── node.refreshSettingEntry()
    └── 如果失败 → 回滚版本
```

