import {translator, describe, errorDiagnostic, type Translator} from './i18n';
import {fencedLog, generatedBlocks} from './core/markdown';
import type {Conversion, Output} from './core/conversion';
import {App, Modal, Notice} from 'obsidian';
import type {Change, Plan} from './core/engine';

/** 处理期间允许关闭窗口取消线程，不留后台任务 */
export class ProgressModal extends Modal {
  /** 当前窗口使用的界面语言 */
  constructor(app: App, private t: Translator = translator('zh')) {super(app);}
  /** 取消当前后台处理的回调 */
  cancelJob: () => void = () => undefined;
  /** 标记计算是否完成，避免关闭成功窗口触发取消 */
  completed = false;
  /** 显示操作进度与取消入口 */
  onOpen(): void {
    this.titleEl.setText('Loose JSON');
    this.contentEl.createEl('p', {text: this.t('processing')});
    this.contentEl.createEl('button', {text: this.t('cancel')}).addEventListener('click', () => this.close());
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
  constructor(app: App, plan: Plan, apply: (changes: Change[]) => void, private t: Translator = translator('zh'), private document = false, private settings?: () => void, private file?: string) {super(app); this.plan = plan; this.apply = apply;}
  /** 展示原文与结果，仅渲染文本，不解释用户 HTML */
  onOpen(): void {
    this.titleEl.setText(this.t('preview'));
    if (this.file) this.contentEl.createEl('p', {text: this.t('file', {name: this.file})});
    if (this.document) {
      this.contentEl.createEl('p', {text: this.t('documentWarning'), cls: 'loose-json-warning'});
      this.contentEl.createEl('button', {text: this.t('previewSettings')}).addEventListener('click', () => this.settings?.());
    }
    this.modalEl.addClass('loose-json-modal');
    this.contentEl.createEl('p', {text: this.t('previewCount', {changes: this.plan.changes.length, skipped: this.plan.skipped.length})});
    // 候选按源位置绑定，不依赖重复字段的名称。
    const choices: {change: Change; input: HTMLInputElement}[] = [];
    // 未加载的候选也保留显式选择状态，避免大量 DOM 同时挂载。
    const chosen = new Set(this.plan.changes);
    // 已展示候选的数量。
    let shown = 0;
    // 批量候选的滚动展示容器。
    const cards = this.contentEl.createDiv();
    // 仅在存在下一页时显示继续加载操作。
    const more = this.contentEl.createEl('button', {text: this.t('more')});
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
        label.appendText(' ' + (change.location ? describe(change.location, this.t) : change.label));
        choices.push({change, input});
        if (change.warning) card.createEl('p', {text: change.warningCode ? describe(change.warningCode, this.t) : change.warning, cls: 'loose-json-warning'});
        // 修改前后文本的并排预览容器。
        const comparison = card.createDiv({cls: 'loose-json-comparison'});
        comparison.createEl('pre', {text: change.before, attr: {'aria-label': this.t('before')}});
        comparison.createEl('pre', {text: change.after, attr: {'aria-label': this.t('after')}});
      }
      more.hidden = shown >= this.plan.changes.length;
    };
    more.addEventListener('click', render);
    render();
    if (this.plan.skipped.length) this.contentEl.createEl('pre', {text: this.plan.skipped.map(item => describe(item, this.t)).join('\n')});
    // 预览底部的应用与取消操作区。
    const actions = this.contentEl.createDiv({cls: 'loose-json-actions'});
    actions.createEl('button', {text: this.t('selectAll')}).addEventListener('click', () => {this.plan.changes.forEach(change => chosen.add(change)); choices.forEach(choice => choice.input.checked = true);});
    actions.createEl('button', {text: this.t('selectNone')}).addEventListener('click', () => {chosen.clear(); choices.forEach(choice => choice.input.checked = false);});
    actions.createEl('button', {text: this.t('cancel')}).addEventListener('click', () => this.close());
    // 仅在存在可选修改时启用的应用按钮。
    const applyButton = actions.createEl('button', {text: this.t('apply'), cls: 'mod-cta'});
    applyButton.disabled = !this.plan.changes.length;
    applyButton.addEventListener('click', () => {
      // 用户本次明确勾选的修改候选。
      const selected = this.plan.changes.filter(change => chosen.has(change));
      if (!selected.length) {new Notice(this.t('selectRequired')); return;}
      try {this.apply(selected); this.close();} catch (error) {new Notice(describe(errorDiagnostic(error), this.t));}
    });
  }
  /** 销毁预览 DOM 和事件绑定 */
  onClose(): void {this.contentEl.empty();}
}

/** 无修改或关闭预览时仍可查看独立诊断 */
export class DiagnosticModal extends Modal {
  /** 诊断文本是本地生成的普通文本 */
  constructor(app: App, private text: string, private t: Translator) {super(app);}
  /** 不提供无意义的应用按钮 */
  onOpen(): void {this.titleEl.setText(this.t('details')); this.contentEl.createEl('pre', {text: this.text});}
  /** 关闭时释放源文本 */
  onClose(): void {this.contentEl.empty();}
}

/** 转换结果必须明确选择候选与写入方式，默认保留原文 */
export class ConversionModal extends Modal {
  /** 保留完整来源用于审查替换时舍弃的外围信息 */
  constructor(app: App, private result: Conversion, private mode: 'javascript' | 'repair' | 'extract', private source: string, private t: Translator, private write: (outputs: Output[], replace: boolean) => void, private validate: () => void) {super(app);}
  /** 纯文本预览不会解释日志中的 HTML */
  onOpen(): void {
    this.titleEl.setText(this.t(this.mode === 'javascript' ? 'jsTitle' : this.mode === 'repair' ? 'repairTitle' : 'extractTitle'));
    this.modalEl.addClass('loose-json-modal');
    this.contentEl.createEl('p', {text: this.t(this.mode === 'javascript' ? 'jsHint' : this.mode === 'extract' ? 'extractHint' : 'conversionHint')});
    // 结果候选保留顺序，不默认合并日志记录。
    const selected = new Set(this.mode === 'javascript' ? [] : this.result.candidates);
    // 可展开查看完整日志结果，候选勾选变化时同步刷新。
    const complete = this.mode === 'extract' ? this.contentEl.createEl('details') : undefined;
    complete?.createEl('summary', {text: this.t('extractPreview')});
    // 日志完整结果始终使用纯文本展示，避免解释用户日志中的 HTML。
    const completePreview = complete?.createEl('pre');
    // 完整结果与实际应用使用同一范围拼接函数。
    const refreshComplete = (): void => {completePreview?.setText(fencedLog(this.source, this.result.candidates.filter(item => selected.has(item)), this.source.includes('\r\n') ? '\r\n' : '\n'));};
    refreshComplete();
    // 候选和当前输出形态的关联。
    const outputs = new Map<Output, string>();
    // 每批只挂载五十个候选，避免大日志创建过量预览 DOM。
    let shown = 0;
    // 按需加载下一批候选的入口。
    const more = this.contentEl.createEl('button', {text: this.t('more')});
    // 候选预览的批量展示区域。
    const cards = this.contentEl.createDiv();
    // 保留本次处理状态，供后续生成或校验使用。
    const render = (): void => {
      // 绝对候选序号在分页后保持稳定。
      const until = Math.min(shown + 50, this.result.candidates.length);
      this.result.candidates.slice(shown, until).forEach((item, localIndex) => {
        // 展示序号与来源顺序对应。
        const index = shown + localIndex;
        // 候选展示名称保留原始变量标签。
        const card = cards.createDiv({cls: 'loose-json-change'});
        // 保留业务标签用于识别入参或出参。
        const label = card.createEl('label', {text: (item.label || this.t('fragment', {index: index + 1})) + ' · ' + this.t('location.offset', {offset: item.from + 1})});
        // 当前候选的选择控件。
        const input = label.createEl('input', {type: this.mode === 'javascript' ? 'radio' : 'checkbox'});
        input.name = 'loose-json-candidate-' + this.mode; input.checked = selected.has(item);
        input.addEventListener('change', () => {if (this.mode === 'javascript') selected.clear(); if (input.checked) selected.add(item); else selected.delete(item); refreshComplete();});
        item.warnings.forEach(warning => card.createEl('p', {text: describe(warning, this.t), cls: 'loose-json-warning'}));
        // 展示可复制生成结果的普通文本容器。
        const preview = card.createEl('pre', {text: item.text});
        outputs.set(item, item.text);
        if (this.mode === 'javascript') {
          // 用户可选择对象包装或保留原属性上下文。
          const shape = card.createEl('select', {attr: {'aria-label': this.t('shape.auto')}});
          ['auto', 'object', ...(item.properties === undefined ? [] : ['properties'])].forEach(value => shape.createEl('option', {text: this.t('shape.' + value), value}));
          shape.addEventListener('change', () => {const text = shape.value === 'object' ? item.object : shape.value === 'properties' ? item.properties! : item.text; outputs.set(item, text); preview.setText(text);});
        } else card.createEl('pre', {text: item.source, attr: {'aria-label': this.t('before')}});
      });
      shown = until;
      more.hidden = shown >= this.result.candidates.length;
    };
    more.addEventListener('click', render);
    render();
    if (this.result.candidates.length === 1 && this.mode === 'javascript') {
      selected.add(this.result.candidates[0]);
      this.contentEl.querySelector<HTMLInputElement>('input')!.checked = true;
    }
    this.result.diagnostics.forEach(item => this.contentEl.createEl('p', {text: describe(item, this.t)}));
    if (this.mode !== 'javascript') {
      // 原始目标可展开检查，避免只显示提取后的对象而隐藏日志丢失。
      const original = this.contentEl.createEl('details');
      original.createEl('summary', {text: this.t('original')}); original.createEl('pre', {text: this.source});
    }
    // 执行时再次核验完整快照，复制也不得使用过期结果。
    const choose = (): Output[] => {
      this.validate();
      // 用户明确选中且通过快照校验的结果。
      const items = this.result.candidates.filter(item => selected.has(item)).map(item => ({...item, text: outputs.get(item) ?? item.text}));
      if (!items.length) {new Notice(this.t('selectRequired')); return [];}
      return items;
    };
    // 统一绑定用户明确触发的操作。
    const action = (key: string, execute: () => void): void => {this.contentEl.createEl('button', {text: this.t(key)}).addEventListener('click', () => {try {execute();} catch (error) {new Notice(describe(errorDiagnostic(error), this.t));}});};
    action('copy', () => {const items = choose(); if (!items.length) return; void navigator.clipboard.writeText(this.mode === 'extract' ? fencedLog(this.source, items, this.source.includes('\r\n') ? '\r\n' : '\n') : items.length === 1 ? items[0].text : generatedBlocks(items.map(item => ({text: item.text, label: item.label})))).then(() => new Notice(this.t('copied')), () => new Notice(this.t('copyFailed')));});
    if (this.mode === 'extract') {
      action('apply', () => {const items = choose(); if (items.length) {this.write(items, true); this.close();}});
    } else if (this.mode !== 'javascript') {
      action('insert', () => {const items = choose(); if (items.length) {this.write(items, false); this.close();}});
      action('replace', () => {const items = choose(); if (items.length) {this.write(items, true); this.close();}});
    }
    action('cancel', () => this.close());
  }
  /** 移除日志和接口内容的预览 DOM */
  onClose(): void {this.contentEl.empty();}
}
