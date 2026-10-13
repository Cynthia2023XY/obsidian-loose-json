// @vitest-environment jsdom
import {afterEach, describe, expect, it} from 'vitest';
import {CodeblockToolbar, type ToolbarAction} from '../src/codeblock-toolbar';

/** 测试后释放观察器，验证卸载不会留下可点击入口 */
const adapters: CodeblockToolbar[] = [];
afterEach(() => {adapters.splice(0).forEach(adapter => adapter.destroy()); document.body.replaceChildren();});

/** 等待实际观察器和动画帧完成兼容更新 */
async function rendered(): Promise<void> {await new Promise(resolve => setTimeout(resolve, 50));}

describe('CBC 工具栏兼容生命周期', () => {
  it('保留宿主复制入口，动态重绑操作并恢复原生按钮', async () => {
    // 当前笔记的渲染区域和原生入口。
    const root = document.createElement('div');
    // 宿主已有的复制按钮不能被清除或搬动。
    const target = document.createElement('div');
    // 兼容入口就绪前仍然使用原生按钮。
    const anchor = document.createElement('button');
    // 用户点击记录必须跟随最新绑定而非旧闭包。
    const clicks: number[] = [];
    target.innerHTML = '<span data-test="copy">JSON</span>';
    root.append(anchor, target); document.body.append(root);
    // 工具栏对应的源位置发生变化，模拟输入导致偏移变化。
    let position = 0;
    // 设置关闭时移除兼容按钮并恢复原生入口。
    let enabled = true;
    // 仅作用于本区域的工具栏生命周期。
    const adapter = new CodeblockToolbar(root, () => enabled ? [{anchor, targets: [target], label: '格式化', title: '格式化 JSON', run: () => {clicks.push(position);}}] : []);
    adapters.push(adapter);
    await rendered();
    expect(anchor.classList.contains('loose-json-cbc-adapted')).toBe(true);
    expect(target.querySelector('[data-test="copy"]')?.textContent).toBe('JSON');
    target.querySelector<HTMLButtonElement>('button')?.click();
    position = 4; adapter.schedule(); await rendered();
    target.querySelector<HTMLButtonElement>('button')?.click();
    expect(clicks).toEqual([0, 4]);
    expect(target.querySelectorAll('button')).toHaveLength(1);
    enabled = false; adapter.schedule(); await rendered();
    expect(target.querySelector('button')).toBeNull();
    expect(anchor.classList.contains('loose-json-cbc-adapted')).toBe(false);
    expect(target.querySelector('[data-test="copy"]')).not.toBeNull();
  });

  it('第三方清空、重建工具栏后自动恢复，重复更新不重复注册', async () => {
    // 当前阅读区域，CBC 可在后处理或折叠时重建内部节点。
    const root = document.createElement('pre');
    // 原生按钮不会被兼容适配器搬动。
    const anchor = document.createElement('button');
    // CBC 工具栏可能晚于 Loose JSON 出现。
    let target: HTMLElement | undefined;
    // 本次动作只应触发一次。
    let clicks = 0;
    root.append(anchor); document.body.append(root);
    // 构建当前存在的兼容动作。
    const actions = (): ToolbarAction[] => [{anchor, targets: target ? [target] : [], label: '格式化', title: '格式化 JSON', run: () => {clicks++;}}];
    // 针对单块区域的生命周期。
    const adapter = new CodeblockToolbar(root, actions); adapters.push(adapter);
    await rendered();
    expect(anchor.classList.contains('loose-json-cbc-adapted')).toBe(false);
    target = document.createElement('div'); root.append(target); await rendered();
    expect(target.querySelectorAll('button')).toHaveLength(1);
    target.replaceChildren(); await rendered();
    expect(target.querySelectorAll('button')).toHaveLength(1);
    target.remove(); target = document.createElement('div'); root.append(target); await rendered();
    target.querySelector<HTMLButtonElement>('button')?.click();
    expect(clicks).toBe(1);
    expect(anchor.parentElement).toBe(root);
    adapter.destroy(); await rendered();
    expect(target.querySelector('button')).toBeNull();
    expect(anchor.classList.contains('loose-json-cbc-adapted')).toBe(false);
  });

  it('折叠时原生入口缺席仍可绑定独立标题，卸载后不重新创建', async () => {
    // 折叠后只保留宿主标题工具栏。
    const root = document.createElement('div');
    // 标题栏里的原生复制入口。
    const target = document.createElement('div');
    root.append(target); document.body.append(root);
    // 用户操作记录用于确认标题工具栏仍能格式化源块。
    let clicks = 0;
    // 没有原生 anchor 也可以为可靠绑定的标题创建入口。
    const adapter = new CodeblockToolbar(root, () => [{targets: [target], label: '格式化', title: '格式化 JSON', run: () => {clicks++;}}]);
    adapters.push(adapter); await rendered();
    // 卸载后即使宿主保留旧按钮引用，也不能再触发格式化。
    const button = target.querySelector<HTMLButtonElement>('button');
    button?.click();
    expect(clicks).toBe(1);
    adapter.destroy(); button?.click();
    expect(clicks).toBe(1);
    target.append(document.createElement('span')); await rendered();
    expect(target.querySelector('button')).toBeNull();
  });
});
