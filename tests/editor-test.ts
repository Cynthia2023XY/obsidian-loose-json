// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {Compartment, EditorState} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {buttonsEnabled, editorButtons} from '../src/editor-buttons';

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
