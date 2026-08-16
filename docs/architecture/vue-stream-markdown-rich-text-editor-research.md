# `vue-stream-markdown` 能力边界调研

> 调研日期：2026-08-15
>
> 结论基于仓库 `main` 分支及其公开文档；该项目当时最新 release 为 v1.0.4。

## 结论

`vue-stream-markdown` 的定位是“面向流式场景的 Markdown 渲染器”，不是富文本编辑器。它适合把 LLM 持续返回的 Markdown 字符串实时渲染成带代码高亮、Mermaid、LaTeX、图片/表格控件的只读展示内容；不能直接提供光标、选区、输入、撤销/重做、工具栏、粘贴清洗、`v-model` 双向编辑等编辑器能力。

## 证据

1. README 将项目定义为 streaming Markdown renderer，功能描述集中在流式渲染、增量渲染、Mermaid/LaTeX、交互控件、自定义渲染器和安全处理，没有编辑器能力。[README](https://github.com/jinghaihan/vue-stream-markdown/blob/main/README.md)
2. 官方 Usage 文档的核心输入是 `content (string)`，`mode` 只有 `streaming` 和 `static` 两种，前者是渐进式内容更新，后者是完整 Markdown 内容展示；`controls` 的示例是 copy/download 等控件。[Usage](https://github.com/jinghaihan/vue-stream-markdown/blob/main/docs/guide/usage.md)
3. Vue 组件源码把内容送入 parser，再把 blocks 交给 `NodeList` 渲染；模板根节点是普通 `<div>`，没有 `contenteditable` 或编辑器状态管理。[index.vue](https://github.com/jinghaihan/vue-stream-markdown/blob/main/packages/vue/src/index.vue)
4. 组件源码只声明了 `copied` 事件；暴露的方法是获取 parser、解析后的节点和处理后的 Markdown 文本，不是编辑变更事件或双向绑定接口。[index.vue](https://github.com/jinghaihan/vue-stream-markdown/blob/main/packages/vue/src/index.vue)
5. 包的公开 exports 是渲染组件、HTML renderer、CSS 和主题；依赖/文档也围绕 AST 解析、代码高亮、Mermaid 和 KaTeX 组织，没有 editor schema、transaction、selection 或 history API。[package.json](https://github.com/jinghaihan/vue-stream-markdown/blob/main/packages/vue/package.json)、[Architecture](https://github.com/jinghaihan/vue-stream-markdown/blob/main/docs/guide/architecture.md)

## 能力判断

| 能力 | 是否直接支持 | 说明 |
| --- | --- | --- |
| 流式 Markdown 输出 | 支持 | 默认 `streaming` mode，适合不完整 Markdown 的渐进渲染 |
| 完整 Markdown 静态展示 | 支持 | `static` mode |
| 自定义节点视觉渲染 | 支持 | 可替换 AST 节点 renderer/UI component |
| 复制、下载、预览 | 支持 | 属于展示控件，不等于编辑能力 |
| 用户直接修改渲染后的文字 | 不支持 | 没有 `contenteditable`、输入事件或 selection 管理 |
| 富文本工具栏与格式操作 | 不支持 | 需要编辑器内核 |
| 编辑后导出 Markdown | 不提供现成闭环 | 虽然暴露 parser/AST 相关能力，但没有编辑器状态与变更同步机制 |

## 对当前产品的建议

如果目标是“AI 流式生成，生成完用户继续编辑”，建议采用双组件/双状态模型：

```text
LLM stream
   │
   ├─ 生成中：累计 Markdown 字符串 → vue-stream-markdown（只读预览）
   │
   └─ 生成完成：把最终 Markdown 导入真正的富文本编辑器 → 用户编辑/保存
```

关键点：

- 生成过程中不要让用户直接编辑 `vue-stream-markdown` 的 DOM；它会随着流式解析不断重建节点，光标和选区无法稳定维护。
- 以最终 Markdown 或编辑器自己的 JSON document 作为持久化源，不要把渲染后的 HTML 当作唯一数据源。
- 生成结束后，将最终 Markdown 转成编辑器文档；用户编辑期间停止用流式 renderer 覆盖同一块内容。
- 如果必须边生成边编辑，应该让真正的编辑器作为唯一状态源，并按段落/block 增量插入 AI 结果，同时处理 selection、冲突、撤销历史和取消生成；这已经是编辑器集成工作，不是给 `vue-stream-markdown` 加一个属性即可解决的问题。

## 最终判断

可以把它当作“AI Markdown 流式输出/预览层”，不能把它直接当作“富文本编辑器”。最多可以复用它的 Markdown parser、AST 和渲染器思路，编辑能力仍应由专门的富文本编辑器提供。
