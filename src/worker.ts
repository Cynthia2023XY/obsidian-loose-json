import {decodePlan, documentPlan, fragmentPlan, javascriptLiteral} from './core/engine';
import type {Request} from './jobs';
/** 工作线程只计算文本，不访问 vault、DOM 或剪贴板 */
self.onmessage = (event: MessageEvent<Request>): void => {
  // 调用方的任务参数及处理结果。
  const request = event.data;
  try {
    if (new TextEncoder().encode(request.source).length > request.options.maxBytes) throw new Error('目标超过处理上限，请选择较小片段');
    // 本次处理的结果，用于后续应用或验收。
    const result = request.operation === 'document' ? documentPlan(request.source, request.options)
      : request.operation === 'javascript' ? javascriptLiteral(request.source, request.options)
      : request.operation === 'decode' ? decodePlan(request.source, request.options)
      : fragmentPlan(request.source, request.options, request.loose);
    self.postMessage({result});
  } catch (error) {self.postMessage({error: error instanceof Error ? error.message : String(error)});}
};
