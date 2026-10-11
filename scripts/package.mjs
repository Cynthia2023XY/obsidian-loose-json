import {mkdir, copyFile, readFile} from 'node:fs/promises';
/** 本次发布版本与目标目录 */
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
/** 便于手工安装或 BRAT 发布的构建目录 */
const directory = `dist/loose-json-${manifest.version}`;
await mkdir(directory, {recursive: true});
/** 安装文件与分发时必须保留的许可说明 */
for (const file of ['main.js', 'manifest.json', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md']) {
  await copyFile(file, `${directory}/${file}`);
}
console.log(`Installable files: ${directory}`);
