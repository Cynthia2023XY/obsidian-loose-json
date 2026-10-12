import {DataError, errorDiagnostic, type Diagnostic} from '../i18n';
import {parseData, tokenize} from './syntax';

/** 带原范围与虚拟包装信息的数据候选；检测不依赖排版是否改变 */
export interface Candidate {from: number; to: number; source: string; parsed: string; kind: 'value' | 'properties' | 'log'; trailing: boolean; complete: boolean; label: string; role?: 'request' | 'response'}
/** 同一目标内检测到的数据与独立诊断 */
export interface Detection {candidates: Candidate[]; diagnostics: Diagnostic[]}
/** 两位与四位年份均可标识新日志记录 */
export const RECORD_START = /^\s*(?:\d{4}|\d{2})-\d{2}-\d{2}[. T]\d{2}:\d{2}:/;

/** 在词法状态下确定最外层范围，不越过下一条明确日志 */
export function structureRange(source: string, start: number): {end: number; complete: boolean} {
  // 开括号栈与字符串/注释状态。
  const stack: string[] = [];
  // 当前字符串引号，防止把文本里的括号当结构。
  let quote = '';
  // 当前注释状态，保护注释中的日志标记。
  let comment = '';
  for (let i = start; i < source.length; i++) {
    // 当前字符与其记录边界。
    const char = source[i];
    if (char === '\n' && !quote && comment !== '/*' && RECORD_START.test(source.slice(i + 1, i + 40))) return {end: i, complete: false};
    if (comment === '//') {if (char === '\n' || char === '\r') comment = ''; continue;}
    if (comment === '/*') {if (source.startsWith('*/', i)) {comment = ''; i++;} continue;}
    if (quote) {
      if (char === '\\') {i++; if (source[i] === '\r' && source[i + 1] === '\n') i++; continue;}
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {quote = char; continue;}
    if (source.startsWith('//', i) || source.startsWith('/*', i)) {comment = source.slice(i, i + 2); i++; continue;}
    if (char === '{' || char === '[') {
      if (stack.length >= 128) throw new DataError('error.depth');
      stack.push(char === '{' ? '}' : ']');
    } else if (char === '}' || char === ']') {
      if (stack.pop() !== char) return {end: i + 1, complete: false};
      if (!stack.length) return {end: i + 1, complete: true};
    }
  }
  return {end: source.length, complete: false};
}

/** 判断赋值标签的常见角色，只是展示建议，不跨记录配对 */
function role(label: string): Candidate['role'] {return /(?:response|output|resp)$/i.test(label) ? 'response' : /(?:request|input|query|req)$/i.test(label) ? 'request' : undefined;}

/** 从完整数据、属性片段或日志中识别转换候选 */
export function detect(source: string, partial = false): Detection {
  // 去外围空白但保留真实源偏移。
  const trimmed = source.trim();
  // 候选在来源中的起点，用于准确写回。
  const from = source.indexOf(trimmed);
  // 保留输入上下文的候选构造器。
  const candidate = (parsed: string, kind: Candidate['kind'], trailing = false): Candidate => ({from, to: from + trimmed.length, source: trimmed, parsed, kind, trailing, complete: true, label: ''});
  try {parseData(trimmed); return {candidates: [candidate(trimmed, 'value')], diagnostics: []};} catch { /* 尝试受控的上下文归一化。 */ }
  if (trimmed.endsWith(',')) {
    try {parseData(trimmed.slice(0, -1)); return {candidates: [candidate(trimmed.slice(0, -1), 'value', true)], diagnostics: []};} catch { /* 不是完整的对象项片段。 */ }
  }
  try {
    // 虚拟包装仅用于属性解析，不写入用户原文。
    const wrapped = `{${trimmed.replace(/,\s*$/, '')}}`;
    if (parseData(wrapped).entries.length) return {candidates: [candidate(wrapped, 'properties', trimmed.endsWith(','))], diagnostics: []};
  } catch { /* 接下来识别日志片段。 */ }
  // 明确的属性片段若损坏，不可退化为提取其中的子对象而丢失属性。
  if (/^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[$_\p{ID_Start}][$_\p{ID_Continue}]*)\s*:/u.test(trimmed)) return {candidates: [], diagnostics: [{code: 'error.incompleteValue'}]};
  // 只在最外层扫描，嵌套属性不成为独立候选。
  const result: Detection = {candidates: [], diagnostics: []};
  // 当前字符串引号，防止把文本里的括号当结构。
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    // 普通日志中的字符串保护与赋值标签。
    const char = source[i];
    if (quote) {if (char === '\\') i++; else if (char === quote || char === '\n') quote = ''; continue;}
    if (char === '=' && !/[=<>!]/.test(source[i - 1] ?? '')) {
      // 只有明确赋值标签后的标量才能从日志中提取。
      const label = source.slice(Math.max(0, i - 120), i).match(/([A-Za-z_$][\w$]*)\s*$/)?.[1];
      // 赋值符后的文本，用于检测明确标量。
      const tail = source.slice(i + 1);
      // 已匹配的标量文本和源范围。
      const value = tail.match(/^\s*(null|true|false|[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)(?=\s*(?:[,;|\r\n]|$))/);
      if (label && value) {
        // 标量真实起点，不改写日志标签。
        const offset = i + 1 + value[0].indexOf(value[1]);
        result.candidates.push({from: offset, to: offset + value[1].length, source: value[1], parsed: value[1], kind: 'log', trailing: false, complete: true, label, role: role(label)});
        i = offset + value[1].length - 1;
        continue;
      }
    }
    if (char === '"' || (char === "'" && !/\w/.test(source[i - 1] ?? ''))) {quote = char; continue;}
    if (char !== '{' && char !== '[') continue;
    // 当前结构的可靠边界和完整状态。
    const range = structureRange(source, i);
    // 结构范围内的原始数据文本。
    const raw = source.slice(i, range.end);
    // 保留业务标签用于识别入参或出参。
    const label = source.slice(Math.max(0, i - 140), i).match(/([A-Za-z_$][\w$]*)\s*=\s*$/)?.[1] ?? '';
    try {
      if (range.complete) parseData(raw);
      else if (!partial || !tokenize(raw, true).some(token => token.raw === ':' || token.raw === ',')) throw new DataError('error.truncated');
      result.candidates.push({from: i, to: range.end, source: raw, parsed: raw, kind: label || i !== from || range.end !== from + trimmed.length ? 'log' : 'value', trailing: false, complete: range.complete, label, role: role(label)});
    } catch (error) {
      if (char === '{' || !range.complete) result.diagnostics.push({code: 'diagnostic.at', params: {location: String(i + 1)}, cause: errorDiagnostic(error)});
    }
    i = range.end - 1;
  }
  return result;
}
