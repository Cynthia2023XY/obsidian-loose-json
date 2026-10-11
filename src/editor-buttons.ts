import {Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate} from '@codemirror/view';
import {Facet, type Extension} from '@codemirror/state';
import {codeBlocks} from './core/markdown';

/** 设置变更通过 facet 通知所有打开的编辑器 */
export const buttonsEnabled = Facet.define<boolean, boolean>({combine: values => values.at(-1) ?? true});
/** 按钮操作绑定编辑器和真实代码块范围 */
export type BlockAction = (view: EditorView, from: number) => void;

/** 使用宿主文档创建按钮，支持分屏及独立窗口 */
class FormatWidget extends WidgetType {
  /** 当前围栏起始位置 */
  private from: number;
  /** 所属编辑器的格式化操作 */
  private action: BlockAction;
  /** 保存所属块位置，不依赖当前光标 */
  constructor(from: number, action: BlockAction) {super(); this.from = from; this.action = action;}
  /** 同一位置无需重建 DOM */
  eq(other: FormatWidget): boolean {return other.from === this.from && other.action === this.action;}
  /** 在围栏行右侧创建可聚焦按钮 */
  toDOM(view: EditorView): HTMLElement {
    // 使用 view 所属窗口，避免弹出窗口中的全局 document 混用。
    const wrapper = view.dom.ownerDocument.createElement('span');
    wrapper.className = 'loose-json-editor-action';
    // 只操作所属代码块的格式化入口。
    const button = wrapper.ownerDocument.createElement('button');
    button.type = 'button'; button.textContent = '格式化'; button.className = 'loose-json-format-button';
    button.setAttribute('aria-label', '格式化此 JSON 代码块');
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
    /** 初次建立装饰 */
    constructor(view: EditorView) {this.view = view; this.decorations = this.build(view); track(view, true);}
    /** 编辑器销毁时释放设置刷新引用 */
    destroy(): void {track(this.view, false);}
    /** 文档或设置变化时重新绑定源位置 */
    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.startState.facet(buttonsEnabled) !== update.state.facet(buttonsEnabled)) this.decorations = this.build(update.view);
    }
    /** 只对可靠定位的 json/无语言块展示操作 */
    build(view: EditorView): DecorationSet {
      if (!view.state.facet(buttonsEnabled)) return Decoration.none;
      // 文档中已经可靠定位的 fenced 代码块。
      const blocks = codeBlocks(view.state.doc.toString());
      return Decoration.set(blocks.filter(block => block.supported && ['json', ''].includes(block.language)).map(block =>
        Decoration.widget({widget: new FormatWidget(block.from, action), side: 1}).range(view.state.doc.lineAt(block.from).to)
      ));
    }
  }, {decorations: value => value.decorations});
}
