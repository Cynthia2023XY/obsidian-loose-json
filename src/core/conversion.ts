import {detect, type Candidate} from './candidates';
import {DEFAULT_OPTIONS, javascriptLiteral, type Options} from './engine';
import {decodeString, keyName, layout, parseData, tokenize, type DataNode} from './syntax';
import {DataError, type Diagnostic} from '../i18n';

/** 同一候选可复制的上下文形态 */
export interface Output extends Candidate {text: string; object: string; properties?: string; warnings: Diagnostic[]}
/** 转换结果独立于排版修改数量 */
export interface Conversion {candidates: Output[]; diagnostics: Diagnostic[]}

/** 输出严格 JSON，数值以文本处理，避免精度损失 */
function strict(node: DataNode): string {
  if (node.kind === 'object') return '{' + node.entries.map(entry => JSON.stringify(keyName(entry.key)) + ':' + strict(entry.value)).join(',') + '}';
  if (node.kind === 'array') return '[' + node.children.map(strict).join(',') + ']';
  if (node.kind === 'string') return JSON.stringify(decodeString(node.raw));
  if (/^(?:null|true|false)$/.test(node.raw)) return node.raw;
  if (/Infinity|NaN/.test(node.raw)) throw new DataError('error.nonfinite');
  // 十六进制转换也使用整数文本，不经过 Number。
  const hex = node.raw.match(/^([+-]?)(0[xX][\da-fA-F]+)$/);
  if (hex) return (hex[1] === '-' ? -BigInt(hex[2]) : BigInt(hex[2])).toString();
  // JSON5 的小数点和正号只需局部文本归一化。
  return node.raw.replace(/^\+/, '').replace(/^(-?)\./, '$10.').replace(/\.(?=[eE]|$)/, '.0');
}

/** 从原数据树收集复制后的求值风险 */
function risks(node: DataNode): Diagnostic[] {
  // 风险记录使用稳定 code，由界面翻译。
  const result: Diagnostic[] = [];
  if (node.kind === 'atom' && /^[-+]?\d{16,}$/.test(node.raw)) result.push({code: 'warning.integer'});
  // 同一对象内重复字段不会被重序列化消除。
  const seen = new Set<string>();
  for (const entry of node.entries) {
    // 字段名称用于覆盖风险提示。
    const key = keyName(entry.key);
    if (seen.has(key)) result.push({code: 'warning.duplicate', params: {key}});
    seen.add(key); result.push(...risks(entry.value));
  }
  node.children.forEach(child => result.push(...risks(child)));
  return result;
}

/** 将属性片段从虚拟对象中取出并恢复原层级缩进 */
function properties(text: string, indent: string): string {return text.slice(text.indexOf('{') + 1, text.lastIndexOf('}')).trim().split('\n').map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');}

/** 支持完整值、属性选区和日志候选的 JavaScript 复制 */
export function javascriptCandidates(source: string, options = DEFAULT_OPTIONS): Conversion {
  // 检测与转换分离，已格式化数据也能复制。
  const found = detect(source);
  return {diagnostics: found.diagnostics, candidates: found.candidates.map(candidate => {
    // 对象属性包装用于语法树转换，自动模式仍保留原形态。
    const root = parseData(candidate.parsed);
    // 可用于表达式上下文的完整输出。
    const object = ['object', 'array'].includes(root.kind) ? javascriptLiteral(candidate.parsed, options).text : root.kind === 'string' ? "'" + JSON.stringify(decodeString(root.raw)).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'") + "'" : root.raw;
    // 去掉虚拟包装后的属性片段。
    const props = root.kind === 'object' ? properties(object, options.indent) : undefined;
    // 当前选择形态的生成文本。
    const text = (candidate.kind === 'properties' ? props ?? object : object) + (candidate.trailing ? ',' : '');
    return {...candidate, text, object, properties: props, warnings: risks(root)};
  })};
}

/** 仅补结构闭合，解析校验阻止为缺失字符串或字段猜值 */
function closeStructure(source: string): {text: string; count: number} {
  // 严格词法校验拒绝未闭合字符串和注释。
  const tokens = tokenize(source);
  // 待闭合括号，用于有界修复。
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.kind !== 'punct') continue;
    if (token.raw === '{' || token.raw === '[') stack.push(token.raw === '{' ? '}' : ']');
    else if (token.raw === '}' || token.raw === ']') {if (stack.pop() !== token.raw) throw new DataError('error.truncated');}
  }
  // 补括号前删除尾部逗号，但不会补缺少的属性值。
  const text = source.replace(/,\s*$/, '') + (tokens.at(-1)?.raw.startsWith('//') ? '\n' : '') + stack.reverse().join('');
  parseData(text);
  return {text, count: stack.length};
}

/** 有界修复输出，始终由用户检查舍弃信息后选择复制或写入 */
export function repairCandidates(source: string, options: Options = DEFAULT_OPTIONS): Conversion {
  // 优先识别完整上下文，再为明确截断结构生成候选。
  const found = detect(source, true);
  // 本次处理结果与独立诊断。
  const result: Conversion = {candidates: [], diagnostics: [...found.diagnostics]};
  for (const candidate of found.candidates) {
    try {
      // 每项修复保留其操作摘要，原文始终可预览。
      const warnings: Diagnostic[] = [];
      // 仅补齐结构后的校验输入。
      const closed = candidate.complete ? {text: candidate.parsed, count: 0} : closeStructure(candidate.parsed);
      if (closed.count) warnings.push({code: 'repair.closing', params: {count: closed.count}});
      if (candidate.trailing) warnings.push({code: 'repair.delimiter'});
      if (candidate.kind === 'properties') warnings.push({code: 'repair.wrapper'});
      if (candidate.kind === 'log') warnings.push({code: 'repair.extracted'});
      if (tokenize(candidate.source).some(token => token.kind === 'comment')) warnings.push({code: 'repair.comments'});
      // 校验严格输出而不将 Number 解析结果用于输出。
      const canonical = strict(parseData(closed.text));
      JSON.parse(canonical);
      // 当前选择形态的生成文本。
      const text = layout(canonical, options.indent, options.compactArrays);
      if (canonical !== closed.text) warnings.push({code: 'repair.normalized'});
      result.candidates.push({...candidate, text, object: text, warnings});
    } catch (error) {result.diagnostics.push(error instanceof DataError ? error.diagnostic : {code: 'error.incompleteValue'});}
  }
  return result;
}

/** 日志拆块仅提取完整外层数据，不尝试修复 */
export function extractCandidates(source: string, options = DEFAULT_OPTIONS): Conversion {
  // 原标签和顺序用于展示，不把相邻记录自动配对。
  const found = detect(source);
  return {diagnostics: found.diagnostics, candidates: found.candidates.map(candidate => ({...candidate, text: layout(candidate.parsed, options.indent, options.compactArrays), object: candidate.parsed, warnings: candidate.kind === 'log' ? [{code: 'repair.extracted'}] : []}))};
}
