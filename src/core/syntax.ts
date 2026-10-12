import JSON5 from 'json5';
import {DataError} from '../i18n';

/** 保留源文本的词法单元，不将数字转换成 JavaScript Number */
export interface Token {kind: 'string' | 'comment' | 'atom' | 'punct'; raw: string; start: number; end: number; incomplete?: boolean}
/** 用于转换的语法节点，保留属性顺序、重复字段和源位置 */
export interface DataNode {kind: 'object' | 'array' | 'string' | 'atom'; start: number; end: number; raw: string; children: DataNode[]; entries: {key: Token; value: DataNode}[]}
/** 支持的数字字面量，所有输出直接使用原始文本 */
const NUMBER = /^[+-]?(?:0[xX][\da-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|Infinity|NaN)$/;
/** 无需引号的 ECMAScript 属性名 */
export const IDENTIFIER = /^[$_\p{ID_Start}][$_\u200c\u200d\p{ID_Continue}]*$/u;

/** 提取结构 token，忽略布局空白，严格保留字符串与注释 */
export function tokenize(source: string, tolerant = false): Token[] {
  // 扫描索引及累积的词法结果。
  const tokens: Token[] = [];
  // 逐字符扫描的当前位置。
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {i++; continue;}
    // 当前单元的源范围与类型。
    const start = i;
    // 区分字符串、注释、标点与原始字面量，决定后续解析方式。
    let kind: Token['kind'] = 'atom';
    if (source[i] === '"' || source[i] === "'") {
      kind = 'string';
      // 当前字符串的引号类型。
      const quote = source[i++];
      // 当前字符串是否找到合法闭合引号。
      let closed = false;
      while (i < source.length) {
        if (source[i] === '\\') {i += 2; continue;}
        if (source[i++] === quote) {closed = true; break;}
      }
      if (!closed) {
        if (!tolerant) throw new DataError('error.string', {offset: start + 1});
        tokens.push({kind, raw: source.slice(start), start, end: source.length, incomplete: true});
        break;
      }
    } else if (source.startsWith('//', i)) {
      kind = 'comment';
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') i++;
    } else if (source.startsWith('/*', i)) {
      kind = 'comment';
      // 与起始围栏相匹配的关闭标记。
      const closing = source.indexOf('*/', i + 2);
      if (closing === -1) {
        if (!tolerant) throw new DataError('error.comment');
        tokens.push({kind, raw: source.slice(start), start, end: source.length, incomplete: true});
        break;
      }
      i = closing + 2;
    } else if ('{}[]:,'.includes(source[i])) {
      kind = 'punct'; i++;
    } else {
      i++;
      while (i < source.length && !/[\s{}[\]:,"']/.test(source[i]) && !source.startsWith('//', i) && !source.startsWith('/*', i)) i++;
    }
    tokens.push({kind, raw: source.slice(start, i), start, end: i});
  }
  return tokens;
}

/** 解码 JSON5 字符串，仅处理文本值，不重新序列化数字或对象 */
export function decodeString(raw: string): string {
  // 使用成熟库处理合法转义以及单引号字符串。
  const value: unknown = JSON5.parse(raw);
  if (typeof value !== 'string') throw new DataError('error.notString');
  return value;
}

/** 解码属性名，包括 JSON5 的 Unicode 转义属性名 */
export function keyName(token: Token): string {
  if (token.kind === 'string') return decodeString(token.raw);
  // 仅解析单个键，属性值固定，不影响用户数字。
  const keys = Object.keys(JSON5.parse(`{${token.raw}:null}`));
  if (keys.length !== 1) throw new DataError('error.key');
  return keys[0];
}

/** 校验并构建带源范围的宽松数据树；不接受任意 JS 表达式 */
export function parseData(source: string): DataNode {
  // 注释对数据结构透明，源文本仍保留在原始节点中。
  const tokens = tokenize(source).filter(token => token.kind !== 'comment');
  // 下一待处理词法单元的位置。
  let cursor = 0;
  // 递归处理有限深度的数据结构，避免极深输入耗尽调用栈。
  const read = (depth: number): DataNode => {
    if (depth > 128) throw new DataError('error.depth');
    // 当前扫描到的原始数据单元。
    const token = tokens[cursor++];
    if (!token) throw new DataError('error.truncated');
    // 保留源范围的数据节点。
    const node: DataNode = {kind: 'atom', start: token.start, end: token.end, raw: token.raw, children: [], entries: []};
    if (token.raw === '{' || token.raw === '[') {
      node.kind = token.raw === '{' ? 'object' : 'array';
      // 当前结构对应的闭合括号。
      const close = node.kind === 'object' ? '}' : ']';
      while (tokens[cursor]?.raw !== close) {
        if (node.kind === 'object') {
          // 当前属性的原始键，保留引号形式和源位置。
          const key = tokens[cursor++];
          if (!key || !['string', 'atom'].includes(key.kind)) throw new DataError('error.key');
          keyName(key);
          if (tokens[cursor++]?.raw !== ':') throw new DataError('error.colon');
          node.entries.push({key, value: read(depth + 1)});
        } else node.children.push(read(depth + 1));
        if (tokens[cursor]?.raw === close) break;
        if (tokens[cursor++]?.raw !== ',') throw new DataError('error.comma');
        if (!tokens[cursor]) throw new DataError('error.truncated');
      }
      // 当前结构的闭合标记位置。
      const ending = tokens[cursor++];
      if (!ending) throw new DataError('error.truncated');
      node.end = ending.end;
      node.raw = source.slice(node.start, node.end);
    } else if (token.kind === 'string') {
      decodeString(token.raw); node.kind = 'string';
    } else if (!['true', 'false', 'null'].includes(token.raw) && !NUMBER.test(token.raw)) {
      throw new DataError('error.unsupported', {value: token.raw.slice(0, 40)});
    } else if (NUMBER.test(token.raw) && /^[-+]?0\d/.test(token.raw)) {
      throw new DataError('error.leadingZero');
    }
    return node;
  };
  // 本次处理的结果，用于后续应用或验收。
  const result = read(0);
  if (cursor !== tokens.length) throw new DataError('error.multiple');
  return result;
}

/** 仅重排 token 间的空白；可处理语法损坏但括号完整的 JSON-like 文本 */
export function layout(source: string, indent: string, compactArrays = false, incomplete = false): string {
  // 结构 token 与格式化后的行片段。
  const tokens = tokenize(source, incomplete);
  // 按缩进整理后的输出行。
  const lines: string[] = [];
  // 结构括号的匹配栈。
  const stack: string[] = [];
  // 当前输出行的排版缓存。
  let line = '';
  // 数据嵌套深度，用于缩进及上限校验。
  let depth = 0;
  // 提交当前排版行并清空缓存。
  const flush = (): void => {
    if (line.trim()) lines.push(indent.repeat(depth) + line.trimStart());
    line = '';
  };
  // 当前单元在输入序列中的位置。
  for (let index = 0; index < tokens.length; index++) {
    // 当前扫描到的原始数据单元。
    const token = tokens[index];
    // 下一数据单元，用于决定空白布局。
    const next = tokens[index + 1];
    if (token.incomplete) {
      // 不完整尾部原样保留，不能把字符串内空白当作布局空白。
      line += token.raw;
      lines.push(indent.repeat(depth) + line);
      line = '';
    } else if (token.kind === 'comment') {
      if (line) line += ' ';
      line += token.raw;
      flush();
    } else if (token.raw === '{' || token.raw === '[') {
      // 当前结构对应的闭合括号。
      const close = token.raw === '{' ? '}' : ']';
      // 是否保持简单数组或计算属性为单行。
      const flat = token.raw === '[' && (() => {
        // 计算属性保持单行；普通数组仅在用户启用紧凑样式时扫描。
        if (next?.kind === 'string' && tokens[index + 2]?.raw === ']' && tokens[index + 3]?.raw === ':') return true;
        if (!compactArrays) return false;
        // 简单数组检测的位置。
        for (let position = index + 1; position < tokens.length; position++) {
          // 当前需要核验或处理的数据项。
          const item = tokens[position];
          if (item.raw === ']') return true;
          if (item.kind === 'comment' || ['{', '['].includes(item.raw)) return false;
        }
        return false;
      })();
      stack.push(flat ? 'flat' : close);
      line += token.raw;
      if (next?.raw !== close && !flat) {flush(); depth++;}
    } else if (token.raw === '}' || token.raw === ']') {
      // 当前数组或对象的布局方式。
      const mode = stack.pop();
      if (mode !== 'flat' && mode !== token.raw) throw new DataError('error.truncated');
      if (tokens[index - 1]?.raw !== (token.raw === '}' ? '{' : '[') && mode !== 'flat') {flush(); depth = Math.max(0, depth - 1);}
      line += token.raw;
    } else if (token.raw === ',') {
      line += ',';
      if (stack.at(-1) === 'flat') line += ' '; else flush();
    } else if (token.raw === ':') line += ': ';
    else {
      if (line && !/[\s[{:]$/.test(line)) line += ' ';
      line += token.raw;
    }
  }
  if (stack.length && !incomplete) throw new DataError('error.truncated');
  flush();
  // 与源文本比较所有 token，保证不更改字符串、数字和重复字段。
  const output = lines.join(source.includes('\r\n') ? '\r\n' : '\n');
  if (JSON.stringify(tokenize(source, incomplete).map(token => token.raw)) !== JSON.stringify(tokenize(output, incomplete).map(token => token.raw))) throw new DataError('error.preservation');
  return output;
}
