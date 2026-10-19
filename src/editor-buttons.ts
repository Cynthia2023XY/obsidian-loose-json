import {Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate} from '@codemirror/view';
import {Facet, type Extension} from '@codemirror/state';
import {codeBlocks} from './core/markdown';
import {CBC_SHARED_HEADERS, CBC_TOOLBARS, CodeblockToolbar, type ToolbarAction} from './codeblock-toolbar';

/** 设置变更通过 facet 通知所有打开的编辑器 */
export const buttonsEnabled = Facet.define<boolean, boolean>({combine: values => values.at(-1) ?? true});
/** 是否为未声明语言的代码块展示格式化入口 */
export const unlabelledButtonsEnabled = Facet.define<boolean, boolean>({combine: values => values.at(-1) ?? true});
/** 按钮文案随语言配置刷新 */
export const buttonLabels = Facet.define<readonly string[], readonly string[]>({combine: values => values.at(-1) ?? ['格式化', '格式化此 JSON 代码块']});
/** 按钮操作绑定编辑器和真实代码块范围 */
export type BlockAction = (view: EditorView, from: number) => void;

/** 使用宿主文档创建按钮，支持分屏及独立窗口 */
class FormatWidget extends WidgetType {
  /** 当前围栏起始位置 */
  private from: number;
  /** 所属编辑器的格式化操作 */
  private action: BlockAction;
  /** 保存所属块位置，不依赖当前光标 */
  constructor(from: number, action: BlockAction, private labels: readonly string[]) {super(); this.from = from; this.action = action;}
  /** 同一位置无需重建 DOM */
  eq(other: FormatWidget): boolean {return other.from === this.from && other.action === this.action && other.labels === this.labels;}
  /** 在围栏行右侧创建可聚焦按钮 */
  toDOM(view: EditorView): HTMLElement {
    // 使用 view 所属窗口，避免弹出窗口中的全局 document 混用。
    const wrapper = view.dom.ownerDocument.createElement('span');
    wrapper.className = 'loose-json-editor-action';
    wrapper.dataset.looseJsonFrom = String(this.from);
    // 只操作所属代码块的格式化入口。
    const button = wrapper.ownerDocument.createElement('button');
    button.type = 'button'; button.textContent = this.labels[0]; button.className = 'loose-json-format-button';
    button.setAttribute('aria-label', this.labels[1]);
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); this.action(view, this.from);});
    wrapper.append(button);
    return wrapper;
  }
  /** 按钮自行处理事件，避免编辑器选区被点击改变 */
  ignoreEvent(): boolean {return true;}
}

/** 在源码模式和实时预览提供同一代码块按钮 */
export function editorButtons(action: BlockAction, track: (view: EditorView, mounted: boolean) => void = () => undefined): Extension {
  return ViewPlugin.fromClass(class {
    /** 当前编辑器的按钮装饰 */
    decorations: DecorationSet;
    /** 需要随生命周期释放的宿主编辑器 */
    private view: EditorView;
    /** 第三方代码块工具栏的展示适配，不改变编辑器装饰归属 */
    private toolbar: CodeblockToolbar;
    /** 初次建立装饰 */
    constructor(view: EditorView) {this.view = view; this.decorations = this.build(view); this.toolbar = new CodeblockToolbar(view.dom, () => this.toolbarActions()); track(view, true);}
    /** 编辑器销毁时释放设置刷新引用 */
    destroy(): void {this.toolbar.destroy(); track(this.view, false);}
    /** 文档或设置变化时重新绑定源位置 */
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.startState.facet(buttonsEnabled) !== update.state.facet(buttonsEnabled) || update.startState.facet(buttonLabels) !== update.state.facet(buttonLabels) || update.startState.facet(unlabelledButtonsEnabled) !== update.state.facet(unlabelledButtonsEnabled)) this.decorations = this.build(update.view);
      this.toolbar.schedule();
    }
    /** 按源文档位置匹配 CBC 工具栏，不猜测光标或共享分组标题所属块 */
    private toolbarActions(): ToolbarAction[] {
      if (!this.view.state.facet(buttonsEnabled)) return [];
      // 编辑器内嵌的阅读代码块由后处理器独立适配，不能被再次接管。
      const containers = Array.from(this.view.dom.querySelectorAll<HTMLElement>(CBC_TOOLBARS)).filter(target => !target.closest('pre') && !target.closest(CBC_SHARED_HEADERS));
      if (!containers.length) return [];
      // 当前文档快照用于防止 DOM 更新前的旧入口误操作新位置。
      const snapshot = this.view.state.doc.toString();
      // 仍由 CodeMirror 管理的原始按钮，兼容按钮不搬动这些节点。
      const anchors = new Map(Array.from(this.view.dom.querySelectorAll<HTMLElement>('.loose-json-editor-action')).map(anchor => [Number(anchor.dataset.looseJsonFrom), anchor]));
      // 每个工具栏只计算一次源位置，大文档不按代码块反复扫描 DOM。
      const targetsByFrom = new Map<number, HTMLElement[]>();
      for (const target of containers) {
        try {
          // 宿主公开 API 返回工具栏装饰所对应的围栏位置。
          const from = this.view.posAtDOM(target);
          targetsByFrom.set(from, [...(targetsByFrom.get(from) ?? []), target]);
        } catch { /* 宿主正在替换装饰时等待下一次 DOM 更新，不猜测源位置。 */ }
      }
      // 只有可靠解析并支持的代码块可提供格式化入口。
      const blocks = codeBlocks(snapshot).filter(block => block.supported && (block.language === 'json' || block.language === '' && this.view.state.facet(unlabelledButtonsEnabled)));
      // 当前界面的本地化文案，设置变化后下一帧刷新。
      const labels = this.view.state.facet(buttonLabels);
      // 各代码块独立的兼容入口绑定。
      const actions: ToolbarAction[] = [];
      for (const block of blocks) {
        // 找到当前源块的原生入口；折叠后入口可能暂时被替换掉。
        const anchor = anchors.get(block.from);
        // 工具栏必须位于本块围栏行或本块独立标题，不能接管共享分组标题。
        const targets = targetsByFrom.get(this.view.state.doc.lineAt(block.from).from) ?? [];
        actions.push({anchor, targets, label: labels[0], title: labels[1], run: () => {
          if (this.view.state.doc.toString() !== snapshot) {this.toolbar.schedule(); return;}
          action(this.view, block.from);
        }});
      }
      return actions;
    }
    /** 只对可靠定位的 json/无语言块展示操作 */
    build(view: EditorView): DecorationSet {
      if (!view.state.facet(buttonsEnabled)) return Decoration.none;
      // 文档中已经可靠定位的 fenced 代码块。
      const blocks = codeBlocks(view.state.doc.toString());
      return Decoration.set(blocks.filter(block => block.supported && (block.language === 'json' || block.language === '' && view.state.facet(unlabelledButtonsEnabled))).map(block =>
        Decoration.widget({widget: new FormatWidget(block.from, action, view.state.facet(buttonLabels)), side: 1}).range(view.state.doc.lineAt(block.from).to)
      ));
    }
  }, {decorations: value => value.decorations});
}
