const a=()=>({name:"ExamplePlugin",deps:[],init(e){e.logger.log("打个日志",e),e.project.set("example",{aaa:"bbb"})}}),l=[a()];export{l as default};
