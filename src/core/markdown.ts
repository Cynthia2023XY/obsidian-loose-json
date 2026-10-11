/** 源文档中的半开区间 */
export interface Range {from: number; to: number}
/** 带源范围与容器缩进的 fenced code block */
export interface CodeBlock extends Range {bodyFrom: number; bodyTo: number; language: string; content: string; prefix: string; line: number; supported: boolean; eol: string}

/** 属性区未闭合时保护整篇输入，不将其中的围栏或对象当作正文 */
function frontmatterEnd(source: string): number {
  if (!/^\uFEFF?---\r?\n/.test(source)) return 0;
  // 仅匹配属性区专用的关闭行。
  const section = source.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  return section?.[0].length ?? source.length;
}

/** 解析反引号或波浪线围栏，保留引用与列表容器 */
export function codeBlocks(source: string): CodeBlock[] {
  // 行偏移以及已定位的完整代码块。
  const rows = source.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
  // 起始属性区禁止参与代码块定位。
  const metadataEnd = frontmatterEnd(source);
  // 本次处理的结果，用于后续应用或验收。
  const result: CodeBlock[] = [];
  // 当前行在原文中的字符偏移。
  let offset = 0;
  // 待闭合代码围栏的源位置与容器信息。
  let opening: {from: number; bodyFrom: number; marker: string; language: string; prefix: string; line: number} | null = null;
  // 剥离容器缩进后的代码块内容。
  let contents: string[] = [];
  // 代码块能否可靠映射回源文本。
  let supported = true;
  // 当前输出行的排版缓存。
  for (let line = 0; line < rows.length; line++) {
    // 当前源文本行及其换行符。
    const row = rows[line];
    if (offset < metadataEnd) {offset += row.length; continue;}
    // 去掉行末换行符后的原始行。
    const bare = row.replace(/\r?\n$/, '');
    if (opening) {
      // 移除容器前缀后的可处理内容。
      const stripped = bare.startsWith(opening.prefix) ? bare.slice(opening.prefix.length) : bare.trim() === '' ? '' : null;
      // 与起始围栏相匹配的关闭标记。
      const closing = stripped?.match(/^(`{3,}|~{3,})[ \t]*$/);
      if (closing && closing[1][0] === opening.marker[0] && closing[1].length >= opening.marker.length) {
        result.push({...opening, to: offset + row.length, bodyTo: offset, language: opening.language, content: contents.join(source.includes('\r\n') ? '\r\n' : '\n'), supported, eol: source.includes('\r\n') ? '\r\n' : '\n'});
        opening = null; contents = [];
      } else {
        if (stripped === null) supported = false;
        contents.push(stripped ?? bare);
      }
    } else {
      // 源文本中符合目标语法的匹配项。
      const match = bare.match(/^((?:[ \t]*>[ \t]?)*[ \t]*)(?:([-+*]|\d+\.)[ \t]+)?(`{3,}|~{3,})([^`]*)$/);
      if (match) {
        // 围栏标记在容器前缀之后的位置。
        const markerIndex = bare.indexOf(match[3], match[1].length);
        // 引用或列表占用的代码块前缀。
        const container = bare.slice(0, markerIndex);
        // 需要在修改后恢复的原始缩进。
        const prefix = match[2] ? container.replace(/([-+*]|\d+\.)([ \t]+)$/, item => ' '.repeat(item.length)) : container;
        opening = {from: offset, bodyFrom: offset + row.length, marker: match[3], language: match[4].trim().split(/\s/)[0].toLowerCase(), prefix, line};
        supported = true;
      }
    }
    offset += row.length;
  }
  // 未闭合围栏作为保护区，不允许文档扫描误改其中的数据。
  if (opening) result.push({...opening, to: source.length, bodyTo: source.length, content: contents.join('\n'), supported: false, eol: '\n'});
  return result;
}

/** 将排版后的裸内容放回原有引用或列表代码块 */
export function blockBody(block: CodeBlock, content: string): string {
  return content.split(/\r?\n/).map(line => block.prefix + line).join(block.eol) + block.eol;
}

/** 获取普通 Markdown 中可扫描的范围，保护 YAML、代码、链接与 HTML */
export function proseRanges(source: string, blocks = codeBlocks(source)): Range[] {
  // 遮罩仅标记保护区，不把不相邻范围连接成虚假 JSON。
  const protectedRanges: Range[] = blocks.map(block => ({from: block.from, to: block.to}));
  // 文档开头的 YAML 属性保护区。
  const metadataEnd = frontmatterEnd(source);
  if (metadataEnd) protectedRanges.push({from: 0, to: metadataEnd});
  // 需要保护的 Markdown 链接或 HTML 结构。
  const pattern = /!?\[[^\]\n]*\]\([^\n]*?\)|\[\[[^\]\n]*\]\]|<!--[\s\S]*?-->|<[^>\n]*>/g;
  // 源文本中符合目标语法的匹配项。
  for (const match of source.matchAll(pattern)) protectedRanges.push({from: match.index, to: match.index + match[0].length});
  // 行内代码允许较短反引号出现在内容中，关闭标记必须长度完全相同。
  const backticks = [...source.matchAll(/`+/g)];
  // 当前单元在输入序列中的位置。
  for (let index = 0; index < backticks.length; index++) {
    // 待闭合代码围栏的源位置与容器信息。
    const opening = backticks[index];
    // 当前结构的闭合标记位置。
    // 向前寻找匹配标记，不反复扫描已经保护的文档前缀。
    let ending = -1;
    // 从当前开标记之后寻找长度完全相同的闭合标记。
    for (let next = index + 1; next < backticks.length; next++) {
      if (backticks[next][0].length === opening[0].length) {ending = next; break;}
    }
    if (ending !== -1) {
      protectedRanges.push({from: opening.index, to: backticks[ending].index + backticks[ending][0].length});
      index = ending;
    }
  }
  protectedRanges.sort((a, b) => a.from - b.from);
  // 去掉保护区后允许扫描的范围。
  const ranges: Range[] = [];
  // 下一待处理词法单元的位置。
  let cursor = 0;
  // 当前允许处理的源范围。
  for (const range of protectedRanges) {
    if (range.from > cursor) ranges.push({from: cursor, to: range.from});
    cursor = Math.max(cursor, range.to);
  }
  if (cursor < source.length) ranges.push({from: cursor, to: source.length});
  return ranges;
}
