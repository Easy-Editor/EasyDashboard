import { systemFonts } from '@/editor/utils'
import type { Configure } from '@easy-editor/core'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
} from 'lucide-react'
import Button from './component'

const configure: Configure = {
  props: [
    {
      type: 'group',
      title: '功能',
      setter: 'TabSetter',
      items: [
        {
          type: 'group',
          key: 'basic',
          title: '基本',
          items: [
            {
              name: 'id',
              title: 'ID',
              setter: 'NodeIdSetter',
              extraProps: {
                label: false,
              },
            },
            {
              name: 'title',
              title: '标题',
              setter: 'StringSetter',
              extraProps: {
                getValue(target) {
                  return target.getExtraPropValue('title')
                },
                setValue(target, value) {
                  target.setExtraPropValue('title', value)
                },
              },
            },
            {
              type: 'group',
              title: '基础属性',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'rect',
                  title: '位置尺寸',
                  setter: 'RectSetter',
                  extraProps: {
                    getValue(target) {
                      return target.getExtraPropValue('$dashboard.rect')
                    },
                    setValue(target, value) {
                      target.setExtraPropValue('$dashboard.rect', value)
                    },
                  },
                },
              ],
            },
            {
              type: 'group',
              setter: 'SubTabSetter',
              items: [
                {
                  type: 'group',
                  key: 'basic',
                  title: '全局',
                  items: [
                    {
                      name: 'textDirection',
                      title: '文字方向',
                      setter: {
                        componentName: 'RadioSetter',
                        props: {
                          // orientation: '',
                          options: [
                            {
                              label: '横排',
                              value: 'horizontal',
                            },
                            {
                              label: '竖排',
                              value: 'vertical',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'horizontalAlign',
                      title: '水平对齐',
                      setter: {
                        componentName: 'ToggleSetter',
                        props: {
                          options: [
                            {
                              label: '左对齐',
                              value: 'flex-start',
                              icon: <AlignLeft />,
                            },
                            {
                              label: '居中',
                              value: 'center',
                              icon: <AlignCenter />,
                            },
                            {
                              label: '右对齐',
                              value: 'flex-end',
                              icon: <AlignRight />,
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'verticalAlign',
                      title: '垂直对齐',
                      setter: {
                        componentName: 'ToggleSetter',
                        props: {
                          options: [
                            {
                              label: '上对齐',
                              value: 'flex-start',
                              icon: <AlignVerticalJustifyStart />,
                            },
                            {
                              label: '居中',
                              value: 'center',
                              icon: <AlignVerticalJustifyCenter />,
                            },
                            {
                              label: '下对齐',
                              value: 'flex-end',
                              icon: <AlignVerticalJustifyEnd />,
                            },
                          ],
                        },
                      },
                    },

                    {
                      name: 'variant',
                      title: '按钮样式',
                      setter: {
                        componentName: 'SelectSetter',
                        props: {
                          options: [
                            {
                              label: '默认',
                              value: 'default',
                            },
                            {
                              label: '次要',
                              value: 'secondary',
                            },
                            {
                              label: '危险',
                              value: 'destructive',
                            },
                            {
                              label: '线框',
                              value: 'outline',
                            },
                            {
                              label: '幽灵',
                              value: 'ghost',
                            },
                            {
                              label: '链接',
                              value: 'link',
                            },
                          ],
                        },
                      },
                    },
                    {
                      name: 'loading',
                      title: '加载',
                      setter: 'SwitchSetter',
                    },
                  ],
                },
                {
                  type: 'group',
                  key: 'test',
                  title: '样式',
                  items: [
                    {
                      type: 'group',
                      setter: 'ToggleGroupSetter',
                      items: [
                        {
                          type: 'group',
                          key: 'default',
                          title: '默认',
                          items: [
                            {
                              name: 'radius',
                              title: '圆角',
                              setter: {
                                componentName: 'NumberSetter',
                                props: {
                                  suffix: 'px',
                                },
                              },
                            },
                            {
                              type: 'group',
                              title: '文字',
                              setter: {
                                componentName: 'AccordionSetter',
                                props: {
                                  orientation: 'horizontal',
                                },
                              },
                              items: [
                                {
                                  name: 'text.fontFamily',
                                  title: '字体',
                                  setter: {
                                    componentName: 'SelectSetter',
                                    props: {
                                      options: systemFonts,
                                    },
                                  },
                                },
                                {
                                  name: 'text.fontSize',
                                  title: '字体大小',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.color',
                                  title: '字体颜色',
                                  setter: 'ColorSetter',
                                },
                                {
                                  name: 'text.fontWeight',
                                  title: '字体粗细',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.fontStyle',
                                  title: '斜体',
                                  setter: 'SwitchSetter',
                                },
                                {
                                  name: 'text.letterSpacing',
                                  title: '字距',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                                {
                                  name: 'text.lineHeight',
                                  title: '行高',
                                  setter: {
                                    componentName: 'NumberSetter',
                                    props: {
                                      suffix: 'px',
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        {
                          type: 'group',
                          key: 'click',
                          title: '点击',
                          items: [
                            {
                              name: 'text',
                              title: '内容222',
                              setter: 'StringSetter',
                            },
                          ],
                        },
                        {
                          type: 'group',
                          key: 'hover',
                          title: '悬停',
                          items: [
                            {
                              name: 'text',
                              title: '内容333',
                              setter: 'StringSetter',
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: 'group',
          key: 'advanced',
          title: '高级',
          items: [
            {
              name: 'size',
              title: '尺寸',
              setter: 'StringSetter',
            },
          ],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Button,
  },
}

export default configure
