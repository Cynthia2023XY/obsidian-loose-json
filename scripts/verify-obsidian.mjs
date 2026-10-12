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
/** 需要前台测试窗口才能验证的场景，跳过时明确报告 */
const skipped = [];

/** 调用官方 CLI，参数数组不会解释反引号或用户文本 */
function evaluate(code) {
  // CLI 对同步结果添加 => 前缀，对异步动作通过独立查询核验。
  const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code}`], {encoding: 'utf8'}).trim();
  if (output.startsWith('Error:')) throw new Error(output);
  return output.startsWith('=> ') ? output.slice(3) : output;
}

/** 读取宿主中的 JSON 状态，不以命令退出码代替行为验收 */
function state(expression) {
  // 宿主切换视图时 CLI 偶尔返回空输出，由 until 继续等待而非误报解析失败。
  const output = evaluate(`JSON.stringify((${expression}) ?? null)`);
  return output ? JSON.parse(output) : null;
}

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

/** 验收前备份全部设置，失败时也恢复，避免留下测试偏好 */
const savedSettings = state('app.plugins.plugins["loose-json"].settings');
try {
evaluate('Object.assign(app.plugins.plugins["loose-json"].settings,{language:"zh",previewDocument:true,previewDecode:true,previewJs:true,buttons:true}); app.plugins.plugins["loose-json"].saveSettings();"defaults"');
assert.equal(state('app.vault.getName()'), vault);
assert.equal(state('app.plugins.plugins["loose-json"].manifest.version'), '0.2.0');
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
assert.equal(state('app.setting.pluginTabs.find(tab=>tab.id==="loose-json").getSettingDefinitions().length'), 9);
checks.push('按钮设置即时更新；九项设置可被宿主搜索');

// 新入口处理日志和属性片段，多个候选不会自动合并。
editor('editor.setValue("```json\\n26-10-10.17:10:00 request={\\\"a\\\":1}, response=null\\n```\\n");editor.setCursor({line:1,ch:0})');
command('copy-javascript');
await until('document.querySelectorAll(".loose-json-change").length', value => value === 2);
assert.ok(state('document.querySelector(".loose-json-modal").textContent').includes('response'));
closePreviews();
checks.push('日志转 JS 两个候选含 null 出参，原标签保留');

// 拆块默认插入原块外；原日志仍在，整个插入可单次撤销。
const originalLog = state('app.workspace.activeLeaf.view.editor.getValue()');
command('extract-json');
await until('document.querySelector(".loose-json-modal")?.textContent', value => value?.includes('request'));
evaluate('Array.from(document.querySelectorAll(".loose-json-modal button")).find(button=>/插入|Insert/.test(button.textContent)).click();"inserted"');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => (value.match(/```json/g) ?? []).length === 3);
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').startsWith(originalLog));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), originalLog);
checks.push('日志拆块保留原文，在围栏外生成入参和 null 出参，单次撤销');

// 延迟加载的候选仍保留默认结果，批量插入不得出现 undefined。
const manyLogs = '```json\n' + Array.from({length: 51}, (_, index) => `request={"item":${index}}`).join('\n') + '\n```\n';
editor(`editor.setValue(${JSON.stringify(manyLogs)});editor.setCursor({line:1,ch:0})`);
command('extract-json');
await until('document.querySelectorAll(".loose-json-change").length', value => value === 50);
evaluate('Array.from(document.querySelectorAll(".loose-json-modal button")).find(button=>/插入|Insert/.test(button.textContent)).click();"inserted"');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => (value.match(/```json/g) ?? []).length === 52);
assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('"item": 50'));
assert.ok(!state('app.workspace.activeLeaf.view.editor.getValue()').includes('undefined'));
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), manyLogs);
checks.push('51 个候选分页展示，未加载项仍正确插入，批量单次撤销');

// 截断排版不会补闭合，独立修复可生成严格 JSON。
editor('editor.setValue("```json\\n{id:9223372036854775807,items:[1,2,\\n```\\n");editor.setCursor({line:1,ch:0})');
command('repair-json');
await until('document.querySelector(".loose-json-modal pre")?.textContent', value => value?.includes('9223372036854775807'));
assert.ok(state('document.querySelector(".loose-json-modal").textContent').includes('2'));
closePreviews();
checks.push('截断修复预览成功，超大整数文本保持');

// 关闭普通预览直接写入，并通过单次撤销恢复。
evaluate('app.plugins.plugins["loose-json"].settings.previewDocument=false;"configured"');
editor(`editor.setValue(${JSON.stringify(source)});editor.setCursor({line:1,ch:0})`);
command('format-document');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('response={\n'));
assert.equal(state('!!document.querySelector(".loose-json-modal")'), false);
editor('editor.undo()');
assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
evaluate('app.plugins.plugins["loose-json"].settings.previewDocument=true;app.plugins.plugins["loose-json"].settings.previewDecode=false;"configured"');
editor('editor.setCursor({line:8,ch:0})');
command('decode-fields');
await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('"data":{\n'));
assert.equal(state('!!document.querySelector(".loose-json-modal")'), false);
editor('editor.undo()');
evaluate('app.plugins.plugins["loose-json"].settings.previewDecode=true;"restored"');
checks.push('全文和字段转换可关闭预览，直接应用且可撤销');

// 语言实时更新按钮和新窗口，不更改日志标签。
evaluate('app.plugins.plugins["loose-json"].settings.language="en";app.plugins.plugins["loose-json"].saveSettings();"english"');
await until('document.querySelector(".loose-json-format-button")?.textContent', value => value === 'Format');
command('format-document');
await until('document.querySelector(".loose-json-modal")?.textContent', value => value?.includes('Document formatting'));
closePreviews();
checks.push('英文按钮及全文预览文案生效');
evaluate('app.plugins.plugins["loose-json"].settings.language="zh";app.plugins.plugins["loose-json"].saveSettings();"restored"');
await until('document.querySelector(".loose-json-format-button")?.textContent', value => value === '格式化');

// 阅读模式按钮核验源位置后打开编辑器应用，不直接写 DOM 文本。
if (state('document.visibilityState') === 'visible') {
  evaluate(`app.workspace.activeLeaf.setViewState({type:"markdown",state:{file:${JSON.stringify(path)},mode:"preview"}}); "reading"`);
  await until('document.querySelectorAll(".loose-json-reading-action").length', value => value === 2);
  evaluate('document.querySelector(".loose-json-reading-action").click(); "clicked"');
  await until('app.workspace.activeLeaf.view.getMode()', value => value === 'source');
  await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('  "items": ['));
  editor('editor.undo()');
  assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
  checks.push('阅读按钮准确定位原块，切换编辑并可撤销');
} else {
  skipped.push('阅读模式：测试库窗口隐藏，Obsidian 不渲染阅读内容；保持窗口可见后重新运行。');
}

/** 将验收证据保存到忽略目录，避免把宿主状态推送到公开仓库 */
const report = {date: new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai'}).format(new Date()), version: '0.2.0', vault, note: path, complete: skipped.length === 0, checks, skipped};
await mkdir('.runtime-test', {recursive: true});
await writeFile('.runtime-test/runtime.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

} finally {
  closePreviews();
  evaluate(`Object.assign(app.plugins.plugins["loose-json"].settings,${JSON.stringify(savedSettings)});app.plugins.plugins["loose-json"].saveSettings();"settings restored"`);
}
