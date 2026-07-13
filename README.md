# 浏览器插件项目

这是一个浏览器插件脚手架项目，基于 React、TypeScript、Vite 和 Turborepo 构建，用于快速开发 Chrome / Firefox 插件。

## 主要功能

- 提供插件开发所需的基础工程结构
- 支持 popup、content script、side panel、DevTools 等常见页面
- 集成 i18n、HMR、TailwindCSS 和自动化测试能力
- 适合作为浏览器插件项目的起始模板

## 使用方式

1. 安装依赖：`pnpm install`
2. 启动开发：`pnpm dev`
3. 生成的 `dist` 文件夹就是可以直接使用的浏览器插件内容

## 调试开关（Popup DevTools Console）

在插件 Popup 的 DevTools Console 中可全局切换【处理待办】按钮状态：

```js
localStorage.setItem('pendingReadSuccess', 'true')  // 允许点击
localStorage.setItem('pendingReadSuccess', 'false') // 禁止点击
```


# 试用范围

- 测试环境：https://uat01.xxxxxxxxxxxxxxxxxxxxx/ 

- 待办页面（全窗口模式）
- 待办信息读取（仅【通讯费报销】流程）
