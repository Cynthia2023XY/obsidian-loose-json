/** 界面支持的语言；JSON 和日志内容不参与翻译 */
export type Locale = 'zh' | 'en';
/** 本地设置中可选择的语言来源 */
export type Language = 'system' | 'zh' | 'en';
/** 文案模板参数，不包含运行代码 */
export type Params = Record<string, string | number>;
/** 核心与工作线程之间传递的诊断协议 */
export interface Diagnostic {code: string; params?: Params; cause?: Diagnostic}
/** 中英文文案集中管理，第一项中文、第二项英文 */
const TEXT: Record<string, readonly [string, string]> = {
  'button.format': ['格式化', 'Format'], 'button.title': ['格式化此 JSON 代码块', 'Format this JSON block'],
  'cancel': ['取消', 'Cancel'], 'processing': ['正在本地处理…', 'Processing locally…'],
  'preview': ['修改预览', 'Review changes'], 'apply': ['应用选中修改', 'Apply selected changes'],
  'selectAll': ['全选', 'Select all'], 'selectNone': ['全不选', 'Deselect all'], 'more': ['再显示 50 项', 'Show 50 more'],
  'before': ['修改前', 'Before'], 'after': ['修改后', 'After'],
  'previewCount': ['{changes} 项修改；{skipped} 项跳过。默认全部选中，每批展示 50 项。', '{changes} changes; {skipped} skipped. All selected by default; 50 shown per batch.'],
  'selectRequired': ['请选择至少一项', 'Select at least one item'], 'details': ['查看详情', 'View details'],
  'documentWarning': ['注意⚠️：全文格式化会直接修改当前 Markdown 文档中识别到的 JSON 片段。复杂文档中可能影响原有布局；应用后可撤销。可在设置中关闭本预览，关闭后直接应用可处理片段。', 'Document formatting changes detected JSON fragments in this Markdown note and may affect complex layouts. You can undo the changes. Disable this preview in settings to apply valid changes directly.'],
  'previewSettings': ['打开预览设置', 'Open preview settings'], 'file': ['文件：{name}', 'File: {name}'],
  'diagnostics': ['处理诊断', 'Processing details'], 'applied': ['已应用 {count} 项修改', 'Applied {count} changes'],
  'skippedCount': ['{count} 项已跳过，可运行“查看上次处理诊断”。', '{count} items skipped. Run “View last processing details” for more information.'],
  'none': ['没有可修改的 JSON，或内容已经排版', 'No JSON changes found, or already formatted'],
  'partialNotice': ['已排版，内容仍不完整；没有补齐或删除数据', 'Formatted incomplete content without adding or removing data'],
  'copied': ['已复制', 'Copied'], 'copyFailed': ['复制失败，请手动选择结果文本', 'Copy failed. Select the result text manually.'],
  'jsTitle': ['复制为 JavaScript', 'Copy as JavaScript'], 'jsHint': ['原笔记不变。选择结果形态后复制到 JS/TS 中。', 'Your note is unchanged. Choose a result shape and copy into JS/TS.'],
  'shape.auto': ['自动（保留片段形态）', 'Automatic (preserve fragment shape)'], 'shape.object': ['完整数据值/对象', 'Complete value/object'], 'shape.properties': ['属性片段', 'Property fragment'],
  'copy': ['复制结果', 'Copy result'], 'repairTitle': ['修复为严格 JSON', 'Repair to strict JSON'],
  'extractPreview': ['完整日志结果（保留外围文本）', 'Full log result (surrounding text preserved)'],
  'extractHint': ['将选中的 JSON 在原位置格式化并包成独立代码块，保留日志前后文本和顺序。不额外添加标题；应用后可一次撤销。', 'Format selected JSON into code blocks at its original position, preserving surrounding log text and order. No extra titles are added. Undo restores the original logs.'],
  'extractTitle': ['提取日志 JSON 为代码块', 'Extract log JSON into code blocks'],
  'conversionHint': ['默认生成副本，插入会保留原文。“替换”可能移除日志外围文本；请检查原文、结果及修改摘要。', 'Insert keeps the original text. Replace may remove surrounding log text. Review the original, results, and repair summaries.'],
  'original': ['原始目标文本', 'Original target text'], 'insert': ['插入为独立 JSON 代码块', 'Insert separate JSON blocks'], 'replace': ['替换当前目标', 'Replace current target'],
  'request': ['入参', 'Request'], 'response': ['出参', 'Response'], 'fragment': ['片段 {index}', 'Fragment {index}'],
  'commands.block': ['格式化 JSON 代码块或选区', 'Format JSON block or selection'],
  'commands.document': ['格式化当前文档中的 JSON', 'Format JSON fragments in this document'],
  'commands.javascript': ['复制为 JavaScript', 'Copy as JavaScript'],
  'commands.decode': ['将字符串化 JSON 字段转为对象', 'Decode stringified JSON fields'],
  'commands.repair': ['修复为严格 JSON', 'Repair to strict JSON'],
  'commands.extract': ['提取日志 JSON 为代码块', 'Extract log JSON into code blocks'],
  'commands.details': ['查看上次处理诊断', 'View last processing details'],
  'commands.sample': ['生成示例笔记', 'Create sample note'],
  'sample.created': ['已生成示例笔记：{path}', 'Sample note created: {path}'],
  'sample.failed': ['示例笔记创建或状态保存失败，可稍后运行“生成示例笔记”重试；已有笔记不会被覆盖。', 'Could not create the sample note or save its status. Try Create sample note later; existing notes are never overwritten.'],
  'setting.language': ['界面语言', 'Interface language'], 'setting.system': ['跟随 Obsidian', 'Use Obsidian language'],
  'setting.languageHint': ['按钮与后续窗口立即更新；命令名称重新启用插件后更新，快捷键保持。', 'Buttons and new dialogs update immediately. Re-enable the plugin to refresh command names; hotkeys are kept.'],
  'setting.indent': ['缩进', 'Indentation'], 'setting.spaces': ['{count} 空格', '{count} spaces'],
  'setting.unlabelledButtons': ['在未声明语言的代码块中展示格式化按钮', 'Show format buttons in unlabelled code blocks'],
  'setting.unlabelledButtonsHint': ['默认开启。关闭后，仅在明确声明为 json 的代码块中展示格式化按钮；不影响命令面板操作。', 'Enabled by default. Disable to show format buttons only in code blocks explicitly labelled json. Command palette actions are unaffected.'],
  'setting.buttons': ['代码块格式化按钮', 'Code block format buttons'],
  'setting.compact': ['简单数组保持单行', 'Keep simple arrays on one line'], 'setting.compactHint': ['关闭时数组每项换行。', 'Otherwise, each array item uses a separate line.'],
  'setting.inner': ['允许内部字符串使用 JSON5', 'Allow JSON5 in stringified fields'], 'setting.innerHint': ['默认要求内部内容是严格 JSON。', 'Inner content must be strict JSON by default.'],
  'setting.limit': ['处理上限（MiB）', 'Processing limit (MiB)'], 'setting.limitHint': ['0.1–10 MiB，大文本可选择片段处理。', '0.1–10 MiB. Select smaller fragments for large notes.'],
  'setting.previewDocument': ['全文格式化前预览', 'Preview document formatting'],
  'setting.previewDocumentHint': ['关闭后直接应用可处理片段；跳过项通过诊断查看。', 'When disabled, valid changes apply directly; skipped items remain available in processing details.'],
  'setting.previewDecode': ['字符串化字段转换前预览', 'Preview stringified field conversion'],
  'setting.previewDecodeHint': ['关闭后转换当前目标全部可识别字段。字段类型会改变，不递归转换新对象的字符串。', 'When disabled, all recognized fields in the target are converted. This changes data types; newly exposed strings are not decoded recursively.'],
  'setting.previewJs': ['复制 JavaScript 前预览', 'Preview JavaScript before copying'],
  'setting.previewJsHint': ['关闭后唯一结果直接复制；多候选仍需选择。修复与拆块始终预览。', 'When disabled, a unique result copies directly. Multiple candidates still require selection. Repair and extraction always require review.'],
  'error.generic': ['处理失败', 'Processing failed'], 'error.syntax': ['无法解析：{detail}', 'Cannot parse: {detail}'],
  'error.cancelled': ['已取消', 'Cancelled'], 'error.worker': ['后台处理失败：{detail}', 'Background processing failed: {detail}'],
  'error.limit': ['目标超过处理上限，请选择较小片段或调整设置', 'Target exceeds the processing limit. Select less text or change the limit.'],
  'error.target': ['请选择文本，或将光标放在 json/无语言代码块中', 'Select text or place the cursor in a JSON/unlabelled code block'],
  'error.fence': ['选区跨越围栏，请仅选择内容或使用全文命令', 'Selection crosses a fence. Select its content or use the document command'],
  'error.container': ['围栏或容器无法可靠定位', 'Cannot reliably locate this fence or container'],
  'error.stale': ['目标内容已改变，请重新运行命令', 'Target changed. Run the command again'],
  'error.ambiguous': ['代码块位置不明确，请在编辑模式使用命令', 'Ambiguous source block. Use the command in editing mode'],
  'error.file': ['无法定位源文件', 'Cannot locate the source note'],
  'error.extractContainer': ['引用或列表中的局部选区无法安全拆块，请选择整个日志代码块。', 'A partial selection inside a quote or list cannot be split safely. Select the whole log code block.'],
  'error.multiReplace': ['选区位于代码块内部，多个结果请插入为独立代码块', 'For a selection inside a code block, insert multiple results as separate blocks'],
  'error.unsupported': ['不支持的数据值：{value}', 'Unsupported data value: {value}'],
  'error.string': ['第 {offset} 个字符处字符串未闭合', 'Unclosed string at character {offset}'],
  'error.comment': ['块注释未闭合', 'Unclosed block comment'], 'error.notString': ['目标不是字符串', 'Target is not a string'],
  'error.key': ['缺少合法属性名', 'Missing or invalid property name'], 'error.colon': ['属性名后缺少冒号', 'Missing colon after property name'],
  'error.comma': ['数据项之间缺少逗号', 'Missing comma between values'], 'error.truncated': ['结构截断或括号不匹配', 'Truncated structure or mismatched brackets'],
  'error.depth': ['数据嵌套超过 128 层', 'Nesting exceeds 128 levels'], 'error.leadingZero': ['不支持带前导零的数字', 'Unsupported leading-zero number'],
  'error.multiple': ['目标包含多个值或外围文本', 'Target contains multiple values or surrounding text'],
  'error.literal': ['请选择一个完整对象或数组', 'Select a complete object or array'],
  'error.preservation': ['排版无法保持原始数据，已取消', 'Formatting could not preserve the original data and was cancelled'],
  'error.noCandidate': ['没有找到可转换的数据片段', 'No convertible data fragments found'],
  'error.incompleteValue': ['字段值、字符串或数字不完整，不能猜测补值', 'Incomplete field value, string, or number; missing values cannot be inferred'],
  'error.nonfinite': ['NaN 和 Infinity 没有对应的 JSON 值，未转换', 'NaN and Infinity cannot be represented as JSON and were not converted'],
  'warning.invalid': ['仅改善排版，语法仍可能无效', 'Layout improved; syntax may still be invalid'],
  'warning.partial': ['内容仍不完整，没有补齐数据', 'Content remains incomplete; no data was added'],
  'warning.type': ['字符串将变为对象或数组，原接口字段类型将改变', 'A string becomes an object or array, changing the original field type'],
  'warning.integer': ['超大整数文本已保留，JS Number 求值可能损失精度，需要时使用 BigInt', 'Large integer text is preserved, but JS Number evaluation may lose precision. Use BigInt when needed'],
  'warning.duplicate': ['重复字段 {key} 已保留，JS 求值时后值覆盖前值', 'Duplicate key {key} is preserved; JavaScript evaluation uses the last value'],
  'repair.delimiter': ['移除数据值之外的分隔逗号', 'Removed a separator comma outside the value'],
  'repair.wrapper': ['为完整属性片段增加外层对象括号', 'Wrapped complete properties in an object'],
  'repair.closing': ['补齐 {count} 个尾部结构括号；未恢复丢失数据', 'Added {count} closing brackets; missing data was not recovered'],
  'repair.normalized': ['将键、字符串和数字规范为严格 JSON', 'Normalized keys, strings and numbers to strict JSON'],
  'repair.comments': ['移除注释；替换时这些信息会丢失', 'Removed comments; replacement discards that information'],
  'repair.extracted': ['提取日志数据；替换目标时外围日志会被移除', 'Extracted log data; replacement removes surrounding log text'],
  'location.offset': ['字符 {offset}', 'Character {offset}'], 'location.line': ['第 {line} 行', 'Line {line}'],
  'location.field': ['{path} · 字符 {offset} · {layers} 层解码', '{path} · character {offset} · {layers} decoding layers'],
  'diagnostic.at': ['{location}：{detail}', '{location}: {detail}']
};
/** 所有界面读取统一使用的翻译函数 */
export type Translator = (key: string, params?: Params) => string;
/** 为当前界面语言创建模板替换器 */
export function translator(locale: Locale): Translator {
  return (key, params = {}) => (TEXT[key]?.[locale === 'zh' ? 0 : 1] ?? TEXT['error.generic'][locale === 'zh' ? 0 : 1]).replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
/** 根据显式设置或宿主语言选择中英文 */
export function resolveLocale(language: Language, system: string): Locale {return language === 'system' ? system.toLowerCase().startsWith('zh') ? 'zh' : 'en' : language;}
/** 根据 code 翻译诊断，递归展示底层原因 */
export function describe(diagnostic: Diagnostic, t: Translator): string {return t(diagnostic.code, {...diagnostic.params, ...(diagnostic.cause ? {detail: describe(diagnostic.cause, t)} : {})});}
/** 带诊断 code 的错误，默认中文消息兼容既有核心调用 */
export class DataError extends Error {
  /** 跨线程可序列化的错误内容 */
  readonly diagnostic: Diagnostic;
  /** 建立错误而不依赖中文句子进行分支判断 */
  constructor(code: string, params?: Params) {super(translator('zh')(code, params)); this.diagnostic = {code, params};}
}
/** 将原生解析错误或业务错误归一化为诊断协议 */
export function errorDiagnostic(error: unknown): Diagnostic {return error instanceof DataError ? error.diagnostic : {code: 'error.syntax', params: {detail: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'}};}
