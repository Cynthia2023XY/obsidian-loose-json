import {Compartment} from '@codemirror/state';
import type {EditorView} from '@codemirror/view';
import {Editor, MarkdownRenderChild, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, type MarkdownPostProcessorContext} from 'obsidian';
import {applyChanges, DEFAULT_OPTIONS, type Change, type Options, type Plan} from './core/engine';
import {blockBody, codeBlocks, type CodeBlock} from './core/markdown';
import {buttonsEnabled, editorButtons} from './editor-buttons';
import {startJob, type LiteralResult, type Operation} from './jobs';
import {ChangesModal, LiteralModal, ProgressModal} from './modals';

/** 持久化设置，只影响用户显式操作 */
interface Settings {indent: '2' | '4' | 'tab'; buttons: boolean; compactArrays: boolean; allowInnerJson5: boolean; maxMiB: number}
/** 插件初始设置 */
const DEFAULT_SETTINGS: Settings = {indent: '2', buttons: true, compactArrays: false, allowInnerJson5: false, maxMiB: 1};
/** 命令定位结果，保留完整快照以防预览后内容变更 */
interface Target {snapshot: string; from: number; to: number; content: string; block?: CodeBlock}
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
  /** 卸载插件时终止未完成工作 */
  private cancellations = new Set<() => void>();
  /** 插件卸载时关闭预览，避免旧操作继续修改笔记 */
  private modals = new Set<Modal>();

  /** 初始化设置、命令及两种渲染模式的按钮 */
  async onload(): Promise<void> {
    // 只恢复合法设置，历史或手工修改的配置不能绕过处理上限。
    const stored = await this.loadData() as Partial<Settings> | null;
    if (stored) {
      this.settings = {...DEFAULT_SETTINGS, ...stored};
      if (!['2', '4', 'tab'].includes(this.settings.indent)) this.settings.indent = '2';
      this.settings.maxMiB = Math.max(0.1, Math.min(10, Number(this.settings.maxMiB) || 1));
    }
    this.addSettingTab(new LooseJsonSettings(this));
    this.registerEditorExtension([
      this.buttonCompartment.of(buttonsEnabled.of(this.settings.buttons)),
      editorButtons((view, from) => {void this.formatEditorBlock(view, from);}, (view, mounted) => {if (mounted) this.editorViews.add(view); else this.editorViews.delete(view);})
    ]);
    this.registerMarkdownPostProcessor((element, context) => this.readingButtons(element, context));
    this.addCommand({id: 'format-block', name: '格式化 JSON 代码块或选区', editorCallback: editor => {void this.runEditor(editor, 'fragment');}});
    this.addCommand({id: 'format-document', name: '格式化当前文档中的 JSON', editorCallback: editor => {void this.runEditor(editor, 'document');}});
    this.addCommand({id: 'copy-javascript', name: '复制为 JS 对象字面量', editorCallback: editor => {void this.runEditor(editor, 'javascript');}});
    this.addCommand({id: 'decode-fields', name: '将字符串化 JSON 字段转为对象', editorCallback: editor => {void this.runEditor(editor, 'decode');}});
  }

  /** 停止后台处理，释放编辑器引用 */
  onunload(): void {
    this.modals.forEach(modal => modal.close()); this.modals.clear();
    this.cancellations.forEach(cancel => cancel()); this.cancellations.clear(); this.editorViews.clear();
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
    // 当前打开的宿主编辑器允许公开 API 重配注册的扩展。
    this.editorViews.forEach(view => {
      if (!view.dom.isConnected) {this.editorViews.delete(view); return;}
      view.dispatch({effects: this.buttonCompartment.reconfigure(buttonsEnabled.of(this.settings.buttons))});
    });
    this.readingActions.forEach(button => button.hidden = !this.settings.buttons);
  }

  /** 运行可取消任务，避免处理时阻塞编辑窗口 */
  private async compute<T = Plan>(operation: Operation, source: string, loose = false): Promise<T> {
    // 每次操作独立快照和工作线程，预览不自动落盘。
    const progress = new ProgressModal(this.app);
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
      if (codeBlocks(snapshot).some(block => from < block.bodyFrom && to > block.bodyFrom || from < block.bodyTo && to > block.bodyTo)) throw new Error('选区跨越代码块围栏，请使用文档格式化命令');
      return {snapshot, from, to, content: selection};
    }
    // 下一待处理词法单元的位置。
    const cursor = editor.posToOffset(editor.getCursor());
    // 当前操作所属的真实代码块。
    const block = codeBlocks(snapshot).find(item => cursor >= item.from && (cursor < item.to || cursor === snapshot.length && item.to === snapshot.length));
    if (!block || !['json', ''].includes(block.language)) throw new Error('请将光标放在 json 或无语言代码块中，或选择要处理的文本');
    if (!block.supported) throw new Error('代码块围栏或容器无法可靠定位');
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
    if (editor.getValue() !== snapshot) throw new Error('预览期间笔记已改变，请重新运行命令');
    applyChanges(snapshot, changes);
    editor.transaction({changes: changes.map(change => ({from: editor.offsetToPos(change.from), to: editor.offsetToPos(change.to), text: change.after}))});
    new Notice(`已应用 ${changes.length} 项修改`);
  }

  /** 执行四类命令，数据转换始终预览，普通排版可直接撤销 */
  private async runEditor(editor: Editor, operation: Operation): Promise<void> {
    try {
      if (operation === 'document') {
        // 操作开始时的完整笔记快照。
        const snapshot = editor.getValue();
        // 按源位置规划的修改候选与跳过原因。
        const plan = await this.compute('document', snapshot);
        this.showPlan(plan, changes => this.applyEditor(editor, snapshot, changes));
        return;
      }
      // 代码块或选区及其完整源文档快照。
      const target = this.target(editor);
      if (operation === 'javascript') {this.openModal(new LiteralModal(this.app, await this.compute<LiteralResult>(operation, target.content))); return;}
      // 按源位置规划的修改候选与跳过原因。
      const plan = await this.compute(operation, target.content, operation === 'fragment' && (!target.block || target.block.language === 'json'));
      if (operation === 'decode' || plan.skipped.length || plan.changes.some(change => change.warning)) {
        this.showPlan(plan, changes => this.applyEditor(editor, target.snapshot, [this.targetChange(target, changes)]));
      } else if (plan.changes.length) this.applyEditor(editor, target.snapshot, [this.targetChange(target, plan.changes)]);
      else new Notice('未发现需要修改的 JSON 片段');
    } catch (error) {new Notice(error instanceof Error ? error.message : String(error));}
  }

  /** 没有候选也可展示跳过原因，避免静默失败 */
  private showPlan(plan: Plan, apply: (changes: Change[]) => void): void {
    if (!plan.changes.length && !plan.skipped.length) {new Notice('未发现可处理的 JSON，或内容已经格式化'); return;}
    this.openModal(new ChangesModal(this.app, plan, apply));
  }

  /** 编辑器按钮只修改所属代码块，结果完成前核验整个快照 */
  private async formatEditorBlock(view: EditorView, from: number): Promise<void> {
    this.editorViews.add(view);
    try {
      // 操作开始时的完整笔记快照。
      const snapshot = view.state.doc.toString();
      // 当前操作所属的真实代码块。
      const block = codeBlocks(snapshot).find(item => item.from === from);
      if (!block?.supported) throw new Error('代码块已改变，请再次点击按钮');
      // 按源位置规划的修改候选与跳过原因。
      const plan = await this.compute('fragment', block.content, block.language === 'json');
      // 核验源快照后应用到所属编辑器。
      const apply = (changes: Change[]): void => {
        if (!view.dom.isConnected || view.state.doc.toString() !== snapshot) throw new Error('笔记或代码块已改变，请再次点击按钮');
        view.dispatch({changes: {from: block.bodyFrom, to: block.bodyTo, insert: blockBody(block, applyChanges(block.content, changes))}, userEvent: 'input'});
      };
      if (plan.skipped.length || plan.changes.some(change => change.warning)) this.showPlan(plan, apply);
      else if (plan.changes.length) apply(plan.changes);
      else new Notice('未发现需要修改的 JSON 片段');
    } catch (error) {new Notice(error instanceof Error ? error.message : String(error));}
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
      const button = pre.createEl('button', {text: '格式化', cls: 'loose-json-format-button loose-json-reading-action', attr: {'aria-label': '格式化此 JSON 代码块'}});
      pre.addClass('loose-json-code-block');
      this.readingActions.add(button);
      // 随渲染区生命周期销毁按钮，插件卸载时不留下可点击旧操作。
      const child = new MarkdownRenderChild(pre);
      child.register(() => {button.remove(); pre.removeClass('loose-json-code-block'); this.readingActions.delete(button);});
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
      if (!(file instanceof TFile)) throw new Error('无法定位源文件');
      // 操作开始时的完整笔记快照。
      const snapshot = await this.app.vault.read(file);
      // 同时匹配源范围与原文的代码块。
      const candidates = codeBlocks(snapshot).filter(block => block.supported && ['json', ''].includes(block.language) && block.content.replace(/\r\n/g, '\n') === expected && (start === undefined || block.line >= start && block.line <= (end ?? start)));
      if (candidates.length !== 1) throw new Error('代码块位置不明确，请切换编辑模式后使用命令');
      // 显示源笔记的宿主工作区标签页。
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(file, {state: {mode: 'source'}});
      // 本次操作所属的编辑器或验收实例。
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.editor.getValue() !== snapshot) throw new Error('源内容已改变，请在编辑模式重新操作');
      view.editor.setCursor(view.editor.offsetToPos(candidates[0].bodyFrom));
      await this.runEditor(view.editor, 'fragment');
    } catch (error) {new Notice(error instanceof Error ? error.message : String(error));}
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
      {name: '缩进', render: setting => {setting.addDropdown(input => input.addOptions({'2': '2 空格', '4': '4 空格', tab: 'Tab'}).setValue(this.plugin.settings.indent).onChange(value => {this.plugin.settings.indent = value as Settings['indent']; void this.plugin.saveSettings();}));}},
      {name: '代码块格式化按钮', render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.buttons).onChange(value => {this.plugin.settings.buttons = value; void this.plugin.saveSettings();}));}},
      {name: '简单数组保持单行', desc: '关闭时数组每项换行。', render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.compactArrays).onChange(value => {this.plugin.settings.compactArrays = value; void this.plugin.saveSettings();}));}},
      {name: '允许内部字符串使用 JSON5', desc: '仅影响字符串化 JSON 转对象；默认要求内部内容是严格 JSON。', render: setting => {setting.addToggle(input => input.setValue(this.plugin.settings.allowInnerJson5).onChange(value => {this.plugin.settings.allowInnerJson5 = value; void this.plugin.saveSettings();}));}},
      {name: '处理上限（MiB）', desc: '0.1–10 MiB；大文本可选择片段处理。', render: setting => {setting.addText(input => input.setValue(String(this.plugin.settings.maxMiB)).onChange(value => {
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
