# Loose JSON

An offline JSON tool for Obsidian developers reading API payloads and logs. Format JSON and JSON-like snippets, preserve surrounding log text, copy JavaScript object literals, and convert stringified JSON fields into objects or arrays.

## Features

- Format the selected text or the current `json` / unlabelled fenced code block.
- Format buttons in editing and reading views. Reading-view formatting opens the verified source block in editing mode so the change can be undone.
- Preview document-wide changes; timestamps, IP addresses, URLs, and other log text outside detected JSON remain unchanged.
- Preview and copy JS literals with unquoted identifier keys and single-quoted strings.
- Select stringified JSON fields by path and source position; decode up to three layers and apply only selected changes.
- Preserve numeric spelling, large integer text, duplicate keys, comments, and property order during formatting.
- Cancellable background processing. No network requests, telemetry, accounts, or clipboard reads.

## Installation

Install **Loose JSON** from Settings → Community plugins → Browse, or use the [Community Directory listing](https://community.obsidian.md/plugins/loose-json).

Download `main.js`, `manifest.json`, and `styles.css` from a release, place them in `<vault>/.obsidian/plugins/loose-json/`, then enable **Loose JSON** in Settings → Community plugins. Keep the included license notices alongside distributed copies. For BRAT, add `Cynthia2023XY/obsidian-loose-json`.

## Commands

The interface supports Chinese and English, following Obsidian by default. Choose an explicit language in settings. Buttons and new dialogs update immediately; re-enable the plugin to update command names without changing IDs or hotkeys.

| Command | Usage |
| --- | --- |
| 格式化 JSON 代码块或选区 | Select text or place the cursor in a JSON/unlabelled block. Valid fragments are formatted in place. Incomplete JSON-like objects and arrays can be laid out without completing missing data; damaged content requires review. |
| 格式化当前文档中的 JSON | Review detected JSON fragments and choose changes to apply. YAML frontmatter, inline code, Markdown links and other code-block languages are protected. |
| 复制为 JavaScript | Complete values, property fragments and log-wrapped data are supported. Choose a candidate and automatic/object/property output; the original note is unchanged. |
| 将字符串化 JSON 字段转为对象 | Review fields whose string values contain JSON objects/arrays, then apply selected changes. This changes their data types. |
| 修复为严格 JSON | Review safe JSON5 normalization and structural closure. Copy or insert a separate result by default; replacing the source is explicit. Missing strings or field values are never invented. |
| 提取日志 JSON 为代码块 | Extract outer data values, including clearly labelled `null` responses, into separate blocks in source order. Insertion preserves original logs and stays outside the source fence. |
| 查看上次处理诊断 | Inspect skipped fragments and conversion warnings locally. |

Document formatting, field decoding and JS copying have independent preview settings, enabled by default. Disabling document/decode previews applies valid changes directly; disabling JS preview copies only a unique result. Multiple JS candidates still require selection. Repair and extraction always require review. The document preview includes a direct link to preview settings.

Valid direct formatting can be undone once. Document and decode changes are also applied in one editor transaction. If a note changes while a preview is open, rerun the command; stale previews are never written.

## Examples

Mixed log input:

```text
2026-10-08 15:59:55.931 | WARN | 11.247.172.117 | request={"id":9223372036854775807,"items":[1,2]}
```

Formatted result:

```text
2026-10-08 15:59:55.931 | WARN | 11.247.172.117 | request={
  "id": 9223372036854775807,
  "items": [
    1,
    2
  ]
}
```

Stringified field:

```json
{"data":"{\"total\":1}"}
```

After selecting `/data`, its value becomes an object. Ordinary strings, URLs, paths, and strings such as `"123"` are left alone. Newly exposed nested string fields are not recursively converted unless you run the command again.

## Supported input and limits

- Strict JSON, plus common JSON5 syntax: comments, single quotes, unquoted/Unicode keys, trailing commas, hexadecimal numbers, Infinity and NaN.
- Formatting preserves token text, including unfinished strings/comments; it never adds brackets or values. Document scanning remains conservative and recovers at known two-digit/four-digit year log boundaries. Repair is separate, preserves numeric tokens and duplicate keys, and refuses lossy NaN/Infinity conversion to strict JSON.
- JS conversion supports complete values, property lists, trailing separator commas and multiple outer log candidates. It does not accept functions, expressions or variable references. Computed `['__proto__']` keys preserve data-property behavior.
- Large integer text is preserved, but evaluating a generated JS literal as a Number can still lose precision; use BigInt where your application requires it. Duplicate JS keys still follow JavaScript's last-value behavior.
- Backtick and tilde fences, CRLF, ordinary list and blockquote containers are supported. Ambiguous or incomplete containers are skipped.
- Reading mode refuses ambiguous source locations. Embedded blocks open their actual source note rather than modifying the host note.
- Default processing limit: 1 MiB, configurable from 0.1 to 10 MiB; maximum structural depth: 128. Inputs containing arbitrary Markdown or invalid log syntax cannot always be inferred correctly; preview document changes before applying.
- Inner stringified JSON must be strict JSON by default. A setting explicitly allows JSON5 inside strings.

## Privacy and compatibility

All formatting and conversion run locally on your device. No network requests, accounts, payments, advertisements, or telemetry are used. The plugin only accesses notes and its settings within the vault; it does not access files outside the vault. It never reads the clipboard. Copy commands and copy buttons write only the result you request.

The declared API minimum is Obsidian 1.8.7, the version that introduced `getLanguage`. Desktop behavior has been verified on Obsidian 1.14.4. The runtime uses Web APIs and does not require Node.js or Electron APIs. Native mobile devices and the minimum app version have not yet been tested; see the validation notes for the exact test coverage.

Codeblock Customizer 1.4.7 is supported in Live Preview, source mode (when enabled in CBC), and reading mode. Loose JSON adds a separate button to each reliably matched CBC toolbar without moving CodeMirror widgets or replacing CBC copy/fold controls. Excluded blocks keep the native layout. Unmatched toolbars use a separate action row; shared grouped headers are not used to infer a source block. Settings changes, toolbar rebuilds, and plugin unloading clean up the added controls. Native mobile behavior remains unverified.

## Development

Node.js 22 or later:

```sh
npm ci
npm run test:coverage
npm run package
```

Runtime verification in the isolated Chinese test vault is available via `node scripts/verify-obsidian.mjs`; it creates a uniquely named synthetic note. Keep that vault window visible for reading-mode checks. Hidden-window skips are reported explicitly. See [validation notes](docs/validation.md) for tested behavior and remaining release checks.

CBC runtime verification is available via `node scripts/verify-codeblock-customizer.mjs` with both plugins enabled in the visible isolated test vault. It restores plugin settings after verification and writes a local receipt under `.runtime-test/`.

Copy the files in `dist/loose-json-0.2.1/` into a test vault. `npm run dev` rebuilds on source changes; it does not start an HTTP server. Reload the plugin after rebuilding.

The core tokenizer, range scanner, parser, and formatter were written independently. Formatting changes whitespace between tokens rather than parsing and reserializing numeric values. Obsidian and CodeMirror are external host dependencies; JSON5 is bundled solely for string/key decoding.

## Credits and license

Inspired by the practical workflow of [Simple Code Formatter](https://github.com/wiop93256/Simple-Code-Formmater), with thanks to its author. No source or assets were copied from that plugin.

MIT © 2026 Cynthia Ding (Cynthia2023XY). See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
