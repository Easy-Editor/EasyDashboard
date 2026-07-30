import { createDashboardRenderModel } from '@/features/rendering/dashboard-render-adapter'

export type DashboardSimulatorDeviceStyle = {
  canvas?: object
  viewport?: object
  content?: object
  [key: string]: unknown
}

type DashboardSimulator = {
  deviceStyle?: {
    canvas?: object
    viewport?: object
    content?: object
  } | null
  set: (key: string, value: unknown) => void
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function createDashboardSimulatorDeviceStyle(
  input: unknown,
  currentFileName?: string,
  currentStyle: DashboardSimulatorDeviceStyle = {},
  styleUpdate: DashboardSimulatorDeviceStyle = {},
): DashboardSimulatorDeviceStyle {
  const document = createDashboardRenderModel(input).document
  const currentPageId = document.editorSchema.componentsTree.find(page => page.fileName === currentFileName)?.meta
    .easyDashboard.pageId
  const renderModel = createDashboardRenderModel(document, currentPageId)

  return {
    ...currentStyle,
    ...styleUpdate,
    canvas: {
      ...record(currentStyle.canvas),
      ...record(styleUpdate.canvas),
      ...renderModel.rootStyle,
    },
  }
}

export function applyDashboardSimulatorTheme(
  simulator: DashboardSimulator | null | undefined,
  input: unknown,
  currentFileName?: string,
  styleUpdate: DashboardSimulatorDeviceStyle = {},
): void {
  if (!simulator) return
  simulator.set(
    'deviceStyle',
    createDashboardSimulatorDeviceStyle(
      input,
      currentFileName,
      (simulator.deviceStyle ?? {}) as DashboardSimulatorDeviceStyle,
      styleUpdate,
    ),
  )
}
