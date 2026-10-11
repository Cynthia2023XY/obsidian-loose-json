import {App, Modal, Notice} from 'obsidian';
import type {Change, Plan} from './core/engine';
import type {LiteralResult} from './jobs';

/** 处理期间允许关闭窗口取消线程，不留后台任务 */
export class ProgressModal extends Modal {
  /** 取消当前后台处理的回调 */
  cancelJob: () => void = () => undefined;
  /** 标记计算是否完成，避免关闭成功窗口触发取消 */
  completed = false;
  /** 显示操作进度与取消入口 */
  onOpen(): void {
    this.titleEl.setText('Loose JSON');
    this.contentEl.createEl('p', {text: '正在本地处理…'});
    this.contentEl.createEl('button', {text: '取消'}).addEventListener('click', () => this.close());
  }
  /** 用户关闭窗口时终止工作线程 */
  onClose(): void {if (!this.completed) this.cancelJob(); this.contentEl.empty();}
}

/** 展示可勾选的文本修改，不自动应用数据转换 */
export class ChangesModal extends Modal {
  /** 当前预览的修改与诊断 */
  private plan: Plan;
  /** 用户选择后应用到原文的操作 */
  private apply: (changes: Change[]) => void;
  /** 创建候选预览窗口 */
  constructor(app: App, plan: Plan, apply: (changes: Change[]) => void) {super(app); this.plan = plan; this.apply = apply;}
  /** 展示原文与结果，仅渲染文本，不解释用户 HTML */
  onOpen(): void {
    this.titleEl.setText('Loose JSON · 修改预览');
    this.modalEl.addClass('loose-json-modal');
    this.contentEl.createEl('p', {text: `${this.plan.changes.length} 项修改；${this.plan.skipped.length} 项跳过。默认全部选中；每次展示 50 项，可继续加载并取消单项。`});
    // 候选按源位置绑定，不依赖重复字段的名称。
    const choices: {change: Change; input: HTMLInputElement}[] = [];
    // 未加载的候选也保留显式选择状态，避免大量 DOM 同时挂载。
    const chosen = new Set(this.plan.changes);
    // 已展示候选的数量。
    let shown = 0;
    // 批量候选的滚动展示容器。
    const cards = this.contentEl.createDiv();
    // 仅在存在下一页时显示继续加载操作。
    const more = this.contentEl.createEl('button', {text: '再显示 50 项'});
    // 每次增加有限数量的候选，保持大文档预览响应。
    const render = (): void => {
      // 本批次展示的截止位置。
      const until = Math.min(shown + 50, this.plan.changes.length);
      for (; shown < until; shown++) {
        // 当前候选在原文中的确定范围。
        const change = this.plan.changes[shown];
        // 当前候选的预览容器。
        const card = cards.createDiv({cls: 'loose-json-change'});
        // 候选路径及选择控件的可访问标签。
        const label = card.createEl('label');
        // 当前候选的选择状态，与延迟渲染无关。
        const input = label.createEl('input', {type: 'checkbox'});
        input.checked = chosen.has(change);
        input.addEventListener('change', () => {if (input.checked) chosen.add(change); else chosen.delete(change);});
        label.appendText(' ' + change.label);
        choices.push({change, input});
        if (change.warning) card.createEl('p', {text: change.warning, cls: 'loose-json-warning'});
        // 修改前后文本的并排预览容器。
        const comparison = card.createDiv({cls: 'loose-json-comparison'});
        comparison.createEl('pre', {text: change.before, attr: {'aria-label': '修改前'}});
        comparison.createEl('pre', {text: change.after, attr: {'aria-label': '修改后'}});
      }
      more.hidden = shown >= this.plan.changes.length;
    };
    more.addEventListener('click', render);
    render();
    if (this.plan.skipped.length) this.contentEl.createEl('pre', {text: this.plan.skipped.join('\n')});
    // 预览底部的应用与取消操作区。
    const actions = this.contentEl.createDiv({cls: 'loose-json-actions'});
    actions.createEl('button', {text: '全选'}).addEventListener('click', () => {this.plan.changes.forEach(change => chosen.add(change)); choices.forEach(choice => choice.input.checked = true);});
    actions.createEl('button', {text: '全不选'}).addEventListener('click', () => {chosen.clear(); choices.forEach(choice => choice.input.checked = false);});
    actions.createEl('button', {text: '取消'}).addEventListener('click', () => this.close());
    // 仅在存在可选修改时启用的应用按钮。
    const applyButton = actions.createEl('button', {text: '应用选中修改', cls: 'mod-cta'});
    applyButton.disabled = !this.plan.changes.length;
    applyButton.addEventListener('click', () => {
      // 用户本次明确勾选的修改候选。
      const selected = this.plan.changes.filter(change => chosen.has(change));
      if (!selected.length) {new Notice('请选择至少一项修改'); return;}
      try {this.apply(selected); this.close();} catch (error) {new Notice(error instanceof Error ? error.message : String(error));}
    });
  }
  /** 销毁预览 DOM 和事件绑定 */
  onClose(): void {this.contentEl.empty();}
}

/** JS 转换结果仅供预览复制，不改原文 */
export class LiteralModal extends Modal {
  /** 保留数据值的字面量与求值提醒 */
  private result: LiteralResult;
  /** 创建复制窗口 */
  constructor(app: App, result: LiteralResult) {super(app); this.result = result;}
  /** 复制仅由用户点击触发，不读取系统剪贴板 */
  onOpen(): void {
    this.titleEl.setText('Loose JSON · JavaScript 对象字面量');
    this.modalEl.addClass('loose-json-modal');
    this.contentEl.createEl('p', {text: '粘贴到 JS/TS 表达式位置；原笔记保持不变。'});
    this.result.warnings.forEach(message => this.contentEl.createEl('p', {text: message, cls: 'loose-json-warning'}));
    this.contentEl.createEl('pre', {text: this.result.text});
    this.contentEl.createEl('button', {text: '复制 JS 字面量', cls: 'mod-cta'}).addEventListener('click', () => {
      void navigator.clipboard.writeText(this.result.text).then(() => new Notice('JS 字面量已复制'), () => new Notice('复制失败，请手动选择结果文本'));
    });
  }
  /** 移除窗口中的文本 */
  onClose(): void {this.contentEl.empty();}
}
