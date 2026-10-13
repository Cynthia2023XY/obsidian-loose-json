/** CBC 的工具栏选择器集中维护，避免展示层依赖散落到格式化引擎 */
export const CBC_TOOLBARS = '.codeblock-customizer-button-container, .codeblock-customizer-header-button-container';

/** CBC 分组标题由多个源块共享，不能用标题位置推断当前选中块 */
export const CBC_SHARED_HEADERS = '.codeblock-customizer-header-group-container, .codeblock-customizer-header-container:has(.codeblock-customizer-header-group-tabs), .codeblock-customizer-header-container-specific:has(.codeblock-customizer-header-group-tabs)';

/** 每个兼容操作保留自己的源块绑定和点击处理，不读取高亮后的代码文本 */
export interface ToolbarAction {
  anchor?: HTMLElement;
  targets: HTMLElement[];
  label: string;
  title: string;
  run: () => void;
}

/** 为第三方工具栏创建独立入口，不搬动 CodeMirror 管理的原始按钮 */
export class CodeblockToolbar {
  /** 当前渲染区域所属窗口，支持分屏及弹出窗口 */
  private window: Window;
  /** 观察第三方插件重建工具栏、折叠及设置变化 */
  private observer: MutationObserver;
  /** 合并同一帧中的多次 DOM 更新 */
  private frame = 0;
  /** 卸载后不再调度兼容入口 */
  private disposed = false;
  /** 本适配器创建的按钮及其绑定，方便重建和统一清理 */
  private buttons = new Map<HTMLElement, {button: HTMLButtonElement; action: ToolbarAction}>();
  /** 已隐藏的原始入口，清理时恢复正常布局 */
  private anchors = new Set<HTMLElement>();

  /** 只监听所属渲染区域和窗口的 CBC 状态，不操作其他编辑器 */
  constructor(private root: HTMLElement, private actions: () => ToolbarAction[]) {
    this.window = root.ownerDocument.defaultView!;
    this.observer = new (this.window as Window & {MutationObserver: typeof MutationObserver}).MutationObserver(() => this.schedule());
    this.observe();
    this.schedule();
  }

  /** 只关注可能改变代码块工具栏的 DOM 与显示状态 */
  private observe(): void {
    this.observer.observe(this.root, {subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style']});
    this.observer.observe(this.root.ownerDocument.body, {attributes: true, attributeFilter: ['class']});
  }

  /** 等宿主完成 DOM 更新后同步，避免在 CodeMirror 更新事务中读写布局 */
  schedule(): void {
    if (this.disposed || this.frame) return;
    this.frame = this.window.requestAnimationFrame(() => {this.frame = 0; this.sync();});
  }

  /** 根据最新的源块绑定重建入口，第三方重建后不会遗留旧位置回调 */
  private sync(): void {
    if (this.disposed) return;
    this.observer.disconnect();
    try {
      // 本轮仍然存在的工具栏，其他入口都必须释放。
      const retained = new Set<HTMLElement>();
      // 当前需要隐藏的原生入口，只在兼容入口确实创建后隐藏。
      const adapted = new Set<HTMLElement>();
      for (const action of this.actions()) {
        for (const target of action.targets) {
          if (!this.root.contains(target) || retained.has(target)) continue;
          retained.add(target);
          if (action.anchor) adapted.add(action.anchor);
          // 原有按钮可能被 CBC 清空，必须重新检查所属关系。
          let entry = this.buttons.get(target);
          if (!entry || entry.button.parentElement !== target) {
            entry?.button.remove();
            // 使用目标所属文档，兼容弹出窗口和嵌入渲染区域。
            const button = target.ownerDocument.createElement('button');
            button.type = 'button';
            button.className = 'loose-json-format-button loose-json-toolbar-action';
            button.contentEditable = 'false';
            entry = {button, action};
            // 点击时读取最新绑定，DOM 重用不会保留旧代码块位置。
            const binding = entry;
            button.addEventListener('mousedown', event => {event.preventDefault(); event.stopPropagation();});
            button.addEventListener('click', event => {event.preventDefault(); event.stopPropagation(); if (!this.disposed && this.root.contains(button)) binding.action.run();});
            target.prepend(button);
            this.buttons.set(target, entry);
          }
          entry.action = action;
          if (entry.button.textContent !== action.label) entry.button.textContent = action.label;
          entry.button.setAttribute('aria-label', action.title);
          target.classList.add('loose-json-cbc-toolbar');
        }
      }
      this.buttons.forEach((entry, target) => {
        if (retained.has(target)) return;
        entry.button.remove(); target.classList.remove('loose-json-cbc-toolbar'); this.buttons.delete(target);
      });
      this.anchors.forEach(anchor => {if (!adapted.has(anchor)) anchor.classList.remove('loose-json-cbc-adapted');});
      adapted.forEach(anchor => anchor.classList.add('loose-json-cbc-adapted'));
      this.anchors = adapted;
    } finally {if (!this.disposed) this.observe();}
  }

  /** 清理自己的节点和隐藏标记，保留 CBC 的复制及折叠入口 */
  destroy(): void {
    this.disposed = true;
    this.observer.disconnect();
    if (this.frame) this.window.cancelAnimationFrame(this.frame);
    this.buttons.forEach((entry, target) => {entry.button.remove(); target.classList.remove('loose-json-cbc-toolbar');});
    this.buttons.clear();
    this.anchors.forEach(anchor => anchor.classList.remove('loose-json-cbc-adapted'));
    this.anchors.clear();
  }
}
