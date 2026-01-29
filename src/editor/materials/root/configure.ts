import type { Configure } from '@easy-editor/core'
import Root from './component'

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
          title: '配置',
          items: [
            {
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: {
                label: false,
              },
            },
            {
              type: 'group',
              title: '全局属性',
              setter: {
                componentName: 'CollapseSetter',
                props: {
                  icon: false,
                },
              },
              items: [
                {
                  name: 'backgroundColor',
                  title: '背景颜色',
                  setter: 'ColorSetter',
                },
                {
                  name: '__image',
                  title: '图片地址',
                  setter: 'UploadSetter',
                  extraProps: {
                    setValue(target, value: any) {
                      if (value) {
                        target.parent.setPropValue('backgroundImage', value.base64)
                      } else {
                        target.parent.clearPropValue('backgroundImage')
                      }
                    },
                  },
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
              name: 'nodeInfo',
              title: '节点信息',
              setter: 'NodeInfoSetter',
              extraProps: {
                label: false,
              },
            },
          ],
        },
      ],
    },
  ],
  component: {},
  supports: {},
  advanced: {
    view: Root,
  },
}

export default configure
