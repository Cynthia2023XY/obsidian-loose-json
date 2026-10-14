import {describe, expect, it} from 'vitest';
import {javascriptCandidates, repairCandidates, extractCandidates} from '../src/core/conversion';
import {fragmentPlan, documentPlan, applyChanges} from '../src/core/engine';
import {tokenize} from '../src/core/syntax';
import {codeBlocks, fencedLog, generatedBlocks} from '../src/core/markdown';
import {resolveLocale, translator, describe as message} from '../src/i18n';

/** 不含真实接口数据的多段日志样例 */
const logs = '26-10-10.17:16:05.109 | INFO | request={"id":9223372036854775807,"name":"demo"}, response=null\n2026-10-11T09:30:00 | request={"next":true}';
describe('context-aware conversion', () => {
  it('retains property names and external separators while offering a complete object', () => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = javascriptCandidates('"deviceInfo": {"appType":"0"},').candidates[0];
    expect(output.text).toBe("deviceInfo: {\n  appType: '0'\n},");
    expect(output.object).toBe("{\n  deviceInfo: {\n    appType: '0'\n  }\n}");
    expect(javascriptCandidates('{"a":1},').candidates[0].text).toBe('{\n  a: 1\n},');
  });
  it('supports multiple properties without silently dropping keys', () => {
    expect(javascriptCandidates('"a":1,"b":{"x":"y"}').candidates[0].text).toContain("b: {\n  x: 'y'");
    expect(javascriptCandidates('"a":{"x":1}, "b":').candidates).toHaveLength(0);
  });
  it('detects outer log candidates in order including a null response', () => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = javascriptCandidates(logs);
    expect(output.candidates.map(item => [item.label, item.role])).toEqual([['request', 'request'], ['response', 'response'], ['request', 'request']]);
    expect(output.candidates[0].text).toContain('9223372036854775807');
    expect(output.candidates[0].warnings[0].code).toBe('warning.integer');
    expect(output.candidates[1].text).toBe('null');
  });
  it('keeps formatted candidates, protects quoted log text and excludes nested objects', () => {
    expect(extractCandidates('request={\n  "a": 1\n}').candidates).toHaveLength(1);
    expect(extractCandidates('message="{fake:1}" request={"child":{"a":1}}').candidates).toHaveLength(1);
  });
  it.each(['null', 'true', '123', '"hello"'])('accepts explicitly selected scalar %s', source => {
    expect(javascriptCandidates(source).candidates).toHaveLength(1);
  });
  it('retains duplicate and prototype keys safely in generated JS', () => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = javascriptCandidates('{"a":1,"a":2,"__proto__":{"v":1}}').candidates[0];
    expect(output.warnings.some(item => item.code === 'warning.duplicate')).toBe(true);
    expect(output.text).toContain("['__proto__']");
  });
});
describe('bounded strict JSON repair', () => {
  it('closes only completed values and preserves large integer tokens', () => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = repairCandidates('{id:9223372036854775807, items:[1,2,').candidates[0];
    expect(output.text).toContain('9223372036854775807');
    expect(JSON.parse(output.text).items).toEqual([1,2]);
    expect(output.warnings.some(item => item.code === 'repair.closing' && item.params?.count === 2)).toBe(true);
  });
  it.each(['{"a":', '{"a":"half', '{"a":1e', '{"a":true,"b":', '{"a":1]'])('does not invent missing data for %s', source => {
    expect(repairCandidates(source).candidates).toHaveLength(0);
  });
  it('normalizes JSON5 strings, comments and hex without erasing duplicates', () => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = repairCandidates("{a:0x20000000000001,a:+.5,/*comment*/ b:'demo',}").candidates[0];
    expect(output.text).toContain('9007199254740993');
    expect(output.text).toContain('0.5');
    expect(output.text.match(/"a"/g)).toHaveLength(2);
    expect(output.warnings.some(item => item.code === 'repair.comments')).toBe(true);
  });
  it('preserves the sign of JSON5 hexadecimal negative zero', () => {
    // 修复不得因为整数转换丢掉负零的可观察语义。
    const output = repairCandidates('{value:-0x0}').candidates[0];
    expect(Object.is(JSON.parse(output.text).value, -0)).toBe(true);
  });
  it.each(['{a:NaN}', '{a:Infinity}', '{a:-Infinity}'])('rejects lossy strict JSON conversion %s', source => {
    // 生成结果，用于检查复制形态及数据保持。
    const output = repairCandidates(source);
    expect(output.candidates).toHaveLength(0);
    expect(output.diagnostics.some(item => item.code === 'error.nonfinite')).toBe(true);
  });
  it('repairs full property lists and reports removed log context', () => {
    expect(repairCandidates('"a":1,').candidates[0].warnings.some(item => item.code === 'repair.wrapper')).toBe(true);
    expect(repairCandidates('log request={a:1}').candidates[0].warnings.some(item => item.code === 'repair.extracted')).toBe(true);
  });
});
describe('incomplete formatting and record recovery', () => {
  it.each(['{"a":{"b":1},"c":[2,3,', '{"a":"unfinished  ', '{"a":1, /* unfinished  ', '[1'])('preserves every raw token in %s', source => {
    // 当前来源的修改范围与跳过诊断。
    const plan = fragmentPlan(source, undefined, true);
    expect(plan.changes).toHaveLength(1);
    // 应用排版后的文本，用于核验原始 token。
    const formatted = applyChanges(source, plan.changes);
    expect(tokenize(formatted, true).map(token => token.raw)).toEqual(tokenize(source, true).map(token => token.raw));
    expect(plan.changes[0].warningCode?.code).toBe('warning.partial');
  });
  it('recovers after a two-digit-year record while leaving truncated document data untouched', () => {
    // 不含真实接口信息的回归测试输入。
    const source = '26-10-10.17:10:00 request={"a":1\n26-10-10.17:11:00 response={"b":2}';
    // 当前来源的修改范围与跳过诊断。
    const plan = documentPlan(source);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.changes).toHaveLength(1);
    expect(applyChanges(source, plan.changes)).toContain('request={"a":1\n26-10-10.17:11:00 response={\n');
  });
});
describe('interface language', () => {
  it('uses Obsidian language unless explicitly overridden', () => {
    expect(resolveLocale('system','zh-TW')).toBe('zh');
    expect(resolveLocale('system','de')).toBe('en');
    expect(resolveLocale('en','zh')).toBe('en');
  });
  it('renders stable diagnostics and command names in English', () => {
    // 当前语言的翻译器。
    const t = translator('en');
    expect(t('commands.javascript')).toBe('Copy as JavaScript');
    expect(t('button.title')).toBe('Format this JSON block');
    expect(message({code:'diagnostic.at', params:{location:'5'}, cause:{code:'error.truncated'}}, t)).toBe('5: Truncated structure or mismatched brackets');
  });
});

describe('generated code blocks', () => {
  it('preserves quote/list prefixes, CRLF and backticks within data', () => {
    // 数据中的反引号不能提前闭合生成围栏。
    const text = '{"value":"````"}';
    // 生成结果仍应被标准来源扫描器可靠定位。
    const generated = generatedBlocks([{text, label: 'request'}, {text: 'null', label: 'response'}], '>   ', '\r\n');
    expect(generated).toContain('>   `````json\r\n');
    expect(codeBlocks(generated).map(block => block.content)).toEqual([text, 'null']);
    expect(codeBlocks(generated).every(block => block.supported)).toBe(true);
  });
});


describe('原位置日志代码块', () => {
  it('只选中 JSON 时围栏仍与选区外的日志前后缀隔开', () => {
    // 用户只选中对象本体，日志标签与后缀位于选区外。
    const source = '{"a":1}';
    // 检测和拼接仍绑定原始源范围。
    const items = extractCandidates(source).candidates;
    expect(fencedLog(source, items, '\n', {before: '=', after: ';'})).toBe('\n```json\n' + items[0].text + '\n```\n');
  });
  it('保留两条日志的完整前后缀及顺序，不添加标题', () => {
    // 模拟同类业务日志，不使用真实账号或令牌。
    const source = '26-10-13.14:20:29.523 [T-1] INFO 请求 CheckMissionWidgetRequest={"id":9223372036854775807,"risk":{"text":"} ["}}\n26-10-13.14:20:29.524 [T-1] INFO 转化后的请求{"a":2}';
    // 使用实际检测器获取原文偏移，不能重新通过正则猜测位置。
    const items = extractCandidates(source).candidates;
    // 输出仅替换两个 JSON 范围，其余内容逐字保留。
    const result = fencedLog(source, items);
    expect(result).toBe('26-10-13.14:20:29.523 [T-1] INFO 请求 CheckMissionWidgetRequest=\n```json\n' + items[0].text + '\n```\n\n26-10-13.14:20:29.524 [T-1] INFO 转化后的请求\n```json\n' + items[1].text + '\n```');
    expect(result).not.toContain('入参 ·');
    expect(codeBlocks(result).map(block => block.content)).toEqual(items.map(item => item.text));
    expect(result).toContain('9223372036854775807');
  });
  it('同一行多个候选、标量和尾部文字保留，未选中候选不变', () => {
    // 一条记录同时含入参、出参和完成说明。
    const source = 'INFO request={"a":1}, response=null; finished';
    // 每个候选保留真实范围。
    const items = extractCandidates(source).candidates;
    expect(fencedLog(source, items)).toBe('INFO request=\n```json\n' + items[0].text + '\n```\n, response=\n```json\nnull\n```\n; finished');
    expect(fencedLog(source, [items[0]])).toContain(', response=null; finished');
  });
  it('保留 CRLF、字符串内反引号，损坏候选不修改且拒绝过期范围', () => {
    // 反引号数量要求生成更长围栏，CRLF 不能被统一成 LF。
    const source = 'INFO data={"value":"````"}\r\nnext record';
    // 候选来自真实检测结果。
    const items = extractCandidates(source).candidates;
    // 生成结果保持原始换行风格。
    const result = fencedLog(source, items, '\r\n');
    expect(result).toContain('`````json\r\n');
    expect(result.replace(/\r\n/g, '')).not.toContain('\n');
    expect(codeBlocks(result)).toHaveLength(1);
    expect(() => fencedLog('changed'+source, items)).toThrow();
    expect(() => fencedLog(source, [items[0], items[0]])).toThrow();
    expect(fencedLog('INFO request={"a":', extractCandidates('INFO request={"a":').candidates)).toBe('INFO request={"a":');
  });
});
