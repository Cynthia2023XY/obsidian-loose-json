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

This initial version has not been submitted to the Obsidian Community directory.

Download `main.js`, `manifest.json`, and `styles.css` from a release, place them in `<vault>/.obsidian/plugins/loose-json/`, then enable **Loose JSON** in Settings → Community plugins. Keep the included license notices alongside distributed copies. BRAT can install the repository once a GitHub release is available.

## Commands

The initial UI and command names are in Chinese:

| Command | Usage |
| --- | --- |
| 格式化 JSON 代码块或选区 | Select text or place the cursor in a JSON/unlabelled block. Valid fragments are formatted in place. Damaged but balanced JSON-like objects require preview. |
| 格式化当前文档中的 JSON | Review detected JSON fragments and choose changes to apply. YAML frontmatter, inline code, Markdown links and other code-block languages are protected. |
| 复制为 JS 对象字面量 | Select one complete object/array or use the current block. Preview and copy; the original note is unchanged. |
| 将字符串化 JSON 字段转为对象 | Review fields whose string values contain JSON objects/arrays, then apply selected changes. This changes their data types. |

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
- Formatting does not repair missing punctuation or truncated data. Document scanning skips malformed structures; explicit JSON-block formatting can preview balanced damaged objects.
- JS conversion requires a complete object/array and does not accept functions, expressions or variable references. Computed `['__proto__']` keys preserve data-property behavior.
- Large integer text is preserved, but evaluating a generated JS literal as a Number can still lose precision; use BigInt where your application requires it. Duplicate JS keys still follow JavaScript's last-value behavior.
- Backtick and tilde fences, CRLF, ordinary list and blockquote containers are supported. Ambiguous or incomplete containers are skipped.
- Reading mode refuses ambiguous source locations. Embedded blocks open their actual source note rather than modifying the host note.
- Default processing limit: 1 MiB, configurable from 0.1 to 10 MiB; maximum structural depth: 128. Inputs containing arbitrary Markdown or invalid log syntax cannot always be inferred correctly; preview document changes before applying.
- Inner stringified JSON must be strict JSON by default. A setting explicitly allows JSON5 inside strings.

## Development

Node.js 22 or later:

```sh
npm ci
npm run test:coverage
npm run package
```

Runtime verification in the isolated Chinese test vault is available via `node scripts/verify-obsidian.mjs`; it creates a uniquely named synthetic note. See [validation notes](docs/validation.md) for tested behavior and remaining release checks.

Copy the files in `dist/loose-json-0.1.0/` into a test vault. `npm run dev` rebuilds on source changes; it does not start an HTTP server. Reload the plugin after rebuilding.

The core tokenizer, range scanner, parser, and formatter were written independently. Formatting changes whitespace between tokens rather than parsing and reserializing numeric values. Obsidian and CodeMirror are external host dependencies; JSON5 is bundled solely for string/key decoding.

## Credits and license

Inspired by the practical workflow of [Simple Code Formatter](https://github.com/wiop93256/Simple-Code-Formmater), with thanks to its author. No source or assets were copied from that plugin.

MIT © 2026 Cynthia2023XY. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
