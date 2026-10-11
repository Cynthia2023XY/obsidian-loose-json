import {execFileSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

/** 仅允许对指定的独立测试库执行运行验收 */
const vault = '新功能测试仓库';
/** 不覆盖任何既有笔记的本次验收文件名 */
const path = `Loose JSON 自动验收-${Date.now()}.md`;
/** 包含代码块、日志、字符串化字段及受保护语言的脱敏样例 */
const source = '```json\n{"items":[1,2],"id":9223372036854775807}\n```\n\n2026-10-08 15:59:55.931 | WARN | 11.247.172.117 | response={"a":1}\n\n```json\n{"data":"{\\"total\\":1}","path":"C:\\\\tmp"}\n```\n\n```js\n{"keep":1}\n```\n';
/** 当前流程已通过的用户行为 */
const checks = [];

/** 调用官方 CLI，参数数组不会解释反引号或用户文本 */
function evaluate(code) {
  // CLI 对同步结果添加 => 前缀，对异步动作通过独立查询核验。
  const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code}`], {encoding: 'utf8'}).trim();
  if (output.startsWith('Error:')) throw new Error(output);
  return output.startsWith('=> ') ? output.slice(3) : output;
}

/** 读取宿主中的 JSON 状态，不以命令退出码代替行为验收 */
function state(expression) {return JSON.parse(evaluate(`JSON.stringify(${expression})`));}

/** 允许 Electron 异步渲染或工作线程完成，十秒后明确失败 */
async function until(expression, predicate = value => Boolean(value)) {
  // 等待截止时间，所有轮询只读取当前测试流程状态。
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // 本轮读取的实际宿主状态。
    const value = state(expression);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}

/** 对当前测试笔记的编辑器进行最小操作 */
function editor(code) {evaluate(`/* 当前验收笔记的宿主编辑器 */ const editor=app.workspace.activeLeaf.view.editor; ${code}; "ok"`);}
/** 关闭本插件自己的预览，不操作其他插件窗口 */
function closePreviews() {evaluate('app.plugins.plugins["loose-json"].modals.forEach(modal=>modal.close()); "closed"');}
/** 使用真实命令入口执行插件，而非直接调用核心函数 */
function command(id) {execFileSync('obsidian', [`vault=${vault}`, 'command', `id=loose-json:${id}`], {encoding: 'utf8'});}
/** 等待并应用真实预览中的选中修改 */
async function applyPreview() {
  await until('!!document.querySelector(".loose-json-actions .mod-cta")');
  evaluate('document.querySelector(".loose-json-actions .mod-cta").click(); "applied"');
}

assert.equal(state('app.vault.getName()'), vault);
assert.equal(state('app.plugins.plugins["loose-json"].manifest.version'), '0.1.0');
evaluate(`(async()=>{ /* 本次新建的独立样例 */ const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)}); await app.workspace.getLeaf(false).openFile(file,{state:{mode:"source"}});})()`);
await until('app.workspace.getActiveFile()?.path', value => value === path);
await until('document.querySelectorAll(".loose-json-editor-action").length', value => value === 2);

// 按钮与光标分离，证明目标绑定所属代码块。
editor('editor.setCursor({line:9,ch:0})');
evaluate('document.querySelector(".loose-json-format-button").click(); "clicked"');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('  "items": ['));
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('response={"a":1}'));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
checks.push('编辑器按钮绑定所属块；大整数保持；单次撤销恢复原文');

// 文档批量预览应用后仍保留整个日志前缀与其他语言块。
command('format-document');
await applyPreview();
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('response={\n'));
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('2026-10-08 15:59:55.931 | WARN | 11.247.172.117 | response='));
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('```js\n{"keep":1}\n```'));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
checks.push('文档预览应用；日志前缀与其他语言保护；批量单次撤销');

// JS 转换只预览，不改动源笔记，也不写测试者的剪贴板。
editor('editor.setCursor({line:1,ch:0})');
command('copy-javascript');
await until('document.querySelector(".loose-json-modal pre")?.textContent', value => value?.includes('items: ['));
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
closePreviews();
checks.push('JS 字面量预览生成成功；原笔记不变');

// 字段类型转换使用真实候选窗口选择并应用。
editor('editor.setCursor({line:8,ch:0})');
command('decode-fields');
await until('document.querySelector(".loose-json-modal")?.textContent', value => value?.includes('/data'));
await applyPreview();
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('"data":{\n'));
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('"path":"C:\\\\tmp"'));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
checks.push('字符串字段转对象；普通路径保持；撤销恢复');

// 修改预览后的源内容，验证不会覆盖新的笔记内容。
command('format-document');
await until('!!document.querySelector(".loose-json-actions .mod-cta")');
editor('editor.replaceRange("验证预览过期\\n",{line:0,ch:0})');
await applyPreview();
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), '验证预览过期\n' + source);
closePreviews();
editor('editor.undo()');
checks.push('过期预览拒绝应用，保留最新编辑');

// 设置变更即时更新已经打开的编辑器。
evaluate('/* 当前验收插件 */ const plugin=app.plugins.plugins["loose-json"];plugin.settings.buttons=false;plugin.saveSettings(); "hide"');
await until('document.querySelectorAll(".loose-json-editor-action").length', value => value === 0);
evaluate('/* 恢复默认按钮配置 */ const plugin=app.plugins.plugins["loose-json"];plugin.settings.buttons=true;plugin.saveSettings(); "show"');
await until('document.querySelectorAll(".loose-json-editor-action").length', value => value === 2);
assert.equal(state('app.setting.pluginTabs.find(tab=>tab.id==="loose-json").getSettingDefinitions().length'), 5);
checks.push('按钮设置即时更新；五项设置可被宿主搜索');

// 阅读模式按钮核验源位置后打开编辑器应用，不直接写 DOM 文本。
evaluate(`app.workspace.activeLeaf.setViewState({type:"markdown",state:{file:${JSON.stringify(path)},mode:"preview"}}); "reading"`);
await until('document.querySelectorAll(".loose-json-reading-action").length', value => value === 2);
evaluate('document.querySelector(".loose-json-reading-action").click(); "clicked"');
await until('app.workspace.activeLeaf.view.getMode()', value => value === 'source');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('  "items": ['));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
checks.push('阅读按钮准确定位原块，切换编辑并可撤销');

/** 将验收证据保存到忽略目录，避免把宿主状态推送到公开仓库 */
const report = {date: '2026-10-11', version: '0.1.0', vault, note: path, checks};
await mkdir('.runtime-test', {recursive: true});
await writeFile('.runtime-test/runtime.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
