import {describe, expect, it} from 'vitest';
import {createSampleNote, sampleNote} from '../src/sample-note';
import {codeBlocks} from '../src/core/markdown';
import {fragmentPlan, decodePlan, documentPlan} from '../src/core/engine';
import {extractCandidates, repairCandidates} from '../src/core/conversion';

/** 模拟笔记库文件和文件夹，验证示例不会覆盖用户内容 */
function sampleVault(initial: Record<string, string> = {}) {
  // 原文件内容用于核对写入边界。
  const files = new Map(Object.entries(initial));
  return {files, getAbstractFileByPath: (path: string) => files.has(path), create: async (path: string, content: string) => {
    if (files.has(path)) throw new Error('exists');
    files.set(path, content);
  }};
}

describe('入门示例笔记', () => {
  it('遇到同名文件和副本时创建新路径，不改用户笔记', async () => {
    // 同名路径已有用户内容，不能覆盖。
    const vault = sampleVault({'Loose JSON 功能测试.md': '用户正文', 'Loose JSON 功能测试 (1).md': '已有副本'});
    expect(await createSampleNote(vault, 'zh')).toBe('Loose JSON 功能测试 (2).md');
    expect(vault.files.get('Loose JSON 功能测试.md')).toBe('用户正文');
    expect(vault.files.get('Loose JSON 功能测试 (1).md')).toBe('已有副本');
  });
  it('中英文说明不同，测试数据完全一致', () => {
    expect(codeBlocks(sampleNote('zh')).map(block => block.content)).toEqual(codeBlocks(sampleNote('en')).map(block => block.content));
    expect(sampleNote('en')).toContain('Create sample note');
    expect(sampleNote('zh')).toContain('生成示例笔记');
  });
  it('示例能够使用当前引擎完成宽松排版、字段展开、拆块和修复', () => {
    // 每节只使用一个可操作块，第三节保留受保护的 JavaScript。
    const blocks = codeBlocks(sampleNote('zh'));
    expect(blocks).toHaveLength(7);
    expect(fragmentPlan(blocks[0].content).changes).toHaveLength(1);
    expect(decodePlan(blocks[4].content).changes).toHaveLength(1);
    expect(extractCandidates(blocks[5].content).candidates).toHaveLength(2);
    expect(repairCandidates(blocks[6].content).candidates).toHaveLength(1);
    // 全文格式化不能修改中英文说明中的内联对象或受保护的 JS 示例。
    for (const locale of ['zh', 'en'] as const) {
      // 说明文字与可操作代码块使用相同的边界扫描。
      const note = sampleNote(locale);
      // 只允许在可格式化的数据围栏内部产生修改。
      const allowed = codeBlocks(note).filter(block => block.language !== 'js');
      expect(documentPlan(note).changes.every(change => allowed.some(block => change.from >= block.bodyFrom && change.to <= block.bodyTo))).toBe(true);
    }
  });
  it('笔记库写入失败时报告错误，不伪造成功路径', async () => {
    // 模拟只读存储或同步写入失败。
    const vault = {getAbstractFileByPath: () => null, create: async () => {throw new Error('read only');}};
    await expect(createSampleNote(vault, 'en')).rejects.toThrow('read only');
  });
});
