// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Compartment, EditorState} from '@codemirror/state';
import {Decoration, EditorView, WidgetType} from '@codemirror/view';
import {buttonsEnabled, editorButtons, unlabelledButtonsEnabled} from '../src/editor-buttons';

/** 测试结束销毁真实 CodeMirror 实例，验证生命周期释放 */
const views: EditorView[] = [];
afterEach(() => {views.splice(0).forEach(view => view.destroy()); document.body.replaceChildren();});

describe('编辑器按钮实际行为', () => {
  it('绑定所属代码块，保留其他语言，并随编辑重新定位', () => {
    // 点击回调记录的是围栏位置，而非光标位置。
    const clicked: number[] = [];
    // 用于验证本次行为的输入文本。
    const source = '```json\n{"a":1}\n```\n```js\n{"b":1}\n```\n```\n{"c":1}\n```\n';
    // 本次操作所属的编辑器或验收实例。
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: source, extensions: [editorButtons((_, from) => clicked.push(from))]})});
    views.push(view);
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(2);
    document.querySelector<HTMLButtonElement>('.loose-json-format-button')?.click();
    expect(clicked).toEqual([0]);
    view.dispatch({changes: {from: 0, insert: '标题\n'}});
    document.querySelector<HTMLButtonElement>('.loose-json-format-button')?.click();
    expect(clicked).toEqual([0, 3]);
  });
  it('未声明语言按钮默认展示，关闭后只保留 json，重新开启即时恢复', () => {
    // 独立重配语言范围，保留已有文档和按钮总开关。
    const configuration = new Compartment();
    // JSON、未声明语言及其他语言用于验证按钮的可见范围。
    const source = '```json\n{"a":1}\n```\n```\n{"b":2}\n```\n```js\n{"c":3}\n```';
    // 用户实际点击的源代码块位置。
    const clicked: number[] = [];
    // 使用默认 facet 验证旧配置也继续展示未声明语言按钮。
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: source, extensions: [configuration.of([]), editorButtons((_, from) => clicked.push(from))]})});
    views.push(view);
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(2);
    view.dispatch({effects: configuration.reconfigure(unlabelledButtonsEnabled.of(false))});
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.loose-json-format-button')?.click();
    expect(clicked).toEqual([0]);
    view.dispatch({effects: configuration.reconfigure(unlabelledButtonsEnabled.of(true))});
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(2);
    expect(view.state.doc.toString()).toBe(source);
  });
  it('动态设置移除并恢复按钮，编辑器销毁时注销引用', () => {
    // 重配 facet 不销毁原有文档与选区。
    const configuration = new Compartment();
    // 编辑器创建与销毁的验收记录。
    const lifecycle: boolean[] = [];
    // 本次操作所属的编辑器或验收实例。
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: '~~~json\n{"a":1}\n~~~', extensions: [configuration.of(buttonsEnabled.of(true)), editorButtons(() => undefined, (_, mounted) => lifecycle.push(mounted))]})});
    expect(lifecycle).toEqual([true]);
    view.dispatch({effects: configuration.reconfigure(buttonsEnabled.of(false))});
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(0);
    view.dispatch({effects: configuration.reconfigure(buttonsEnabled.of(true))});
    expect(document.querySelectorAll('.loose-json-format-button')).toHaveLength(1);
    view.destroy();
    expect(lifecycle).toEqual([true, false]);
  });
});

/** 模拟 CBC 的独立标题及共享分组标题，使用真实 CodeMirror 位置映射 */
class CbcHeaderWidget extends WidgetType {
  /** 区分独立源块标题和无法唯一绑定的分组标题 */
  constructor(private grouped: boolean) {super();}
  /** 由宿主编辑器创建自己的标题，不由 Loose JSON 搬动 */
  toDOM(view: EditorView): HTMLElement {
    // 标题包含 CBC 自己的工具栏及可选共享标签页。
    const header = view.dom.ownerDocument.createElement('div');
    header.className = 'codeblock-customizer-header-container-specific';
    header.innerHTML = (this.grouped ? '<div class="codeblock-customizer-header-group-tabs"></div>' : '') + '<div class="codeblock-customizer-header-button-container"><span>JSON</span></div>';
    return header;
  }
}

describe('CBC 源块匹配边界', () => {
  it('独立标题绑定真实源位置，共享分组标题不推断当前标签所属块', async () => {
    // 记录点击入口绑定的源块位置。
    const clicked: number[] = [];
    // 两个不同代码块中的标题位置。
    const source = '```json\n{"a":1}\n```\n\n```json\n{"b":2}\n```';
    // 第二块的源位置用于确认不会接管共享标题。
    const second = source.indexOf('```json', 1);
    // 模拟 CBC 的真实 widget 装饰，posAtDOM 由 CodeMirror 计算。
    const headers = EditorView.decorations.of(Decoration.set([
      Decoration.widget({widget: new CbcHeaderWidget(false), side: -1}).range(0),
      Decoration.widget({widget: new CbcHeaderWidget(true), side: -1}).range(second)
    ]));
    // 同一个编辑器同时加载两方扩展。
    const view = new EditorView({parent: document.body, state: EditorState.create({doc: source, extensions: [headers, editorButtons((_, from) => clicked.push(from))]})});
    views.push(view);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(document.querySelectorAll('.loose-json-toolbar-action')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('.loose-json-toolbar-action')?.click();
    expect(clicked).toEqual([0]);
    expect(document.querySelectorAll('.loose-json-editor-action:not(.loose-json-cbc-adapted)')).toHaveLength(1);
    expect(document.querySelector('.codeblock-customizer-header-group-tabs + div .loose-json-toolbar-action')).toBeNull();
  });
});
