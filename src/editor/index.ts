import { type ProjectSchema, init, materials, plugins, project, setters } from '@easy-editor/core'
import DashboardPlugin from '@easy-editor/plugin-dashboard'
import DataSourcePlugin from '@easy-editor/plugin-datasource'
import { componentMetaMap } from './materials'
import { getViewportFromSchema } from './persistence/schema-viewport'
import { pluginList } from './plugins'
import { loadAllRemoteResources } from './remote'
import { loadRemoteMaterialsFromComponentsMap } from './remote/util'
import { setterMap } from './setters'

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

  project.onSimulatorReady(simulator => {
    simulator.set('deviceStyle', {
      viewport: getViewportFromSchema(project.export()),
    })
  })
  project.onRendererReady(() => {
    project.documents[0]?.rootNode?.select()
  })
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
    project.simulator.set('deviceStyle', {
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
