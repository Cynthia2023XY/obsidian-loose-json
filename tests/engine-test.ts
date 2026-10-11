import {describe, expect, it} from 'vitest';
import {applyChanges, decodePlan, DEFAULT_OPTIONS, documentPlan, fragmentPlan, javascriptLiteral} from '../src/core/engine';
import {blockBody, codeBlocks, proseRanges} from '../src/core/markdown';
import {layout, parseData, tokenize} from '../src/core/syntax';

describe('宽松排版的原文保持契约', () => {
  it('保留大整数、小数原文、重复字段和字符串中的标点', () => {
    // 超大整数不能通过 JS Number 重新序列化。
    const source = '{"id":9223372036854775807,"price":0.00,"id":1,"text":"} [ \\\""}';
    // 本次处理的结果，用于后续应用或验收。
    const result = layout(source, '  ');
    expect(tokenize(result).map(token => token.raw)).toEqual(tokenize(source).map(token => token.raw));
    expect(result).toContain('9223372036854775807');
    expect(result).toContain('0.00');
    expect(layout(result, '  ')).toBe(result);
  });
  it('支持注释、单引号、尾逗号和无引号键', () => {
    // 注释内容及字段顺序保持原样。
    const source = "{a:'hi', /*说明*/ b:[1,2,], //行注释\n c:true,}";
    expect(parseData(source).entries).toHaveLength(3);
    expect(layout(source, '  ')).toContain("a: 'hi'");
    expect(tokenize(layout(source, '  ')).map(token => token.raw)).toEqual(tokenize(source).map(token => token.raw));
  });
  it('损坏但闭合的对象可显式排版，不修复缺失逗号', () => {
    // 自动日志模式跳过，用户 json 块的显式模式可预览。
    const source = '{"a":1 "b":2}';
    expect(fragmentPlan(source).changes).toHaveLength(0);
    // 按源位置规划的修改候选与跳过原因。
    const plan = fragmentPlan(source, DEFAULT_OPTIONS, true);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].warning).toBeTruthy();
    expect(() => parseData(plan.changes[0].after)).toThrow();
  });
  it('数组默认每项换行，可选紧凑数组', () => {
    expect(layout('[1,2,3]', '  ')).toBe('[\n  1,\n  2,\n  3\n]');
    expect(layout('[1,2,3]', '  ', true)).toBe('[1, 2, 3]');
    expect(layout('[]', '  ')).toBe('[]');
  });
  it('拒绝截断字符串与不匹配括号', () => {
    expect(() => layout('{"x":"oops}', '  ')).toThrow();
    expect(() => layout('{"x":1]', '  ')).toThrow();
    expect(() => parseData('{a:01}')).toThrow();
    expect(() => parseData('{a:fetch()}')).toThrow();
  });
});

describe('文档与日志片段识别', () => {
  it('保留时间戳、IP、URL、中文前缀与日志标签', () => {
    // 日志前缀不能进入 token 排版器。
    const prefix = '2026-10-08 15:59:55.931 | WARN | [JSF-BZ-1] | 11.247.172.117 | https://a.test/x | 调用结果 request=';
    // 用于验证本次行为的输入文本。
    const source = prefix + '{"a":1,"nested":{"text":"[ }"}}，response={"ok":true} 尾部';
    // 按源位置规划的修改候选与跳过原因。
    const plan = documentPlan(source);
    expect(plan.changes).toHaveLength(2);
    // 本次处理的结果，用于后续应用或验收。
    const result = applyChanges(source, plan.changes);
    expect(result.startsWith(prefix)).toBe(true);
    expect(result.endsWith(' 尾部')).toBe(true);
    expect(result).toContain('，response=');
  });
  it('保护 YAML、行内代码、链接和其他语言块', () => {
    // 保护区中的对象即使合法也不能被修改。
    const protectedText = '---\na: {"x":1}\n---\n`{"x":1}` [link](url/{"x":1})\n```js\n{"x":1}\n```\n';
    // 用于验证本次行为的输入文本。
    const source = protectedText + '```JSON\n{"a":1}\n```\n';
    // 按源位置规划的修改候选与跳过原因。
    const plan = documentPlan(source);
    expect(plan.changes).toHaveLength(1);
    expect(applyChanges(source, plan.changes).startsWith(protectedText)).toBe(true);
  });
  it('排除 [INFO] 与线程名；数组值仍可处理', () => {
    expect(fragmentPlan('[INFO] [JSF-12] [1,2]').changes).toHaveLength(1);
    expect(fragmentPlan('[INFO] [JSF-12]').skipped).toHaveLength(0);
  });
  it('截断记录在下一条明确日志处恢复，不格式化截断外层的子对象', () => {
    // 第一条记录缺少外层闭合括号。
    const source = '2026-10-08 10:00:00 request={"x":{"a":1}\n2026-10-08 10:00:01 response={"b":2}';
    // 按源位置规划的修改候选与跳过原因。
    const plan = fragmentPlan(source);
    expect(plan.skipped.length).toBeGreaterThan(0);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].before).toBe('{"b":2}');
  });
  it('超限输入失败，不生成部分修改', () => {
    expect(() => documentPlan('{"a":1}', {...DEFAULT_OPTIONS, maxBytes: 2})).toThrow('上限');
  });
  it('保留 CRLF、波浪线围栏和引用容器', () => {
    // 内容排版后重新注入引用前缀。
    const source = '> ~~~json\r\n> {"a":[1,2]}\r\n> ~~~\r\n';
    // 文档中已经可靠定位的 fenced 代码块。
    const blocks = codeBlocks(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].prefix).toBe('> ');
    // 本次处理的结果，用于后续应用或验收。
    const result = applyChanges(source, documentPlan(source).changes);
    expect(result).toContain('>   "a": [\r\n');
    expect(result.replace(/\r\n/g, '')).not.toContain('\n');
  });
  it('保留列表代码块和长围栏', () => {
    // 用于验证本次行为的输入文本。
    const source = '- ````json\n  {"a":1}\n  ````\n';
    // 当前操作所属的真实代码块。
    const block = codeBlocks(source)[0];
    expect(block.supported).toBe(true);
    expect(blockBody(block, '{\n  "a": 1\n}')).toBe('  {\n    "a": 1\n  }\n');
    expect(documentPlan(source).changes).toHaveLength(1);
  });
  it('未闭合代码围栏禁止文档扫描', () => {
    // 用于验证本次行为的输入文本。
    const source = '```json\n{"a":1}';
    expect(codeBlocks(source)[0].supported).toBe(false);
    expect(proseRanges(source)).toHaveLength(0);
    expect(documentPlan(source).changes).toHaveLength(0);
  });
  it('不更改有引号外围文本里的 JSON', () => {
    expect(fragmentPlan('text="{\\"a\\":1}"').changes).toHaveLength(0);
  });
});

describe('JS 字面量输出', () => {
  it('按需求转换字段与字符串并保留数值文本', () => {
    // 本次处理的结果，用于后续应用或验收。
    const result = javascriptLiteral('{"workItemTypes":["card","hotfix"],"keyword":"","stageIds":[10,30],"taskProcessorErp":"dingxinyi.2","id":9223372036854775807}');
    expect(result.text).toContain('workItemTypes: [');
    expect(result.text).toContain("'card'");
    expect(result.text).toContain("keyword: ''");
    expect(result.text).toContain('9223372036854775807');
    expect(result.warnings).toHaveLength(1);
  });
  it('保留特殊 key 的引号并转义撇号、路径与双引号', () => {
    // 本次处理的结果，用于后续应用或验收。
    const result = javascriptLiteral(JSON.stringify({'content-type': 'application/json', text: "it's \\ a \"quote\"\nnext"}));
    expect(result.text).toContain("'content-type': 'application/json'");
    expect(result.text).toContain("it\\'s");
    // 测试仅对生成的受控样例求值，产品本身绝不执行用户代码。
    expect(Function('return (' + result.text + ')')()).toEqual({'content-type': 'application/json', text: "it's \\ a \"quote\"\nnext"});
  });
  it('对 __proto__ 使用计算属性，保留重复字段并提醒', () => {
    // 本次处理的结果，用于后续应用或验收。
    const result = javascriptLiteral('{"__proto__":{"a":1},"x":1,"x":2}');
    // 已解码的文本或验收求值结果。
    const value = Function('return (' + result.text + ')')();
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(result.warnings.join('')).toContain('重复字段');
  });
  it('拒绝外围日志、函数或标量', () => {
    expect(() => javascriptLiteral('request={"x":1}')).toThrow();
    expect(() => javascriptLiteral('{x:()=>1}')).toThrow();
    expect(() => javascriptLiteral('123')).toThrow();
  });
});

describe('字符串化 JSON 字段转换', () => {
  it('选择源字段替换，不递归转新对象，不丢失大整数或重复 key', () => {
    // 用于验证本次行为的输入文本。
    const source = '{"data":"{\\"id\\":9223372036854775807,\\"id\\":1,\\"nested\\":\\"{}\\"}","path":"C:\\\\tmp","number":"123"}';
    // 按源位置规划的修改候选与跳过原因。
    const plan = decodePlan(source);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].label).toContain('/data');
    // 本次处理的结果，用于后续应用或验收。
    const result = applyChanges(source, plan.changes);
    expect(result).toContain('9223372036854775807');
    expect(result).toContain('"nested": "{}"');
    expect(result).toContain('"number":"123"');
    expect(result).toContain('"path":"C:\\\\tmp"');
  });
  it('区分重复字段、转义 Pointer 以及数组位置', () => {
    // 用于验证本次行为的输入文本。
    const source = '{"a/b":"{}","a/b":"[]","list":["{}"]}';
    // 按源位置规划的修改候选与跳过原因。
    const plan = decodePlan(source);
    expect(plan.changes).toHaveLength(3);
    expect(plan.changes[0].label).toContain('/a~1b');
    expect(plan.changes[1].from).not.toBe(plan.changes[0].from);
    expect(plan.changes[2].label).toContain('/list/0');
  });
  it('支持最多三层字符串编码以及根字符串选区', () => {
    // 用于验证本次行为的输入文本。
    const source = JSON.stringify(JSON.stringify(JSON.stringify('{"a":1}')));
    // 按源位置规划的修改候选与跳过原因。
    const plan = decodePlan(source);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].label).toContain('3 层');
    expect(decodePlan(JSON.stringify(source)).changes).toHaveLength(0);
  });
  it('默认拒绝内部 JSON5，显式开启后允许', () => {
    // 用于验证本次行为的输入文本。
    const source = JSON.stringify({data: "{a:'hello',}"});
    expect(decodePlan(source).changes).toHaveLength(0);
    expect(decodePlan(source, {...DEFAULT_OPTIONS, allowInnerJson5: true}).changes).toHaveLength(1);
  });
  it('非法转义和损坏响应不能改写', () => {
    expect(() => decodePlan('{"data":"\\uZZZZ"}')).toThrow();
    expect(() => decodePlan('{"data":"{}"')).toThrow();
  });
});

describe('应用快照与性能边界', () => {
  it('拒绝过期和重叠预览', () => {
    expect(() => applyChanges('new', [{from: 0, to: 3, before: 'old', after: 'x', label: ''}])).toThrow();
    expect(() => applyChanges('abcdef', [{from: 0, to: 3, before: 'abc', after: '', label: ''}, {from: 2, to: 4, before: 'cd', after: '', label: ''}])).toThrow();
  });
  it('扫描大批日志时保持全部前缀', () => {
    // 当前源文本行及其换行符。
    const row = '2026-10-08 12:00:00 [INFO] 11.247.172.117 data={"x":1}\n';
    // 用于验证本次行为的输入文本。
    const source = row.repeat(2000);
    // 按源位置规划的修改候选与跳过原因。
    const plan = documentPlan(source);
    expect(plan.changes).toHaveLength(2000);
    expect(applyChanges(source, plan.changes).match(/11\.247\.172\.117/g)).toHaveLength(2000);
  });
});

describe('排版与文档保护补充边界', () => {
  it('保留 CRLF 行注释和注释末尾的空格', () => {
    // 注释末尾空格属于原始 token，不能被布局器删除。
    const source = '{a:1, // comment  \r\nb:2}';
    expect(tokenize(layout(source, '  ')).map(token => token.raw)).toEqual(tokenize(source).map(token => token.raw));
    expect(layout(source, '  ')).toContain('// comment  \r\n');
  });
  it('支持字符串中的 CRLF 续行', () => {
    // JSON5 字符串的续行需要同时跨过 CR 和 LF。
    const source = "{a:'first\\\r\nsecond'}";
    expect(fragmentPlan(source).changes).toHaveLength(1);
  });
  it('保护包含短反引号的多反引号行内代码', () => {
    // 行内代码中的单反引号不应提前终止保护区。
    const source = '`` ` {"a":1} `` outside={"b":2}';
    expect(documentPlan(source).changes).toHaveLength(1);
    expect(documentPlan(source).changes[0].before).toBe('{"b":2}');
  });
  it('保护未闭合 YAML 和 YAML 中的围栏字符串', () => {
    expect(documentPlan('---\nvalue: {"a":1}').changes).toHaveLength(0);
    expect(documentPlan('---\nvalue: |\n  ```json\n  {"a":1}\n  ```\n---\n').changes).toHaveLength(0);
  });
  it('支持 Unicode 和转义字段名，JS 输出仍保留内容', () => {
    // 属性名可使用合法 Unicode 标识符或 JSON5 Unicode 转义。
    const result = javascriptLiteral('{名字:"hello",\\u0061:1}');
    expect(result.text).toContain('名字:');
    expect(result.text).toContain('a: 1');
  });
});
