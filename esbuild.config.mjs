import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
/** 安装器只下载主包等必需文件，因此把产品和第三方完整许可嵌入主包 */
const licenseBanner = [await readFile('LICENSE', 'utf8'), await readFile('THIRD_PARTY_NOTICES.md', 'utf8')].join('\n\n');
/** 在独立线程中执行文档扫描及转换，避免阻塞笔记编辑 */
const worker = await build({entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true});
/** Obsidian 与 CodeMirror 使用宿主提供的实例，避免状态类型不一致 */
const options = {
  entryPoints: ['src/main.ts'], bundle: true, outfile: 'main.js', format: 'cjs', target: 'es2022',
  platform: 'browser', external: ['obsidian', '@codemirror/state', '@codemirror/view'],
  define: {LOOSE_JSON_WORKER: JSON.stringify(worker.outputFiles[0].text)},
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  banner: {js: '/*\n' + licenseBanner + '\n*/'}
};
if (process.argv.includes('--watch')) {
  // 监听插件与工作线程源文件，变更后重新构建完整产物。
  const {watch} = await import('node:fs');
  await build(options);
  // 简化开发入口，工作线程变化也重新注入主包。
  watch('src', {recursive: true}, async () => {
    // 每次更新重新打包工作线程，避免主线程缓存旧算法。
    const updated = await build({entryPoints: ['src/worker.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022', minify: true});
    await build({...options, define: {LOOSE_JSON_WORKER: JSON.stringify(updated.outputFiles[0].text)}});
  });
} else {
  await build(options);
}
