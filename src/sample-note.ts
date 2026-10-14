import type {Locale} from './i18n';

/** 示例文件创建所需的公开笔记库能力，便于离线验证 */
export interface SampleVault {getAbstractFileByPath(path: string): unknown; create(path: string, content: string): Promise<unknown>}

/** 使用模拟字段演示业务日志，不包含真实账号或令牌 */
const SAMPLE_LOG = '26-10-14.10:23:01.813 [T-1324] INFO ApiService - request={"pin":"demo-user","items":[1,2],"amount":1000.00}, response={"code":"00000","msg":"成功"}, elapsed=3ms';

/** 根据界面语言生成可直接执行命令的入门笔记，示例数据保持一致 */
export function sampleNote(locale: Locale): string {
  // 每个场景的操作提示使用插件对应语言的真实命令名称。
  const zh = locale === 'zh';
  // 示例正文采用普通围栏，不引入复杂容器或外部资源。
  return [
    '# Loose JSON · ' + (zh ? '功能测试' : 'Try the features'),
    zh ? '这是首次启用 Loose JSON 时自动生成的示例笔记，数据均为模拟内容。你可以自由修改或删除；插件不会覆盖它，也不会在下次启用时重新生成。需要新副本时，运行“生成示例笔记”。' : 'This sample note was created when you first enabled Loose JSON. All data is synthetic. You can edit or delete it; the plugin will not overwrite or recreate it on the next load. Run Create sample note whenever you need a fresh copy.',
    zh ? '**Loose JSON 是宽松格式化工具，适用于非标准 JSON。** 格式化只调整排版，不把非标准语法自动改成严格 JSON，也不补写缺失值。下面每项都可单独测试，应用后可撤销。' : '**Loose JSON is a loose formatter for non-standard JSON.** Formatting changes layout without automatically converting syntax to strict JSON or inventing missing values. Try each section separately; applied changes can be undone.',
    '## 1. ' + (zh ? '宽松格式化' : 'Loose formatting'),
    zh ? '点击下面代码块的“格式化”按钮，或把光标放进代码块，运行“格式化 JSON 代码块或选区”。预期：字段分行、层级缩进；单引号、注释、尾逗号和数字原写法保留。' : 'Click the Format button on the block below, or place the cursor inside it and run Format JSON block or selection. Expect line breaks and indentation, with single quotes, comments, trailing commas and numeric spelling preserved.',
    "```json\n{fundCode:'000001',/* 示例配置 */items:[1,2,],amount:1000.00,}\n```",
    '## 2. ' + (zh ? '只格式化选区' : 'Format only a selection'),
    zh ? '只选中下面的 `{"items":[1,2]}`，运行“格式化 JSON 代码块或选区”。预期：只有选中的对象展开，日志前后文字不变。' : 'Select only `{"items":[1,2]}` below and run Format JSON block or selection. Expect only that object to expand; surrounding log text stays unchanged.',
    '```\nINFO request={"items":[1,2]}, response=null; finished\n```',
    '## 3. ' + (zh ? '格式化全文' : 'Format the whole note'),
    zh ? '运行“格式化当前文档中的 JSON”，核对预览并应用所选修改。预期：本笔记中可处理的片段展开，正文和下方 JavaScript 代码块保留。建议最后测试，避免提前改变其他场景的输入。' : 'Run Format JSON fragments in this document, review the preview and apply selected changes. Expect recognized fragments to expand while prose and the JavaScript block below stay intact. Try this last so other examples retain their original inputs.',
    '```js\nconst keepAsIs = {items:[1,2]};\n```',
    '## 4. ' + (zh ? '复制为 JavaScript' : 'Copy as JavaScript'),
    zh ? '把光标放进下面代码块，运行“复制为 JavaScript”，预览并复制。预期：合法键名不加引号、字符串使用单引号，原笔记不变。大整数文本保留，但作为 JavaScript Number 使用仍有精度风险。' : 'Place the cursor in the block below, run Copy as JavaScript, then preview and copy. Expect unquoted identifier keys and single-quoted strings, without changing this note. Large integer text is preserved, but JavaScript Number evaluation can still lose precision.',
    '```json\n{"activityName":"示例基金体验金","items":[1,2],"id":9223372036854775807}\n```',
    '## 5. ' + (zh ? '展开字符串化 JSON 字段' : 'Decode stringified JSON fields'),
    zh ? '运行“将字符串化 JSON 字段转为对象”，选择 /data 并应用。预期：data 从字符串变成 `{"total":1}` 对象，path 仍为字符串。此命令会改变字段类型。' : 'Run Decode stringified JSON fields, select /data and apply. Expect data to become the object `{"total":1}`, while path remains a string. This command changes field types.',
    '```json\n{"data":"{\\"total\\":1}","path":"C:\\\\tmp"}\n```',
    '## 6. ' + (zh ? '日志拆成独立 JSON 代码块' : 'Split log JSON into separate blocks'),
    zh ? '把光标放进下面未注明语言的代码块，运行“提取日志 JSON 为代码块”。查看完整日志预览，点击“应用选中修改”。预期：request 和 response 在原位置分别包成 JSON 代码块，日志文字、分隔符和耗时保留；外层日志围栏移除。' : 'Place the cursor inside the unlabelled block below and run Extract log JSON into code blocks. Review the full log result, then click Apply selected changes. Expect request and response to become separate JSON blocks at their original positions. Log text, separators and elapsed time stay intact; the outer log fence is removed.',
    '```\n' + SAMPLE_LOG + '\n```',
    '## 7. ' + (zh ? '修复为严格 JSON' : 'Repair to strict JSON'),
    zh ? '运行“修复为严格 JSON”，检查预览后复制或插入结果。预期：键名和字符串使用双引号，尾逗号移除。与宽松格式化不同，这会规范语法。' : 'Run Repair to strict JSON and review the preview before copying or inserting the result. Expect double-quoted keys and strings, with trailing commas removed. Unlike loose formatting, this normalizes syntax.',
    "```json\n{fundCode:'000001',items:[1,2,],}\n```",
    zh ? '如果某段内容未处理，运行“查看上次处理诊断”查看原因。' : 'If a snippet is not processed, run View last processing details to see why.'
  ].join('\n\n') + '\n';
}

/** 创建独立示例副本；同名笔记或文件夹存在时更换文件名，绝不覆盖 */
export async function createSampleNote(vault: SampleVault, locale: Locale): Promise<string> {
  // 根目录使用稳定可识别的名称，后续副本带编号。
  const base = locale === 'zh' ? 'Loose JSON 功能测试' : 'Loose JSON Sample';
  // 从首个可用路径创建，保留用户已有内容。
  let path = base + '.md';
  // 同名冲突时递增副本编号。
  let index = 1;
  while (vault.getAbstractFileByPath(path)) path = `${base} (${index++}).md`;
  await vault.create(path, sampleNote(locale));
  return path;
}
