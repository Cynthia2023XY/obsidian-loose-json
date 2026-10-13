import {DataError, describe, errorDiagnostic, resolveLocale, translator, type Language, type Translator} from './i18n';
import type {Conversion, Output} from './core/conversion';
import {Compartment} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import {getLanguage, Editor, MarkdownRenderChild, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type MarkdownPostProcessorContext} from 'obsidian';
import {applyChanges, DEFAULT_OPTIONS, type Change, type Options, type Plan} from './core/engine';
import {blockBody, codeBlocks, generatedBlocks, type CodeBlock} from './core/markdown';
import {buttonsEnabled, buttonLabels, editorButtons} from './editor-buttons';
import {CBC_SHARED_HEADERS, CBC_TOOLBARS, CodeblockToolbar} from './codeblock-toolbar';
import {startJob, type Operation} from './jobs';
import {ChangesModal, ConversionModal, DiagnosticModal, ProgressModal} from './modals';

/** 持久化设置，只影响用户显式操作 */
interface Settings {indent: '2' | '4' | 'tab'; buttons: boolean; compactArrays: boolean; allowInnerJson5: boolean; maxMiB: number; language: Language; previewDocument: boolean; previewDecode: boolean; previewJs: boolean}
/** 插件初始设置 */
const DEFAULT_SETTINGS: Settings = {indent: '2', buttons: true, compactArrays: false, allowInnerJson5: false, maxMiB: 1, language: 'system', previewDocument: true, previewDecode: true, previewJs: true};
/** 命令定位结果，保留完整快照以防预览后内容变更 */
interface Target {snapshot: string; from: number; to: number; content: string; block?: CodeBlock; parentBlock?: CodeBlock}
/** 可复用于旧版设置页与新版设置搜索的声明式展示定义 */
interface SettingRow {name: string; desc?: string; render: (setting: Setting) => void}

/** 独立开发的离线 JSON 工具，不注册自定义 json 渲染器 */
export default class LooseJsonPlugin extends Plugin {
  /** 当前用户设置 */
  settings: Settings = {...DEFAULT_SETTINGS};
  /** 设置可动态更新的编辑器装饰配置 */
  private buttonCompartment = new Compartment();
  /** 已挂载的编辑器，用于设置变更时更新装饰 */
  private editorViews = new Set<EditorView>();
  /** 所有阅读窗口的按钮，设置变更与卸载时统一释放 */
  private readingActions = new Set<HTMLElement>();
  /** 阅读视图工具栏适配器，设置刷新与卸载时同步释放 */
  private readingToolbars = new Set<CodeblockToolbar>();
  /** 卸载插件时终止未完成工作 */
  private cancellations = new Set<() => void>();
  /** 插件卸载时关闭预览，避免旧操作继续修改笔记 */
  private modals = new Set<Modal>();

  /** 最近处理的本地诊断，不写入配置文件 */
  private lastDetails = '';
  /** 当前宿主与用户设置共同决定的界面语言 */
  t: Translator = translator('zh');

  /** 初始化设置、命令及两种渲染模式的按钮 */
  async onload(): Promise<void> {
    // 只恢复合法设置，历史或手工修改的配置不能绕过处理上限。
    const stored = await this.loadData() as Partial<Settings> | null;
    if (stored) {
      this.settings = {...DEFAULT_SETTINGS, ...stored};
      if (!['2', '4', 'tab'].includes(this.settings.indent)) this.settings.indent = '2';
      this.settings.maxMiB = Math.max(0.1, Math.min(10, Number(this.settings.maxMiB) || 1));
    }
    if (!['system', 'zh', 'en'].includes(this.settings.language)) this.settings.language = 'system';
    this.t = translator(resolveLocale(this.settings.language, getLanguage()));
    this.addSettingTab(new LooseJsonSettings(this));
    this.registerEditorExtension([
      this.buttonCompartment.of([buttonsEnabled.of(this.settings.buttons), buttonLabels.of([this.t('button.format'), this.t('button.title')])]),
      editorButtons((view, from) => {void this.formatEditorBlock(view, from);}, (view, mounted) => {if (mounted) this.editorViews.add(view); else this.editorViews.delete(view);})
    ]);
    this.registerMarkdownPostProcessor((element, context) => this.readingButtons(element, context));
    this.addCommand({id: 'format-block', name: this.t('commands.block'), editorCallback: editor => {void this.runEditor(editor, 'fragment');}});
    this.addCommand({id: 'format-document', name: this.t('commands.document'), editorCallback: editor => {void this.runEditor(editor, 'document');}});
    this.addCommand({id: 'copy-javascript', name: this.t('commands.javascript'), editorCallback: editor => {void this.runEditor(editor, 'javascript');}});
    this.addCommand({id: 'repair-json', name: this.t('commands.repair'), editorCallback: editor => {void this.runEditor(editor, 'repair');}});
    this.addCommand({id: 'extract-json', name: this.t('commands.extract'), editorCallback: editor => {void this.runEditor(editor, 'extract');}});
    this.addCommand({id: 'view-diagnostics', name: this.t('commands.details'), callback: () => this.openModal(new DiagnosticModal(this.app, this.lastDetails || this.t('none'), this.t))});
    this.addCommand({id: 'decode-fields', name: this.t('commands.decode'), editorCallback: editor => {void this.runEditor(editor, 'decode');}});
  }

  /** 停止后台处理，释放编辑器引用 */
  onunload(): void {
    this.modals.forEach(modal => modal.close()); this.modals.clear();
    this.cancellations.forEach(cancel => cancel()); this.cancellations.clear(); this.editorViews.clear();
    this.readingToolbars.forEach(toolbar => toolbar.destroy()); this.readingToolbars.clear();
    this.readingActions.forEach(button => {button.parentElement?.removeClass('loose-json-code-block'); button.remove();});
    this.readingActions.clear();
  }

  /** 预览关闭后释放引用，卸载时所有窗口均可统一清理 */
  private openModal(modal: Modal): void {
    // 保留窗口本身的关闭处理，同时注销插件的窗口引用。
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {close(); this.modals.delete(modal);};
    this.modals.add(modal);
    modal.open();
  }

  /** 将保存设置映射到纯文本引擎参数 */
  options(): Options {
    return {...DEFAULT_OPTIONS, indent: this.settings.indent === 'tab' ? '\t' : ' '.repeat(Number(this.settings.indent)), compactArrays: this.settings.compactArrays, allowInnerJson5: this.settings.allowInnerJson5, maxBytes: this.settings.maxMiB * 1024 * 1024};
  }

  /** 保存设置并刷新现有窗口中的按钮 */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.t = translator(resolveLocale(this.settings.language, getLanguage()));
    // 当前打开的宿主编辑器允许公开 API 重配注册的扩展。
    this.editorViews.forEach(view => {
      if (!view.dom.isConnected) {this.editorViews.delete(view); return;}
      view.dispatch({effects: this.buttonCompartment.reconfigure([buttonsEnabled.of(this.settings.buttons), buttonLabels.of([this.t('button.format'), this.t('button.title')])])});
    });
    this.readingToolbars.forEach(toolbar => toolbar.schedule());
    this.readingActions.forEach(button => {button.hidden = !this.settings.buttons; button.setText(this.t('button.format')); button.setAttribute('aria-label', this.t('button.title'));});
  }

  /** 运行可取消任务，避免处理时阻塞编辑窗口 */
  private async compute<T = Plan>(operation: Operation, source: string, loose = false): Promise<T> {
    // 每次操作独立快照和工作线程，预览不自动落盘。
    const progress = new ProgressModal(this.app, this.t);
    // 本次后台计算及其取消能力。
    const job = startJob<T>({operation, source, options: this.options(), loose});
    this.cancellations.add(job.cancel);
    progress.cancelJob = job.cancel;
    this.openModal(progress);
    try {return await job.result;} finally {this.cancellations.delete(job.cancel); progress.completed = true; progress.close();}
  }

  /** 优先选区，随后定位光标所在代码块，不猜测整个文档 */
  private target(editor: Editor): Target {
    // 选区和代码块均以原始文档的偏移计算。
    const snapshot = editor.getValue();
    // 用户明确选中的源文本。
    const selection = editor.getSelection();
    if (selection) {
      // 当前目标在源文本中的起点。
      const from = editor.posToOffset(editor.getCursor('from'));
      // 当前目标在源文本中的终点。
      const to = editor.posToOffset(editor.getCursor('to'));
      if (codeBlocks(snapshot).some(block => from < block.bodyFrom && to > block.bodyFrom || from < block.bodyTo && to > block.bodyTo)) throw new DataError('error.fence');
      return {snapshot, from, to, content: selection, parentBlock: codeBlocks(snapshot).find(block => from >= block.bodyFrom && to <= block.bodyTo)};
    }
    // 下一待处理词法单元的位置。
    const cursor = editor.posToOffset(editor.getCursor());
    // 当前操作所属的真实代码块。
    const block = codeBlocks(snapshot).find(item => cursor >= item.from && (cursor < item.to || cursor === snapshot.length && item.to === snapshot.length));
    if (!block || !['json', ''].includes(block.language)) throw new DataError('error.target');
    if (!block.supported) throw new DataError('error.container');
    return {snapshot, from: block.bodyFrom, to: block.bodyTo, content: block.content, block};
  }

  /** 合并所选修改为完整目标，并恢复代码块容器缩进 */
  private targetChange(target: Target, changes: Change[]): Change {
    // 先在裸内容中应用，再映射到源代码块，不用 DOM 文本回写。
    const converted = applyChanges(target.content, changes);
    return {from: target.from, to: target.to, before: target.snapshot.slice(target.from, target.to), after: target.block ? blockBody(target.block, converted) : converted, label: '当前目标'};
  }

  /** 使用一个宿主编辑器事务应用修改，支持单次撤销 */
  private applyEditor(editor: Editor, snapshot: string, changes: Change[]): void {
    if (editor.getValue() !== snapshot) throw new DataError('error.stale');
    applyChanges(snapshot, changes);
    editor.transaction({changes: changes.map(change => ({from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.after}))});
    new Notice(this.t('applied', {count: changes.length}));
  }

  /** 执行格式化、转换与生成命令，配置只关闭普通修改预览 */
  private async runEditor(editor: Editor, operation: Operation): Promise<void> {
    try {
      if (operation === 'document') {
        // 完整快照防止异步结果覆盖新输入。
        const snapshot = editor.getValue();
        // 当前来源的修改范围与跳过诊断。
        const plan = await this.compute('document', snapshot);
        this.handlePlan(plan, changes => this.applyEditor(editor, snapshot, changes), this.settings.previewDocument, true);
        return;
      }
      // 保留来源与父代码块，生成多个围栏时放到原块外。
      const target = this.target(editor);
      if (operation === 'javascript' || operation === 'repair' || operation === 'extract') {
        // 生成候选和诊断独立于文本是否已有正确排版。
        const result = await this.compute<Conversion>(operation, target.content);
        // 应用或复制前检查来源快照。
        const validate = (): void => {if (editor.getValue() !== target.snapshot) throw new DataError('error.stale');};
        this.lastDetails = result.diagnostics.map(item => describe(item, this.t)).join('\n');
        if (!result.candidates.length) {this.openModal(new DiagnosticModal(this.app, this.lastDetails || this.t('error.noCandidate'), this.t)); return;}
        if (operation === 'javascript' && !this.settings.previewJs && result.candidates.length === 1) {
          validate();
          await navigator.clipboard.writeText(result.candidates[0].text);
          this.lastDetails = [...result.diagnostics, ...result.candidates[0].warnings].map(item => describe(item, this.t)).join('\n');
          new Notice(this.t('copied') + (this.lastDetails ? '\n' + this.lastDetails : ''));
          return;
        }
        this.openModal(new ConversionModal(this.app, result, operation, target.content, this.t, (items, replace) => this.writeGenerated(editor, target, items, replace, operation === 'extract'), validate));
        return;
      }
      // 宽松格式化不补数据，字符串解码保持一次转换边界。
      const plan = await this.compute(operation, target.content, operation === 'fragment');
      this.handlePlan(plan, changes => this.applyEditor(editor, target.snapshot, [this.targetChange(target, changes)]), operation === 'decode' ? this.settings.previewDecode : plan.changes.some(change => !!change.warning));
    } catch (error) {new Notice(describe(errorDiagnostic(error), this.t));}
  }

  /** 生成结果默认插入原代码块之后，替换需在独立预览内明确选择 */
  private writeGenerated(editor: Editor, target: Target, items: Output[], replace: boolean, extract: boolean): void {
    // 容器和换行风格沿用来源。
    const parent = target.block ?? target.parentBlock;
    // 沿用来源的换行风格。
    const eol = parent?.eol ?? (target.snapshot.includes('\r\n') ? '\r\n' : '\n');
    // 来源代码块的引用或列表缩进。
    const prefix = parent?.prefix ?? '';
    // 放到原围栏之外的独立结果块。
    const fences = generatedBlocks(items.map((item, index) => ({text: item.text, label: item.role ? this.t(item.role) + ' · ' + item.label : item.label || this.t('fragment', {index: index + 1})})), prefix, eol);
    // 单个修复结果允许替换代码块内容；拆块替换必须包含外层围栏。
    let change: Change;
    if (replace && !extract && items.length === 1) change = this.targetChange(target, [{from: 0, to: target.content.length, before: target.content, after: items[0].text, label: ''}]);
    else if (replace) {
      if (target.parentBlock && !target.block) throw new DataError('error.multiReplace');
      // 候选在来源中的起点，用于准确写回。
      const from = target.block?.from ?? target.from;
      // 本次替换范围的结束位置。
      const to = target.block?.to ?? target.to;
      change = {from, to, before: target.snapshot.slice(from, to), after: (target.block ? fences.replace(prefix, target.snapshot.slice(target.block.from, target.block.bodyFrom).match(/^(.*?)(?:`{3,}|~{3,})/)?.[1] ?? prefix) : fences) + eol, label: ''};
    } else {
      // 所选片段位于代码块时，插入位置越过闭合围栏。
      const end = parent?.to ?? (target.snapshot.indexOf('\n', target.to) < 0 ? target.snapshot.length : target.snapshot.indexOf('\n', target.to) + 1);
      change = {from: end, to: end, before: '', after: eol + fences + eol + eol, label: ''};
    }
    this.applyEditor(editor, target.snapshot, [change]);
  }

  /** 修改预览和诊断分离，关闭预览仍报告处理结果 */
  private handlePlan(plan: Plan, apply: (changes: Change[]) => void, preview: boolean, document = false): void {
    this.lastDetails = [...plan.skipped, ...plan.changes.flatMap(change => change.warningCode ? [change.warningCode] : [])].map(item => describe(item, this.t)).join('\n');
    if (!plan.changes.length) {
      if (plan.skipped.length) this.openModal(new DiagnosticModal(this.app, this.lastDetails, this.t));
      else new Notice(this.t('none'));
      return;
    }
    if (preview) this.openModal(new ChangesModal(this.app, plan, apply, this.t, document, () => this.openModal(new PreviewSettingsModal(this)), this.app.workspace.getActiveFile()?.path));
    else {apply(plan.changes); if (plan.skipped.length) new Notice(this.t('skippedCount', {count: plan.skipped.length}));}
  }

  /** 编辑器按钮只修改所属代码块，结果完成前核验整个快照 */
  private async formatEditorBlock(view: EditorView, from: number): Promise<void> {
    this.editorViews.add(view);
    try {
      // 操作开始时的完整笔记快照。
      const snapshot = view.state.doc.toString();
      // 当前操作所属的真实代码块。
      const block = codeBlocks(snapshot).find(item => item.from === from);
      if (!block?.supported) throw new DataError('error.stale');
      // 按源位置规划的修改候选与跳过原因。
      const plan = await this.compute('fragment', block.content, true);
      // 核验源快照后应用到所属编辑器。
      const apply = (changes: Change[]): void => {
        if (!view.dom.isConnected || view.state.doc.toString() !== snapshot) throw new DataError('error.stale');
        view.dispatch({changes: {from: block.bodyFrom, to: block.bodyTo, insert: blockBody(block, applyChanges(block.content, changes))}, userEvent: 'input'});
      };
      if (plan.skipped.length || plan.changes.some(change => change.warning)) this.handlePlan(plan, apply, plan.changes.some(change => !!change.warning));
      else if (plan.changes.length) apply(plan.changes);
      else new Notice(this.t('none'));
    } catch (error) {new Notice(describe(errorDiagnostic(error), this.t));}
  }

  /** 给原生阅读视图附加按钮，保留高亮和宿主复制功能 */
  private readingButtons(element: HTMLElement, context: MarkdownPostProcessorContext): void {
    // 只在原生代码区域中添加操作，不接管整个阅读视图。
    for (const pre of element.querySelectorAll<HTMLElement>('pre')) {
      // 原生渲染的代码文本节点。
      const code = pre.querySelector('code');
      if (!code || pre.querySelector('.loose-json-reading-action')) continue;
      // 代码块声明的语言，用于限定接管范围。
      const language = [...code.classList].find(name => name.startsWith('language-'))?.slice(9).toLowerCase() ?? '';
      if (!['json', ''].includes(language)) continue;
      // 只操作所属代码块的格式化入口。
      const button = pre.createEl('button', {text: this.t('button.format'), cls: 'loose-json-format-button loose-json-reading-action', attr: {'aria-label': this.t('button.title')}});
      pre.addClass('loose-json-code-block');
      this.readingActions.add(button);
      // 随渲染区生命周期销毁按钮，插件卸载时不留下可点击旧操作。
      const child = new MarkdownRenderChild(pre);
      // 适配器只创建额外工具栏入口，仍委托原按钮按源范围执行操作。
      const toolbar = new CodeblockToolbar(pre, () => [{anchor: button,
        targets: this.settings.buttons && !pre.classList.contains('displayedInGroup') ? Array.from(pre.querySelectorAll<HTMLElement>(CBC_TOOLBARS)).filter(target => !target.closest(CBC_SHARED_HEADERS)) : [],
        label: this.t('button.format'), title: this.t('button.title'), run: () => button.click()}]);
      this.readingToolbars.add(toolbar);
      child.register(() => {toolbar.destroy(); this.readingToolbars.delete(toolbar); button.remove(); pre.removeClass('loose-json-code-block'); this.readingActions.delete(button);});
      context.addChild(child);
      button.hidden = !this.settings.buttons;
      // 宿主提供的代码块所属源章节范围。
      const info = context.getSectionInfo(pre);
      // 用于核对真实源代码块的渲染文本。
      const expected = code.textContent?.replace(/\r\n/g, '\n').replace(/\n$/, '') ?? '';
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        void this.formatReadingBlock(context.sourcePath, expected, info?.lineStart, info?.lineEnd);
      });
    }
  }

  /** 阅读模式先验证真实源块，再切到编辑器执行可撤销修改 */
  private async formatReadingBlock(path: string, expected: string, start?: number, end?: number): Promise<void> {
    try {
      // 嵌入块也打开其真实来源，不修改宿主笔记。
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new DataError('error.file');
      // 操作开始时的完整笔记快照。
      const snapshot = await this.app.vault.read(file);
      // 同时匹配源范围与原文的代码块。
      const candidates = codeBlocks(snapshot).filter(block => block.supported && ['json', ''].includes(block.language) && block.content.replace(/\r\n/g, '\n') === expected && (start === undefined || block.line >= start && block.line <= (end ?? start)));
      if (candidates.length !== 1) throw new DataError('error.ambiguous');
      // 显示源笔记的宿主工作区标签页。
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file, {state: {mode: 'source'}});
      // 本次操作所属的编辑器或验收实例。
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.editor.getValue() !== snapshot) throw new DataError('error.stale');
      view.editor.setCursor(view.editor.offsetToPos(candidates[0].bodyFrom));
      await this.runEditor(view.editor, 'fragment');
    } catch (error) {new Notice(describe(errorDiagnostic(error), this.t));}
  }
}

/** 仅暴露与用户使用有关的排版和高级识别设置 */
class LooseJsonSettings extends PluginSettingTab {
  /** 正在配置的插件实例 */
  private plugin: LooseJsonPlugin;
  /** 关联宿主设置窗口 */
  constructor(plugin: LooseJsonPlugin) {super(plugin.app, plugin); this.plugin = plugin;}
  /** 新版 Obsidian 可搜索设置；旧版沿用 display 并调用本地定义 */
  getSettingDefinitions(): SettingRow[] {
    return [
      {name: this.plugin.t('setting.language'), desc: this.plugin.t('setting.languageHint'), render: setting => {setting.addDropdown(input => input.addOptions({system: this.plugin.t('setting.system'), zh: '中文', en: 'English'}).setValue(this.plugin.settings.language).onChange(value => {this.plugin.settings.language = value as Language; void this.plugin.saveSettings();}));}},
      ...(['previewDocument', 'previewDecode', 'previewJs'] as const).map(key => ({name: this.plugin.t('setting.' + key), desc: this.plugin.t('setting.' + key + 'Hint'), render: (setting: Setting) => {setting.addToggle(input => input.setValue(this.plugin.settings[key]).onChange(value => {this.plugin.settings[key] = value; void this.plugin.saveSettings();}));}})),
      {name: this.plugin.t('setting.indent'), render: setting => {setting.addDropdown(input => input.addOptions({'2': this.plugin.t('setting.spaces', {count: 2}), '4': this.plugin.t('setting.spaces', {count: 4}), tab: 'Tab'}).setValue(this.plugin.settings.indent).onChange(value => {this.plugin.settings.indent = value as Settings['indent']; void this.plugin.saveSettings();}));}},
      {name: this.plugin.t('setting.buttons'), render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.buttons).onChange(value => {this.plugin.settings.buttons = value; void this.plugin.saveSettings();}));}},
      {name: this.plugin.t('setting.compact'), desc: this.plugin.t('setting.compactHint'), render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.compactArrays).onChange(value => {this.plugin.settings.compactArrays = value; void this.plugin.saveSettings();}));}},
      {name: this.plugin.t('setting.inner'), desc: this.plugin.t('setting.innerHint'), render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.allowInnerJson5).onChange(value => {this.plugin.settings.allowInnerJson5 = value; void this.plugin.saveSettings();}));}},
      {name: this.plugin.t('setting.limit'), desc: this.plugin.t('setting.limitHint'), render: setting => {setting.addText(input => input.setValue(String(this.plugin.settings.maxMiB)).onChange(value => {
        // 经过有限值及上下限校验的设置输入。
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0.1 && number <= 10) {this.plugin.settings.maxMiB = number; void this.plugin.saveSettings();}
      }));}}
    ];
  }
  /** 创建可保存的设置表单，不调用新版宿主的渲染方法 */
  display(): void {
    this.containerEl.empty();
    // 每个定义同时提供展示名、说明和编辑控件。
    for (const definition of this.getSettingDefinitions()) {
      // 使用旧版已经支持的 Setting 构建方式。
      const setting = new Setting(this.containerEl).setName(definition.name);
      if (definition.desc) setting.setDesc(definition.desc);
      definition.render(setting);
    }
  }
}

/** 全文预览提供直接可操作的预览设置入口 */
class PreviewSettingsModal extends Modal {
  /** 关联当前插件的设置和保存能力 */
  constructor(private plugin: LooseJsonPlugin) {super(plugin.app);}
  /** 只展示预览相关开关，修复和拆块仍必须审查 */
  onOpen(): void {
    this.titleEl.setText(this.plugin.t('previewSettings'));
    // 用户可立即保存每个操作独立的预览偏好。
    for (const key of ['previewDocument', 'previewDecode', 'previewJs'] as const) {
      new Setting(this.contentEl).setName(this.plugin.t('setting.' + key)).setDesc(this.plugin.t('setting.' + key + 'Hint')).addToggle(toggle => toggle.setValue(this.plugin.settings[key]).onChange(value => {this.plugin.settings[key] = value; void this.plugin.saveSettings();}));
    }
  }
  /** 销毁设置表单 */
  onClose(): void {this.contentEl.empty();}
}
