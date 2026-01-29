import type { ProjectSchema, RootSchema } from '@easy-editor/core'

export const defaultRootSchema: RootSchema = {
  fileName: 'home',
  fileDesc: '首页',
  componentName: 'Root',
  props: {
    backgroundColor: '#232630',
    className: 'page test',
  },
  isRoot: true,
  $dashboard: {
    rect: {
      x: 0,
      y: 0,
      // TODO: 根节点需要动态调整
      width: 1920,
      height: 1080,
    },
  },
  children: [
    {
      componentName: 'Image',
      condition: {
        type: 'JSExpression',
        value: 'this.state.isShow',
      },
      $dashboard: {
        rect: {
          x: 600,
          y: 480,
          width: 740,
          height: 120,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        content: 'Button in Root',
        __events: {
          eventDataList: [
            {
              type: 'componentEvent',
              name: 'onClick',
              relatedEventName: 'toggleState',
            },
          ],
          eventList: [
            {
              name: 'onClick',
              description: '鼠标点击',
              disabled: true,
            },
          ],
        },
        onClick: {
          type: 'JSFunction',
          value: 'function(){return this.toggleState.apply(this,Array.prototype.slice.call(arguments).concat([])) }',
        },
      },
      $dashboard: {
        rect: {
          x: 100,
          y: 100,
          width: 200,
          height: 50,
        },
      },
    },
    {
      componentName: 'Button',
      props: {
        content: 'Next Page',
        __events: {
          eventDataList: [
            {
              type: 'builtin',
              name: 'onClick',
              relatedEventName: 'utils.navigate',
              paramStr: '"test"',
            },
          ],
          eventList: [
            {
              name: 'onClick',
              description: '鼠标点击',
              disabled: true,
            },
          ],
        },
        onClick: {
          type: 'JSFunction',
          value:
            'function(){return this.utils.navigate.apply(this,Array.prototype.slice.call(arguments).concat(["test"])) }',
        },
      },
      $dashboard: {
        rect: {
          x: 1700,
          y: 1000,
          width: 200,
          height: 50,
        },
      },
    },
  ],
  state: {
    testState: {
      type: 'JSExpression',
      value: '"testState"',
      description: '文本状态',
    },
    isShow: {
      type: 'JSExpression',
      value: 'true',
      description: '是否显示',
    },
  },
  lifeCycles: {
    componentDidMount: {
      type: 'JSFunction',
      value:
        "function componentDidMount() {\n  console.log('did mount ===========', this);\n  setInterval(() => {\n  this.toggleState();\n  }, 1000);\n}",
      description: '页面挂载时触发',
    },
    componentWillUnmount: {
      type: 'JSFunction',
      value: "function componentWillUnmount() {\n  console.log('will unmount');\n}",
      description: '页面卸载时触发',
    },
  },
  methods: {
    testFunc: {
      type: 'JSFunction',
      value: "function testFunc(...params) {\n  console.log('test func', params, this);\n}",
      description: '测试方法',
    },
    toggleState: {
      type: 'JSFunction',
      value: 'function toggleState() {\n  this.setState({isShow: !this.state.isShow});\n}',
      description: '切换状态',
    },
  },
}

export const defaultProjectSchema: ProjectSchema = {
  version: '0.0.1',
  componentsTree: [
    {
      ...defaultRootSchema,
      fileName: 'home',
      fileDesc: '首页',
      // children: [
      //   {
      //     componentName: 'Image',
      //     condition: {
      //       type: 'JSExpression',
      //       value: 'this.state.isShow',
      //     },
      //     $dashboard: {
      //       rect: {
      //         x: 600,
      //         y: 480,
      //         width: 740,
      //         height: 120,
      //       },
      //     },
      //   },
      //   {
      //     componentName: 'Button',
      //     props: {
      //       content: 'Button in Root',
      //       __events: {
      //         eventDataList: [
      //           {
      //             type: 'componentEvent',
      //             name: 'onClick',
      //             relatedEventName: 'toggleState',
      //           },
      //         ],
      //         eventList: [
      //           {
      //             name: 'onClick',
      //             description: '鼠标点击',
      //             disabled: true,
      //           },
      //         ],
      //       },
      //       onClick: {
      //         type: 'JSFunction',
      //         value:
      //           'function(){return this.toggleState.apply(this,Array.prototype.slice.call(arguments).concat([])) }',
      //       },
      //     },
      //     $dashboard: {
      //       rect: {
      //         x: 100,
      //         y: 100,
      //         width: 200,
      //         height: 50,
      //       },
      //     },
      //   },
      //   {
      //     componentName: 'Button',
      //     props: {
      //       content: 'Next Page',
      //       __events: {
      //         eventDataList: [
      //           {
      //             type: 'builtin',
      //             name: 'onClick',
      //             relatedEventName: 'utils.navigate',
      //             paramStr: '"test"',
      //           },
      //         ],
      //         eventList: [
      //           {
      //             name: 'onClick',
      //             description: '鼠标点击',
      //             disabled: true,
      //           },
      //         ],
      //       },
      //       onClick: {
      //         type: 'JSFunction',
      //         value:
      //           'function(){return this.utils.navigate.apply(this,Array.prototype.slice.call(arguments).concat(["test"])) }',
      //       },
      //     },
      //     $dashboard: {
      //       rect: {
      //         x: 1700,
      //         y: 1000,
      //         width: 200,
      //         height: 50,
      //       },
      //     },
      //   },
      // ],
      children: [],
      dataSource: {
        list: [
          {
            id: 'info',
            type: 'fetch',
            isInit: true,
            options: {
              params: {},
              method: 'GET',
              uri: `${window.location.origin}/mock/info.json`,
            },
            shouldFetch: {
              type: 'JSFunction',
              value: "function shouldFetch(options) { \n  console.log('should fetch.....');\n  return true; \n}",
            },
            dataHandler: {
              type: 'JSExpression',
              value: `function dataHandler(response) {
  console.log('info dataHandler', response, response.data.data.result);
  return response.data.data.result;
}`,
            },
          },
          {
            id: 'userApi',
            type: 'fetch',
            options: {
              method: 'POST',
              uri: `${window.location.origin}/mock/user.json`,
              isSync: true,
              timeout: 5000,
              isCors: true,
              params: {
                page: '1',
                size: '10',
              },
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer token',
              },
              body: {
                name: '张三',
                email: 'zhangsan@example.com',
              },
            },
            dataHandler: {
              type: 'JSExpression',
              value: `function dataHandler(response) {
  console.log('userApi dataHandler', response.data.data.result);
  return response.data.data.result;
}`,
            },
          },
        ],
      },
    },
    {
      ...defaultRootSchema,
      fileName: 'test',
      fileDesc: '测试',
      children: [
        {
          componentName: 'Image',
          $dashboard: {
            rect: {
              x: 0,
              y: 0,
              width: 740,
              height: 120,
            },
          },
        },
        {
          componentName: 'Button',
          props: {
            content: 'Prev Page',
            __events: {
              eventDataList: [
                {
                  type: 'builtin',
                  name: 'onClick',
                  relatedEventName: 'utils.navigate',
                  paramStr: '"test"',
                },
              ],
              eventList: [
                {
                  name: 'onClick',
                  description: '鼠标点击',
                  disabled: true,
                },
              ],
            },
            onClick: {
              type: 'JSFunction',
              value:
                'function(){return this.utils.navigate.apply(this,Array.prototype.slice.call(arguments).concat(["index"])) }',
            },
          },
          $dashboard: {
            rect: {
              x: 80,
              y: 1000,
              width: 200,
              height: 50,
            },
          },
        },
      ],
    },
  ],
}
