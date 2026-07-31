import { type ProjectSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import { componentMetaMap } from './materials'
import { getViewportFromSchema } from './persistence/schema-viewport'
import { pluginList } from './plugins'
import { bindDashboardProjectLifecycle } from './project-lifecycle'
import { applyDashboardSimulatorTheme } from './project-theme-style'
import { loadAllRemoteResources } from './remote'
import { loadRemoteMaterialsFromComponentsMap } from './remote/util'
import { setterMap, setterOverrides } from './setters'

import './overrides.css'

plugins.registerPlugins([
  DashboardPlugin({
    group: {
      meta: componentMetaMap.Group,
      initSchema: {
        componentName: 'Group',
        title: '分组',
        isGroup: true,
      },
    },
  }),
  DataSourcePlugin(),
  ...pluginList,
])
materials.buildComponentMetasMap(Object.values(componentMetaMap))
setters.registerSetter(setterMap)

let editorInitialization: Promise<void> | null = null
let editorTeardown: Promise<void> | null = null
let lifecycleBound = false

function bindEditorLifecycle() {
  if (lifecycleBound) return
  lifecycleBound = true
  bindDashboardProjectLifecycle(project, schema => getViewportFromSchema(schema as ProjectSchema))
}

async function ensureEditorInitialized() {
  if (editorTeardown) await editorTeardown
  if (!editorInitialization) {
    editorInitialization = init({
      designMode: 'design',
      appHelper: {
        utils: {
          test: 'test',
        },
      },
    }).then(async () => {
      bindEditorLifecycle()

      try {
        await loadAllRemoteResources()
      } catch (error) {
        console.error('[Remote] Failed to load resources:', error)
      } finally {
        for (const [name, setter] of Object.entries(setterOverrides)) {
          setters.registerSetter(name, setter, { overwrite: true })
        }
      }
    })
  }

  await editorInitialization
}

/**
 * Initializes the editor runtime, then replaces the in-memory project with the
 * canonical draft received from the API. No project data is read from browser
 * storage.
 */
export async function initializeEditorProject(schema: ProjectSchema) {
  await ensureEditorInitialized()
  await loadRemoteMaterialsFromComponentsMap(schema.componentsMap)
  project.load(schema, true)

  if (project.simulator) {
    applyDashboardSimulatorTheme(project.simulator, schema, project.currentDocument?.fileName, {
      viewport: getViewportFromSchema(schema),
    })
  }
}

/**
 * Releases the browser-owned simulator and model between route entries.
 * The editor engine itself stays initialized so the next entry can reuse the
 * registered plugins/materials, while the project document and renderer are
 * rebuilt from the canonical draft.
 */
export function teardownEditorProject(): Promise<void> {
  if (!editorTeardown) {
    // The renderer owns a nested React root. Its effect cleanup runs in the
    // next task, so wait one additional task before removing the document.
    // Keeping the engine initialized is intentional: core@1.0.x cannot safely
    // register the same plugin setters again after destroy()/init().
    editorTeardown = new Promise<void>(resolve => {
      window.setTimeout(() => window.setTimeout(resolve, 0), 0)
    })
      .then(() => {
        project.simulator?.purge?.()
        project.unload()
      })
      .catch(error => {
        console.warn('[Editor] 释放项目失败', error)
      })
      .finally(() => {
        editorTeardown = null
      })
  }
  return editorTeardown
}
