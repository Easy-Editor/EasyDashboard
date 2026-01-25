import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { SidebarMenu, SidebarMenuItem, SidebarMenuSub } from '@/components/ui/sidebar'
import { SidebarMenuExtra, SidebarMenuExtraItem } from '@/components/ui/sidebar-extra'
import { cn } from '@/lib/utils'
import { type Node, type NodeSchema, project } from '@easy-editor/core'
import {
  BarChart3,
  Box,
  Calendar,
  ChevronRight,
  Eye,
  EyeOff,
  FormInput,
  Gauge,
  Image,
  Layers,
  LineChart,
  LockKeyhole,
  LockKeyholeOpen,
  type LucideIcon,
  MousePointerClick,
  PieChart,
  Radar,
  Table,
  TrendingUp,
  Type,
} from 'lucide-react'
import { observer } from 'mobx-react'
import { type Key, useState } from 'react'
import { RendererContextMenu } from '../ContextMenu'
import styles from './Outline.module.css'

// Component icon mapping
const COMPONENT_ICONS: Record<string, LucideIcon> = {
  // Inner
  Group: Box,

  // Basic
  Text: Type,
  Image: Image,

  // Chart
  BarChart: BarChart3,
  BarChartHorizontal: BarChart3,
  BarChartStacked: BarChart3,
  BarChartNegative: BarChart3,
  LineChart: LineChart,
  AreaChart: LineChart,
  PieChart: PieChart,
  PieChartDonut: PieChart,
  PieChartStacked: PieChart,
  RadarChart: Radar,
  RadarChartLines: Radar,
  RadialChart: Gauge,
  RadialChartStacked: Gauge,
  RadialChartText: Gauge,

  // Display
  Table: Table,
  Progress: TrendingUp,
  Carousel: Layers,

  // Interaction
  Button: MousePointerClick,
  Input: FormInput,
  Select: FormInput,
  Combobox: FormInput,
  Calendar: Calendar,
  CalendarButton: Calendar,
  Toggle: MousePointerClick,
  ToggleGroup: MousePointerClick,
  Sonner: Layers,

  // Fallback
  default: Layers,
}

const getComponentIcon = (componentName: string): LucideIcon => {
  return COMPONENT_ICONS[componentName] || COMPONENT_ICONS.default
}

export const OutlineSidebar = observer(() => {
  const rootNode = project.currentDocument?.rootNode
  if (!rootNode || !rootNode.childrenNodes?.length) {
    return null
  }

  return (
    <SidebarMenu className={styles.outlineTree}>
      {rootNode.childrenNodes.map((childNode: Node<NodeSchema>, index: Key | null | undefined) => (
        <SidebarMenuItem key={index} className='px-4'>
          <RendererContextMenu>
            <OutlineTree node={childNode} depth={0} />
          </RendererContextMenu>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  )
})

const OutlineTree = observer(({ node, depth = 0 }: { node: Node<NodeSchema>; depth?: number }) => {
  const selected = project.designer.selection.getTopNodes(true)
  const [isShowExtra, setIsShowExtra] = useState(false)

  const handleHide = () => {
    node.hide(!node.isHidden)
  }

  const handleLock = () => {
    node.lock(!node.isLocked)
  }

  const handleSelect = () => {
    if (node.canSelect()) {
      node.select()
    }
  }

  const ComponentIcon = getComponentIcon(node.componentName)

  if (!node.childrenNodes?.length) {
    return (
      <div
        onClick={handleSelect}
        onContextMenu={handleSelect}
        onMouseEnter={() => setIsShowExtra(true)}
        onMouseLeave={() => setIsShowExtra(false)}
        className={styles.treeNode}
        data-selected={selected.includes(node)}
        data-hidden={node.isHidden}
        data-locked={node.isLocked}
        style={{ paddingLeft: `calc(${depth} * var(--outline-indent-size) + 0.5rem)` }}
      >
        <div className={styles.nodeContent}>
          <ComponentIcon className={styles.nodeIcon} />
          <span className={styles.nodeName}>{node.title || node.componentName}</span>
        </div>
        <SidebarMenuExtra>
          <SidebarMenuExtraItem
            className={cn(styles.actionButton, (isShowExtra || node.isHidden) && styles.actionButtonVisible)}
            onClick={handleHide}
          >
            {node.isHidden ? <EyeOff /> : <Eye />}
          </SidebarMenuExtraItem>
          <SidebarMenuExtraItem
            className={cn(styles.actionButton, (isShowExtra || node.isLocked) && styles.actionButtonVisible)}
            onClick={handleLock}
          >
            {node.isLocked ? <LockKeyhole /> : <LockKeyholeOpen />}
          </SidebarMenuExtraItem>
        </SidebarMenuExtra>
      </div>
    )
  }

  return (
    <SidebarMenuItem>
      <Collapsible className={styles.collapsible} defaultOpen>
        <div
          onClick={handleSelect}
          onContextMenu={handleSelect}
          onMouseEnter={() => setIsShowExtra(true)}
          onMouseLeave={() => setIsShowExtra(false)}
          className={styles.treeNode}
          data-selected={selected.includes(node)}
          data-hidden={node.isHidden}
          data-locked={node.isLocked}
          style={{ paddingLeft: `calc(${depth} * var(--outline-indent-size) + 0.5rem)` }}
          tabIndex={0}
        >
          <div className={styles.nodeContent}>
            <CollapsibleTrigger asChild>
              <ChevronRight className={styles.chevronIcon} />
            </CollapsibleTrigger>
            <ComponentIcon className={styles.nodeIcon} />
            <span className={styles.nodeName}>{node.title || node.componentName}</span>
          </div>
          {!node.isRoot && (
            <SidebarMenuExtra>
              <SidebarMenuExtraItem
                className={cn(styles.actionButton, (isShowExtra || node.isHidden) && styles.actionButtonVisible)}
                data-active={node.isHidden}
                onClick={handleHide}
              >
                {node.isHidden ? <EyeOff /> : <Eye />}
              </SidebarMenuExtraItem>
              <SidebarMenuExtraItem
                className={cn(styles.actionButton, (isShowExtra || node.isLocked) && styles.actionButtonVisible)}
                data-active={node.isLocked}
                onClick={handleLock}
              >
                {node.isLocked ? <LockKeyhole /> : <LockKeyholeOpen />}
              </SidebarMenuExtraItem>
            </SidebarMenuExtra>
          )}
        </div>
        <CollapsibleContent>
          <SidebarMenuSub className={cn('mr-0 pr-0', styles.menuSub)}>
            {node.childrenNodes?.map((childrenNode: Node<NodeSchema>, index: Key | null | undefined) => (
              <OutlineTree key={index} node={childrenNode} depth={depth + 1} />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  )
})
