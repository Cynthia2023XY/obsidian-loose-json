import type {Options, Plan} from './core/engine';
/** 构建时注入的工作线程代码，不进行网络加载 */
declare const LOOSE_JSON_WORKER: string;
/** 后台任务支持的处理方式 */
export type Operation = 'fragment' | 'document' | 'javascript' | 'decode';
/** 主线程与工作线程共享的数据协议 */
export interface Request {operation: Operation; source: string; options: Options; loose?: boolean}
/** 字面量预览输出 */
export interface LiteralResult {text: string; warnings: string[]}

/** 每次操作使用可取消的独立线程，退出弹窗即终止计算 */
export function startJob<T = Plan>(request: Request): {result: Promise<T>; cancel: () => void} {
  // 使用内联 Blob，不加载任何外部脚本。
  const url = URL.createObjectURL(new Blob([LOOSE_JSON_WORKER], {type: 'text/javascript'}));
  // 处理当前文本快照的独立线程。
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  // 用户取消时终止任务的拒绝回调。
  let rejectJob: (reason: Error) => void = () => undefined;
  // 本次处理的结果，用于后续应用或验收。
  const result = new Promise<T>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (event: MessageEvent<{error?: string; result?: T}>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result as T);
    };
    worker.onerror = event => {worker.terminate(); reject(new Error(event.message || '后台处理失败'));};
    worker.postMessage(request);
  });
  return {result, cancel: () => {worker.terminate(); rejectJob(new Error('已取消'));}};
}
