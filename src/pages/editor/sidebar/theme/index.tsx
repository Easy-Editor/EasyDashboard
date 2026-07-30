import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { applyDashboardSimulatorTheme } from '@/editor/project-theme-style'
import {
  type DashboardProjectDocument,
  type DashboardTheme,
  type DashboardThemeMode,
  decodeDashboardProjectDocument,
  resolvePageTheme,
  serializeDashboardProjectDocument,
} from '@/features/projects/project-document'
import {
  DASHBOARD_THEME_PRESETS,
  DASHBOARD_THEME_TOKEN,
  type DashboardThemePresetId,
  applyDashboardThemePreset,
  convertDashboardThemeMode,
  isDashboardPageThemeInherited,
  setDashboardPageTheme,
  setDashboardPageThemeInheritance,
  setDashboardProjectTheme,
} from '@/features/projects/project-theme'
import { cn } from '@/lib/utils'
import { type RootSchema, project } from '@easy-editor/core'
import { Check, Moon, Sun } from 'lucide-react'
import { observer } from 'mobx-react'
import { ColorTokenField } from './ColorTokenField'

function getRuntimeDocument(): DashboardProjectDocument {
  const exportedSchema = project.export()
  const storedTree = project.get<RootSchema[]>('componentsTree') || []
  const exportedPages = new Map(exportedSchema.componentsTree.map(page => [page.fileName, page]))

  return decodeDashboardProjectDocument({
    ...exportedSchema,
    componentsTree: storedTree.map(page => exportedPages.get(page.fileName) ?? page),
  })
}

function applyRuntimeDocument(document: DashboardProjectDocument) {
  const currentFileName = project.currentDocument?.fileName
  const serialized = serializeDashboardProjectDocument(document)

  // Theme changes are metadata updates. Reloading the whole project here
  // tears down the active simulator and can block the editor while a sidebar
  // click is still being handled. Keep document identities and the canvas
  // alive, then update the canonical project/page metadata in place.
  project.set('meta', serialized.editorSchema.meta)
  project.set('componentsTree', serialized.editorSchema.componentsTree)
  for (const page of serialized.editorSchema.componentsTree) {
    const root = project.getDocumentByFileName(page.fileName)?.rootNode
    if (root) {
      root.setExtraPropValue('meta', page.meta as Parameters<typeof root.setExtraPropValue>[1])
    }
  }

  applyDashboardSimulatorTheme(project.simulator, serialized.editorSchema, currentFileName)
}

function matchingPreset(theme: DashboardTheme): DashboardThemePresetId | undefined {
  return DASHBOARD_THEME_PRESETS.find(preset => {
    const candidate = preset.themes[theme.mode]
    return (
      candidate.tokens[DASHBOARD_THEME_TOKEN.background] === theme.tokens[DASHBOARD_THEME_TOKEN.background] &&
      candidate.tokens[DASHBOARD_THEME_TOKEN.accent] === theme.tokens[DASHBOARD_THEME_TOKEN.accent]
    )
  })?.id
}

function ModeControl({
  value,
  onChange,
}: {
  value: DashboardThemeMode
  onChange: (mode: DashboardThemeMode) => void
}) {
  return (
    <div className='grid grid-cols-2 gap-1 rounded-lg border border-[#2A343E] bg-[#0B0F14] p-1' aria-label='主题模式'>
      {(
        [
          ['dark', '深色', Moon],
          ['light', '浅色', Sun],
        ] as const
      ).map(([mode, label, Icon]) => (
        <button
          key={mode}
          type='button'
          aria-pressed={value === mode}
          onClick={() => onChange(mode)}
          className={cn(
            'flex h-8 items-center justify-center gap-1.5 rounded-md text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#49CFF0]/50',
            value === mode
              ? 'bg-[#1A2731] text-[#78D9EE] shadow-sm'
              : 'text-[#71808B] hover:bg-[#141A20] hover:text-[#DCE5EA]',
          )}
        >
          <Icon className='size-3.5' />
          {label}
        </button>
      ))}
    </div>
  )
}

function ThemeTokens({
  theme,
  onChange,
}: {
  theme: DashboardTheme
  onChange: (tokens: Record<string, string>) => void
}) {
  return (
    <div className='grid grid-cols-2 gap-3'>
      <ColorTokenField
        label='背景'
        value={theme.tokens[DASHBOARD_THEME_TOKEN.background] ?? '#080A0D'}
        onChange={value => onChange({ [DASHBOARD_THEME_TOKEN.background]: value })}
      />
      <ColorTokenField
        label='强调色'
        value={theme.tokens[DASHBOARD_THEME_TOKEN.accent] ?? '#67C6D9'}
        onChange={value => onChange({ [DASHBOARD_THEME_TOKEN.accent]: value })}
      />
    </div>
  )
}

export const ThemeSidebar = observer(() => {
  const document = getRuntimeDocument()
  const currentPage = document.editorSchema.componentsTree.find(
    page => page.fileName === project.currentDocument?.fileName,
  )
  const projectTheme = document.presentation.theme
  const currentPageId = currentPage?.meta.easyDashboard.pageId
  const inheritsProjectTheme = currentPageId ? isDashboardPageThemeInherited(document, currentPageId) : true
  const pageTheme = currentPageId ? resolvePageTheme(document, currentPageId) : projectTheme
  const activePreset = matchingPreset(projectTheme)

  const mutateProjectTheme = (update: Partial<DashboardTheme>) => {
    applyRuntimeDocument(setDashboardProjectTheme(getRuntimeDocument(), update))
  }

  const mutatePageTheme = (update: Partial<DashboardTheme>) => {
    if (!currentPageId) return
    applyRuntimeDocument(setDashboardPageTheme(getRuntimeDocument(), currentPageId, update))
  }

  return (
    <div className='space-y-5 px-3 py-4 text-[#DCE5EA]'>
      <section className='space-y-3' aria-labelledby='project-theme-heading'>
        <div>
          <h3 id='project-theme-heading' className='text-xs font-medium text-[#DCE5EA]'>
            项目主题
          </h3>
          <p className='mt-1 text-[10px] leading-4 text-[#71808B]'>只影响当前大屏项目，不改变编辑器外壳。</p>
        </div>

        <ModeControl
          value={projectTheme.mode}
          onChange={mode => mutateProjectTheme(convertDashboardThemeMode(projectTheme, mode))}
        />

        <div className='space-y-2'>
          <Label className='text-[11px] font-normal text-[#8D99A3]'>预设</Label>
          <div className='space-y-1.5'>
            {DASHBOARD_THEME_PRESETS.map(preset => {
              const colors = preset.themes[projectTheme.mode].tokens
              const isActive = activePreset === preset.id
              return (
                <button
                  key={preset.id}
                  type='button'
                  aria-pressed={isActive}
                  onClick={() =>
                    applyRuntimeDocument(applyDashboardThemePreset(getRuntimeDocument(), preset.id, projectTheme.mode))
                  }
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#49CFF0]/50',
                    isActive
                      ? 'border-[#3E7482] bg-[#15232B]'
                      : 'border-[#29333C] bg-[#11161B] hover:border-[#3A4853] hover:bg-[#151B21]',
                  )}
                >
                  <span
                    className='size-7 shrink-0 rounded-md border border-white/10'
                    style={{
                      background: `linear-gradient(135deg, ${colors[DASHBOARD_THEME_TOKEN.background]} 0 58%, ${colors[DASHBOARD_THEME_TOKEN.accent]} 59% 100%)`,
                    }}
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='block text-[11px] font-medium text-[#DCE5EA]'>{preset.name}</span>
                    <span className='block truncate text-[9px] text-[#71808B]'>{preset.description}</span>
                  </span>
                  {isActive ? <Check className='size-3.5 text-[#78D9EE]' aria-hidden='true' /> : null}
                </button>
              )
            })}
          </div>
        </div>

        <ThemeTokens theme={projectTheme} onChange={tokens => mutateProjectTheme({ tokens })} />
      </section>

      <div className='h-px bg-[#252D35]' />

      <section className='space-y-3' aria-labelledby='page-theme-heading'>
        <div className='flex items-start justify-between gap-3'>
          <div>
            <h3 id='page-theme-heading' className='text-xs font-medium text-[#DCE5EA]'>
              当前页面
            </h3>
            <p className='mt-1 text-[10px] leading-4 text-[#71808B]'>
              {currentPage ? String(currentPage.fileDesc || currentPage.fileName) : '未打开页面'}
            </p>
          </div>
          <div className='flex items-center gap-2'>
            <Label htmlFor='page-theme-inheritance' className='text-[10px] font-normal text-[#8D99A3]'>
              继承项目
            </Label>
            <Switch
              id='page-theme-inheritance'
              checked={inheritsProjectTheme}
              disabled={!currentPageId}
              onCheckedChange={checked => {
                if (!currentPageId) return
                applyRuntimeDocument(setDashboardPageThemeInheritance(getRuntimeDocument(), currentPageId, checked))
              }}
              className='data-[state=checked]:bg-[#3E9DB4] data-[state=unchecked]:bg-[#394550]'
            />
          </div>
        </div>

        {inheritsProjectTheme ? (
          <div className='rounded-lg border border-dashed border-[#2A343E] bg-[#0B0F14]/60 px-3 py-2.5 text-[10px] leading-4 text-[#71808B]'>
            当前页面跟随项目主题。关闭“继承项目”即可单独设置模式与颜色。
          </div>
        ) : (
          <>
            <ModeControl
              value={pageTheme.mode}
              onChange={mode => mutatePageTheme(convertDashboardThemeMode(pageTheme, mode))}
            />
            <ThemeTokens theme={pageTheme} onChange={tokens => mutatePageTheme({ tokens })} />
          </>
        )}
      </section>
    </div>
  )
})
