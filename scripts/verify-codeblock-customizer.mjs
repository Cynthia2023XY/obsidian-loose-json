import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';

/** 运行验收只允许修改独立测试笔记库 */
const vault = '新功能测试仓库';
/** 每次创建独立脱敏笔记，不覆盖已有内容 */
const path = `Loose JSON CBC 验收-${Date.now()}.md`;
/** 覆盖原生块、独立标题及排除 CBC 的代码块 */
const source = '```json\n{"a":1,"id":9223372036854775807}\n```\n\n```json title:test\n{"b":2}\n```\n\n```json exclude\n{"c":3}\n```\n';
/** 记录实际通过的行为，不把构建通过当作界面验收 */
const checks = [];

/** 使用参数数组调用官方 CLI，避免 shell 解释笔记围栏 */
function evaluate(code) {
  // CLI 返回同步结果时带有展示前缀。
  const output = execFileSync('obsidian', [`vault=${vault}`, 'eval', `code=${code}`], {encoding: 'utf8'}).trim();
  if (output.startsWith('Error:')) throw new Error(output);
  return output.replace(/^=> /, '');
}
/** 读取明确限定测试库的状态 */
function state(expression) {return JSON.parse(evaluate(`JSON.stringify(${expression})`) || 'null');}
/** 为插件渲染和工作线程预留有界等待 */
async function until(expression, predicate = value => !!value) {
  // 每个行为最多等待十秒，失败时保留具体表达式。
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    // 当前测试窗口中的实际状态。
    const value = state(expression);
    if (predicate(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${expression}`);
}
/** 切换真实编辑器模式，重新构建第三方装饰 */
async function mode(value, sourceMode = false) {
  evaluate(`app.workspace.activeLeaf.setViewState({type:"markdown",state:{file:${JSON.stringify(path)},mode:${JSON.stringify(value)},source:${sourceMode}}}); "ok"`);
  await until('app.workspace.activeLeaf.view.getState()', state => state?.file === path && state.mode === value && (value !== 'source' || state.source === sourceMode));
  await new Promise(resolve => setTimeout(resolve, 250));
}
/** 找到实际可见入口并验证它没有被宿主覆盖 */
function layout() {
  return state(`Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll('.loose-json-toolbar-action')).map(button=>{
    // 真实窗口中的可见按钮与同排复制按钮。
    const rect=button.getBoundingClientRect(), copy=button.parentElement.querySelector('[aria-label="Copy code"]'), other=copy?.getBoundingClientRect();
    return {visible:rect.width>0 && rect.height>0,hit:button.ownerDocument.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===button,gap:other?other.x-rect.right:null};
  }).filter(item=>item.visible)`);
}
/** 验证点击后只修改所属块，随后一次撤销恢复完整原文 */
async function clickAndUndo(index, key) {
  await until('Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll(".loose-json-toolbar-action")).filter(button=>button.getBoundingClientRect().width>0).length', value => value > index);
  evaluate(`Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll('.loose-json-toolbar-action')).filter(button=>button.getBoundingClientRect().width>0)[${index}].click(); "clicked"`);
  await until('app.workspace.activeLeaf.view.editor?.getValue()', value => value?.includes(`  "${key}": `));
  assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').includes('9223372036854775807'));
  evaluate('app.workspace.activeLeaf.view.editor.undo(); "undo"');
  assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
}

/** 验收前保存两个插件设置，失败退出也恢复 */
const saved = state('({loose:app.plugins.plugins["loose-json"].settings,cbc:app.plugins.plugins["codeblock-customizer"].settings})');
assert.equal(state('app.vault.getName()'), vault);
assert.equal(state('document.hidden'), false, '测试库需位于前台以执行动画帧和点击命中检测');
try {
  evaluate(`(async()=>{
    // 验收文件只含本脚本生成的脱敏样例。
    const file=await app.vault.create(${JSON.stringify(path)},${JSON.stringify(source)});
    await app.workspace.getLeaf(false).openFile(file,{state:{mode:"source"}});
    // 设置通过真实插件保存入口应用。
    const cbc=app.plugins.plugins["codeblock-customizer"],loose=app.plugins.plugins["loose-json"];
    cbc.settings.pluginSettings.common.enableInSourceMode=true;
    cbc.settings.pluginSettings.codeblock.buttons.alwaysShowButtons=true;
    cbc.settings.pluginSettings.codeblock.buttons.alwaysShowCopyCodeButton=true;
    await cbc.saveSettings();loose.settings.buttons=true;loose.settings.language="zh";await loose.saveSettings();
  })()`);
  await until('app.workspace.getActiveFile()?.path', value => value === path);
  await until('app.workspace.activeLeaf.view.containerEl.querySelectorAll(".loose-json-toolbar-action").length', value => value >= 4);
  assert.equal(layout().length, 2);
  assert.ok(layout().every(item => item.hit && item.gap >= 7));
  await clickAndUndo(0, 'a');
  await clickAndUndo(1, 'b');
  checks.push('实时预览：普通块及标题块与复制入口并排、无遮挡、独立目标、大整数保持、单次撤销');
  assert.equal(state('app.workspace.activeLeaf.view.containerEl.querySelectorAll(".loose-json-editor-action:not(.loose-json-cbc-adapted)").length'), 1);
  checks.push('CBC exclude 块继续提供原生入口');

  evaluate('app.workspace.activeLeaf.view.editor.replaceRange("标题\\n",{line:0,ch:0}); "inserted"');
  await new Promise(resolve => setTimeout(resolve, 250));
  evaluate('Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll(".loose-json-toolbar-action")).find(button=>button.getBoundingClientRect().width>0).click(); "clicked"');
  await until('app.workspace.activeLeaf.view.editor.getValue()', value => value.includes('  "a": '));
  assert.ok(state('app.workspace.activeLeaf.view.editor.getValue()').startsWith('标题\n'));
  evaluate('app.workspace.activeLeaf.view.editor.undo();app.workspace.activeLeaf.view.editor.undo(); "undo"');
  assert.equal(state('app.workspace.activeLeaf.view.editor.getValue()'), source);
  checks.push('源位置前移后兼容入口重新绑定正确块');

  evaluate('app.plugins.plugins["codeblock-customizer"].settings.pluginSettings.codeblock.hideFenceLines=true;app.plugins.plugins["codeblock-customizer"].saveSettings(); "hide fences"');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(layout().length >= 2 && layout().every(item => item.hit));
  checks.push('隐藏围栏后按钮仍可命中');
  await mode('source', true);
  assert.ok(layout().length >= 2 && layout().every(item => item.hit));
  checks.push('源码模式与 CBC 同时启用时并排显示');

  evaluate('app.plugins.plugins["loose-json"].settings.buttons=false;app.plugins.plugins["loose-json"].saveSettings(); "off"');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value === 0);
  evaluate('app.plugins.plugins["loose-json"].settings.buttons=true;app.plugins.plugins["loose-json"].saveSettings(); "on"');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value >= 4);
  checks.push('按钮开关即时清理与恢复兼容入口');

  await mode('preview');
  await until('app.workspace.activeLeaf.view.containerEl.querySelectorAll(".loose-json-toolbar-action").length', value => value >= 2);
  assert.ok(layout().every(item => item.hit));
  await clickAndUndo(0, 'a');
  checks.push('阅读模式：工具栏按钮按源范围格式化并单次撤销');

  await mode('source');
  evaluate('Array.from(app.workspace.activeLeaf.view.containerEl.querySelectorAll(".codeblock-customizer-header-container-specific")).find(header=>header.getBoundingClientRect().width>0).click(); "fold"');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(state('!!app.workspace.activeLeaf.view.containerEl.querySelector(".codeblock-customizer-header-container-specific.collapsed")'));
  assert.ok(state('!!app.workspace.activeLeaf.view.containerEl.querySelector(".codeblock-customizer-header-container-specific.collapsed .loose-json-toolbar-action")'));
  checks.push('折叠标题仍持有对应源块入口');

  evaluate('(async()=>{await app.plugins.disablePlugin("codeblock-customizer");})()');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value === 0);
  assert.ok(state('document.querySelectorAll(".loose-json-editor-action:not(.loose-json-cbc-adapted)").length') >= 2);
  evaluate('(async()=>{await app.plugins.enablePlugin("codeblock-customizer");})()');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value >= 4);
  checks.push('CBC 禁用后恢复原生入口；晚于 Loose JSON 启用时自动适配');

  evaluate('(async()=>{await app.plugins.disablePlugin("loose-json");})()');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value === 0);
  assert.equal(state('document.querySelectorAll(".loose-json-cbc-adapted").length'), 0);
  evaluate('(async()=>{await app.plugins.enablePlugin("loose-json");})()');
  await until('document.querySelectorAll(".loose-json-toolbar-action").length', value => value >= 4);
  checks.push('Loose JSON 卸载后清理工具栏与隐藏标记；反向启用顺序适配成功');
} finally {
  evaluate(`(async()=>{
    // 所有验收偏好恢复为运行前保存的测试库配置。
    const loose=app.plugins.plugins["loose-json"],cbc=app.plugins.plugins["codeblock-customizer"];
    loose.settings=${JSON.stringify(saved.loose)};await loose.saveSettings();
    cbc.settings=${JSON.stringify(saved.cbc)};await cbc.saveSettings();
  })()`);
}
await mkdir('.runtime-test', {recursive:true});
await writeFile('.runtime-test/codeblock-customizer-verification.json', JSON.stringify({vault,path,checks,cbcVersion:state('app.plugins.plugins["codeblock-customizer"].manifest.version')}, null, 2));
console.log(JSON.stringify({vault,path,checks},null,2));
