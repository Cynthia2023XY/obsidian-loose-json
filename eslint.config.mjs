import obsidianmd from 'eslint-plugin-obsidianmd';
/** 市场规范检查只针对产品代码，测试另由类型检查与运行验证 */
export default [
  ...obsidianmd.configs.recommended,
  {ignores: ['node_modules/**', 'dist/**', 'coverage/**', 'main.js', 'tests/**', 'scripts/**', '*.mjs', 'vitest.config.mts']},
  {files: ['src/**/*.ts'], languageOptions: {parserOptions: {projectService: true}}, rules: {
    'obsidianmd/ui/sentence-case': ['warn', {acronyms: ['JS', 'TS', 'JSON', 'JSON5'], brands: ['Loose JSON', 'MiB']}]
  }},
  // 编辑器组件使用所属 ownerDocument 创建节点，可独立测试且支持弹出窗口。
  {files: ['src/editor-buttons.ts'], rules: {'obsidianmd/prefer-create-el': 'off'}}
];
