import { applyDashboardSimulatorTheme } from './project-theme-style'

type DashboardLifecycleSimulator = {
  deviceStyle?: {
    canvas?: object
    viewport?: object
    content?: object
  } | null
  set: (key: string, value: unknown) => void
}

type DashboardLifecycleProject = {
  simulator?: DashboardLifecycleSimulator | null
  currentDocument?: { fileName: string } | null
  documents: Array<{ rootNode?: { select: () => void } | null }>
  export: () => unknown
  onSimulatorReady: (listener: (simulator: DashboardLifecycleSimulator) => void) => () => void
  onCurrentDocumentChange: (listener: (document: { fileName: string }) => void) => () => void
  onRendererReady: (listener: () => void) => () => void
}

type DashboardViewport = {
  width: number
  height: number
}

/**
 * Keeps the dashboard theme attached across the simulator's two-stage mount.
 *
 * SimulatorView first mounts the simulator, then replaces its complete prop
 * bag before the renderer becomes ready. Reapplying at renderer-ready prevents
 * that replacement from dropping the theme tokens and making the canvas
 * transparent after a fresh editor entry.
 */
export function bindDashboardProjectLifecycle(
  project: DashboardLifecycleProject,
  getViewport: (schema: unknown) => DashboardViewport,
): void {
  const applyCurrentTheme = (
    simulator: DashboardLifecycleSimulator | null | undefined = project.simulator,
    currentFileName: string | undefined = project.currentDocument?.fileName,
  ) => {
    const schema = project.export()
    applyDashboardSimulatorTheme(
      simulator as Parameters<typeof applyDashboardSimulatorTheme>[0],
      schema,
      currentFileName,
      {
        viewport: getViewport(schema),
      },
    )
  }

  project.onSimulatorReady(simulator => {
    applyCurrentTheme(simulator)
  })
  project.onCurrentDocumentChange(document => {
    applyCurrentTheme(project.simulator, document.fileName)
  })
  project.onRendererReady(() => {
    project.documents[0]?.rootNode?.select()
    setTimeout(() => {
      applyCurrentTheme()
    }, 0)
  })
}
