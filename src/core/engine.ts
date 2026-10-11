import {blockBody, codeBlocks, proseRanges, type Range} from './markdown';
import {decodeString, IDENTIFIER, keyName, layout, parseData, tokenize, type DataNode} from './syntax';

/** 用户可配置的排版与转换行为 */
export interface Options {indent: string; compactArrays: boolean; allowInnerJson5: boolean; maxBytes: number}
/** 预览和应用共享的文本修改项 */
export interface Change extends Range {before: string; after: string; label: string; warning?: string}
/** 扫描结果，区分修改项与跳过诊断 */
export interface Plan {changes: Change[]; skipped: string[]}
/** 首版默认保持每项数组换行、严格识别内部字符串化 JSON */
export const DEFAULT_OPTIONS: Options = {indent: '  ', compactArrays: false, allowInnerJson5: false, maxBytes: 1024 * 1024};

/** 在字符串和注释状态下匹配最外层括号，损坏输入不推断闭合位置 */
function balancedEnd(source: string, start: number): number {
  // 结构层级和局部词法状态。
  const stack: string[] = [];
  // 当前字符串的引号类型。
  let quote = '';
  // 当前注释的词法状态。
  let comment = '';
  // 逐字符扫描的当前位置。
  for (let i = start; i < source.length; i++) {
    // 当前字符，用于推进字符串和结构状态。
    const char = source[i];
    if (comment === '//') {if (char === '\n') comment = ''; continue;}
    if (comment === '/*') {if (source.startsWith('*/', i)) {comment = ''; i++;} continue;}
    if (quote) {
      if (char === '\\') {i++; if (source[i] === '\r' && source[i + 1] === '\n') i++; continue;}
      if (char === quote) quote = '';
      else if (char === '\n' || char === '\r') return -1;
      continue;
    }
    if (char === '"' || char === "'") {quote = char; continue;}
    if (source.startsWith('//', i) || source.startsWith('/*', i)) {comment = source.slice(i, i + 2); i++; continue;}
    if (char === '{' || char === '[') {
      if (stack.length > 128) return -1;
      stack.push(char === '{' ? '}' : ']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return -1;
      if (!stack.length) return i + 1;
    }
    // 新日志记录开始时终止截断片段，避免吞掉下一条记录。
    if (char === '\n' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:/.test(source.slice(i + 1, i + 24))) return -1;
  }
  return -1;
}

/** 识别日志中的完整可信片段，损坏片段仅在显式目标中允许排版 */
export function fragmentPlan(source: string, options = DEFAULT_OPTIONS, loose = false): Plan {
  // 已识别结果及非片段文本中的引号保护状态。
  const plan: Plan = {changes: [], skipped: []};
  // 当前字符串的引号类型。
  let quote = '';
  // 逐字符扫描的当前位置。
  for (let i = 0; i < source.length; i++) {
    // 当前字符，用于推进字符串和结构状态。
    const char = source[i];
    if (quote) {
      if (char === '\\') i++;
      else if (char === quote || char === '\n') quote = '';
      continue;
    }
    // 普通文字里的引号保护；单词中的撇号不启动字符串状态。
    if (char === '"' || (char === "'" && !/\w/.test(source[i - 1] ?? ''))) {quote = char; continue;}
    if (char !== '{' && char !== '[') continue;
    // 当前最外层结构的合法结束位置，无法确定时不修改。
    const end = balancedEnd(source, i);
    if (end < 0) {
      plan.skipped.push(`字符 ${i + 1}：结构截断或括号不匹配`);
      // 只在明确的新日志记录处恢复，避免修改截断外层中的嵌套对象。
      const nextRecord = source.slice(i + 1).match(/\n\d{4}-\d{2}-\d{2}[ T]\d{2}:/);
      if (!nextRecord || nextRecord.index === undefined) break;
      i += nextRecord.index + 1;
      continue;
    }
    // 候选范围内尚未修改的原文。
    const before = source.slice(i, end);
    // 当前片段是否通过数据语法校验。
    let valid = false;
    try {parseData(before); valid = true;} catch { /* 损坏对象仅供显式宽松预览。 */ }
    // 损坏片段是否仍具有对象属性结构。
    const jsonLike = char === '{' && tokenize(before).some(token => token.raw === ':');
    if (!valid && (!loose || !jsonLike)) {
      // 日志等级及线程名是普通文本，不作为损坏 JSON 报警。
      if (jsonLike) plan.skipped.push(`字符 ${i + 1}：无法解析，已跳过`);
      i = end - 1; continue;
    }
    try {
      // 保留数据含义的目标文本。
      const after = layout(before, options.indent, options.compactArrays);
      if (before !== after) plan.changes.push({from: i, to: end, before, after, label: `字符 ${i + 1}`, warning: valid ? undefined : '仅改善排版，语法仍可能无效'});
    } catch (error) {plan.skipped.push(`字符 ${i + 1}：${String(error)}`);}
    i = end - 1;
  }
  return plan;
}

/** 仅替换已确认的范围，拒绝过期预览和重叠修改 */
export function applyChanges(source: string, changes: Change[]): string {
  // 顺序拼接一次，避免大量日志修改反复复制整篇文档。
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  // 用于一次拼接结果的原文与修改片段。
  const pieces: string[] = [];
  // 已处理片段的源边界，防止修改范围重叠。
  let boundary = 0;
  // 每项已经过用户选择的修改都须独立核验原范围。
  for (const change of sorted) {
    if (change.from < boundary || change.to > source.length || change.from > change.to || source.slice(change.from, change.to) !== change.before) throw new Error('目标内容已改变，请重新运行命令');
    pieces.push(source.slice(boundary, change.from), change.after);
    boundary = change.to;
  }
  pieces.push(source.slice(boundary));
  return pieces.join('');
}

/** 规划文档修改，保护非 JSON 内容及不支持的 Markdown 容器 */
export function documentPlan(source: string, options = DEFAULT_OPTIONS): Plan {
  // 超限输入不进入扫描器，所有算法也在独立工作线程执行。
  if (new TextEncoder().encode(source).length > options.maxBytes) throw new Error('文档超过处理上限，请选择较小片段或调整高级设置');
  // 文档中已经可靠定位的 fenced 代码块。
  const blocks = codeBlocks(source);
  // 行起点只计算一次，大量日志片段不反复切分整篇前缀。
  const lineStarts = [0];
  // 每个换行之后的位置就是下一条日志行的起点。
  for (let position = 0; position < source.length; position++) if (source[position] === '\n') lineStarts.push(position + 1);
  // 二分查找候选所在行，不复制外围日志文本。
  const lineNumber = (position: number): number => {
    // 尚未排除的第一行索引。
    let low = 0;
    // 尚未排除范围之后的行索引。
    let high = lineStarts.length;
    while (low < high) {
      // 本轮二分的中间行索引。
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= position) low = middle + 1; else high = middle;
    }
    return low;
  };
  // 本次处理的结果，用于后续应用或验收。
  const result: Plan = {changes: [], skipped: []};
  // 当前操作所属的真实代码块。
  for (const block of blocks) {
    if (!['json', ''].includes(block.language)) continue;
    if (!block.supported) {result.skipped.push(`第 ${block.line + 1} 行：围栏或容器无法可靠定位`); continue;}
    // 按源位置规划的修改候选与跳过原因。
    const plan = fragmentPlan(block.content, options);
    result.skipped.push(...plan.skipped.map(message => `第 ${block.line + 1} 行：${message}`));
    if (plan.changes.length) {
      // 保留数据含义的目标文本。
      const after = blockBody(block, applyChanges(block.content, plan.changes));
      result.changes.push({from: block.bodyFrom, to: block.bodyTo, before: source.slice(block.bodyFrom, block.bodyTo), after, label: `第 ${block.line + 1} 行代码块`});
    }
  }
  // 当前允许处理的源范围。
  for (const range of proseRanges(source, blocks)) {
    // 按源位置规划的修改候选与跳过原因。
    const plan = fragmentPlan(source.slice(range.from, range.to), options);
    result.changes.push(...plan.changes.map(change => ({...change, from: range.from + change.from, to: range.from + change.to, label: `第 ${lineNumber(range.from + change.from)} 行日志`})));
    result.skipped.push(...plan.skipped);
  }
  result.changes.sort((a, b) => a.from - b.from);
  return result;
}

/** 生成可粘贴到 JavaScript 表达式位置的单引号字符串 */
function singleQuote(value: string): string {
  return "'" + JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'").replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + "'";
}

/** 生成 JS 字面量，保留原数值 token、字段顺序和重复属性 */
export function javascriptLiteral(source: string, options = DEFAULT_OPTIONS): {text: string; warnings: string[]} {
  // 解析器只接受对象/数组，字符串仅用于值转换。
  const root = parseData(source);
  if (!['object', 'array'].includes(root.kind)) throw new Error('请选择一个完整对象或数组');
  // 保持原始数值 token 的字段与字符串修改。
  const edits: Change[] = [];
  // 需要向用户说明的类型或求值风险。
  const warnings: string[] = [];
  // 按源范围遍历字段，保留重复字段与数组索引。
  const visit = (node: DataNode): void => {
    if (node.kind === 'string') edits.push({from: node.start, to: node.end, before: node.raw, after: singleQuote(decodeString(node.raw)), label: '字符串'});
    if (node.kind === 'atom' && NUMBER_UNSAFE.test(node.raw)) warnings.push('超大整数文本已保留，但 JS Number 求值可能损失精度；需要时在源码中改用 BigInt。');
    // 当前对象已经出现的属性名。
    const seen = new Set<string>();
    // 逐个处理原始属性，保留重复字段并生成求值提醒。
    for (const entry of node.entries) {
      // 解码后的属性名，用于合法标识符判断。
      const name = keyName(entry.key);
      if (seen.has(name)) warnings.push(`重复字段 ${name} 已保留，JS 求值时后值覆盖前值。`);
      seen.add(name);
      // 保留数据含义的目标文本。
      const after = name === '__proto__' ? `[${singleQuote(name)}]` : IDENTIFIER.test(name) ? name : singleQuote(name);
      edits.push({from: entry.key.start, to: entry.key.end, before: entry.key.raw, after, label: '属性名'});
      visit(entry.value);
    }
    node.children.forEach(visit);
  };
  visit(root);
  // 计算属性包含括号，仍可由 token 排版器处理。
  return {text: layout(applyChanges(source, edits), options.indent, options.compactArrays), warnings: [...new Set(warnings)]};
}
/** 对可能超出安全整数范围的整数给出求值提醒，不改写其内容 */
const NUMBER_UNSAFE = /^[-+]?\d{16,}$/;

/** 逐层解码字符串，仅当结果是完整对象或数组时生成转换候选 */
function decodedObject(raw: string, options: Options): {text: string; layers: number} | null {
  // 外层字符串和最多三层内部编码，不遍历新对象中的字符串。
  let text = raw;
  // 当前字符串解码的层数。
  for (let layers = 1; layers <= 3; layers++) {
    try {
      text = decodeString(text);
      // 仅移除外围空白后的解码内容。
      const trimmed = text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        if (!options.allowInnerJson5) JSON.parse(trimmed);
        // 保留源范围的数据节点。
        const node = parseData(trimmed);
        if (!['object', 'array'].includes(node.kind)) return null;
        return {text: layout(trimmed, options.indent, options.compactArrays), layers};
      }
      if (!trimmed.startsWith('"') && !trimmed.startsWith("'")) return null;
      text = trimmed;
    } catch {return null;}
  }
  return null;
}

/** 扫描可转换的字段，用源位置区分重复 JSON Pointer 路径 */
export function decodePlan(source: string, options = DEFAULT_OPTIONS): Plan {
  // 整体语法校验阻止错误响应中猜测字段边界。
  const root = parseData(source);
  // 本次处理的结果，用于后续应用或验收。
  const result: Plan = {changes: [], skipped: []};
  // 按源范围遍历字段，保留重复字段与数组索引。
  const visit = (node: DataNode, path: string): void => {
    if (node.kind === 'string') {
      // 成功解码的对象文本及层数。
      const decoded = decodedObject(node.raw, options);
      if (decoded) {
        // 在原字段所在行的缩进下嵌入新对象。
        const startOfLine = source.lastIndexOf('\n', node.start - 1) + 1;
        // 需要在修改后恢复的原始缩进。
        const prefix = source.slice(startOfLine, node.start).match(/^[\t ]*/)?.[0] ?? '';
        // 保留数据含义的目标文本。
        const after = decoded.text.split(/\r?\n/).map((line, index) => index ? prefix + line : line).join(source.includes('\r\n') ? '\r\n' : '\n');
        result.changes.push({from: node.start, to: node.end, before: node.raw, after, label: `${path || '/'} · 字符 ${node.start + 1} · ${decoded.layers} 层解码`, warning: '字符串将变为对象或数组，原接口字段类型将改变'});
      }
    }
    node.entries.forEach(entry => visit(entry.value, path + '/' + keyName(entry.key).replace(/~/g, '~0').replace(/\//g, '~1')));
    node.children.forEach((child, index) => visit(child, path + '/' + index));
  };
  visit(root, '');
  return result;
}
