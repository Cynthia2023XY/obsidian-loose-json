# Loose JSON

[简体中文](README.md)

An offline **loose JSON formatter for Obsidian, designed to handle non-standard JSON** when reading API payloads and logs. Format JSON and JSON-like snippets, preserve surrounding log text, copy JavaScript object literals, and convert stringified JSON fields into objects or arrays.

**You do not need to turn the input into strict JSON before formatting it.** Content copied from logs, consoles or configuration platforms can include timestamps, request labels and log text, or common non-standard syntax such as single quotes, unquoted keys, comments and trailing commas. The formatter lays out recognizable data fragments. See the supported input and limits below.

Loose formatting changes layout while preserving the original data and syntax. It does not automatically convert non-standard JSON to strict JSON or invent missing values. To produce strict JSON, use the separate Repair to strict JSON command and review its preview.

## Features

- Loosely format selected text or the current `json` / unlabelled fenced code block, including strict JSON, common non-standard JSON syntax and JSON fragments within logs.
- Format buttons in editing and reading views. Reading-view formatting opens the verified source block in editing mode so the change can be undone.
- Preview document-wide changes; timestamps, IP addresses, URLs, and other log text outside detected JSON remain unchanged.
- Preview and copy JS literals with unquoted identifier keys and single-quoted strings.
- Select stringified JSON fields by path and source position; decode up to three layers and apply only selected changes.
- Preserve numeric spelling, large integer text, duplicate keys, comments, and property order during formatting.
- Cancellable background processing. No network requests, telemetry, accounts, or clipboard reads.

## Installation

Install **Loose JSON** from Settings → Community plugins → Browse, or use the [Community Directory listing](https://community.obsidian.md/plugins/loose-json).

Download `main.js`, `manifest.json`, and `styles.css` from a release, place them in `<vault>/.obsidian/plugins/loose-json/`, then enable **Loose JSON** in Settings → Community plugins. Keep the included license notices alongside distributed copies. For BRAT, add `Cynthia2023XY/obsidian-loose-json`.

### Try the features on first enable

When first enabled, the plugin creates `Loose JSON Sample.md` at the vault root. It contains synthetic data, instructions and expected results for loose formatting, selection formatting, document formatting, JavaScript copying, field decoding, log splitting and strict JSON repair. The note follows the plugin interface language; its Chinese filename is `Loose JSON 功能测试.md`.

If a file or folder with that name already exists, a numbered filename is used without overwriting anything. Successful creation is recorded, so re-enabling, upgrading or deleting the note does not automatically create another copy. Run Create sample note for a fresh copy. Automatic creation reports the location without switching notes; the manual command opens the new copy. Existing users also receive one sample when first upgrading to a version with this feature.

## Commands

The interface supports Chinese and English, following Obsidian by default. Choose an explicit language in settings. Buttons and new dialogs update immediately; re-enable the plugin to update command names without changing IDs or hotkeys.

| Command | Usage |
| --- | --- |
| Format JSON block or selection | Select text or place the cursor in a JSON/unlabelled block. Valid fragments are formatted in place. Incomplete JSON-like objects and arrays can be laid out without completing missing data; damaged content requires review. |
| Format JSON fragments in this document | Review detected JSON fragments and choose changes to apply. YAML frontmatter, inline code, Markdown links and other code-block languages are protected. |
| Copy as JavaScript | Complete values, property fragments and log-wrapped data are supported. Choose a candidate and automatic/object/property output; the original note is unchanged. |
| Decode stringified JSON fields | Review fields whose string values contain JSON objects/arrays, then apply selected changes. This changes their data types. |
| Repair to strict JSON | Review safe JSON5 normalization and structural closure. Copy or insert a separate result by default; replacing the source is explicit. Missing strings or field values are never invented. |
| Extract log JSON into code blocks | Wrap selected outer data values, including clearly labelled `null` responses, in code blocks at their original positions. Preserve surrounding logs and record order; review and apply in one undoable change. |
| Create sample note | Create and open a fresh sample at the vault root, leaving existing notes intact. |
| View last processing details | Inspect skipped fragments and conversion warnings locally. |

Document formatting, field decoding and JS copying have independent preview settings, enabled by default. Disabling document/decode previews applies valid changes directly; disabling JS preview copies only a unique result. Multiple JS candidates still require selection. Repair and extraction always require review. The document preview includes a direct link to preview settings.

Valid direct formatting can be undone once. Document and decode changes are also applied in one editor transaction. If a note changes while a preview is open, rerun the command; stale previews are never written.

## Workflows and examples you can copy

After pasting API responses or application logs into Obsidian, choose a command for the task below. Examples use the default two-space indentation and representative data structures. Accounts, tokens, internal addresses and resource identifiers have been replaced with sample values; long logs include only fields relevant to the operation.

| What you want to do | Entry point | Result |
| --- | --- | --- |
| Read JSON or request data in a code block | The block’s Format button, or Format JSON block or selection | JSON is expanded inside the existing block; surrounding logs stay intact |
| Format a selected snippet | Format JSON block or selection | Only the selection changes |
| Format JSON throughout the current note | Format JSON fragments in this document | Review and apply selected changes |
| Reuse API data as JavaScript arguments | Copy as JavaScript | Copy an object literal without changing the note |
| Read escaped JSON strings returned by a CMS | Decode stringified JSON fields | Selected string fields become objects or arrays |
| Explore a long log without knowing where to start | Extract log JSON into code blocks | Each selected JSON value becomes a separate block at its original position |

Open the command palette in editing mode and search for the commands above. A selection takes priority. Without a selection, place the cursor inside a `json` or unlabelled code block, except when using the document-wide command. Code-block buttons format data; use commands for conversion and log splitting.

### 1. Read request data inside a log code block

Use this when a log contains a large JSON payload compressed onto one line. Click the block’s Format button, or place the cursor inside it and run Format JSON block or selection. The log below works in either a `json` or an unlabelled code block.

Before:

```json
26-10-10.17:16:05.109 [JSF-BZ-22010-322-T-20] INFO ExperienceFundRemoteInvoker - 发放基金体验金 GiveUserFundExpMoneyQuery={"activityName":"示例基金体验金","deviceInfo":{"appType":"0","sdkToken":"demo-token"},"fundCode":"000001","generalParameters":{"prizeName":"示例基金体验金","prizeId":"demo-prize","amount":"1000.00"},"orderAmount":1000.00,"jdPin":"demo-user"},FundExperienceResponse=null
```

After formatting, the log remains in the same code block. Only the JSON layout changes:

```json
26-10-10.17:16:05.109 [JSF-BZ-22010-322-T-20] INFO ExperienceFundRemoteInvoker - 发放基金体验金 GiveUserFundExpMoneyQuery={
  "activityName": "示例基金体验金",
  "deviceInfo": {
    "appType": "0",
    "sdkToken": "demo-token"
  },
  "fundCode": "000001",
  "generalParameters": {
    "prizeName": "示例基金体验金",
    "prizeId": "demo-prize",
    "amount": "1000.00"
  },
  "orderAmount": 1000.00,
  "jdPin": "demo-user"
},FundExperienceResponse=null
```

The timestamp, thread name, log description and trailing `FundExperienceResponse=null` are preserved. The number `1000.00` also retains its original spelling.

### 2. Format only the selected JSON

Use this when a code block is long but you only need a request payload, a field or part of an array. Select that text and run Format JSON block or selection. You do not need to select the entire block; avoid crossing its opening or closing fence.

For example, select only this part of the previous log:

```json
{"prizeName":"示例基金体验金","prizeId":"demo-prize","amount":"1000.00"}
```

The selection gets the following layout. The rest of the log stays unchanged:

```json
{
  "prizeName": "示例基金体验金",
  "prizeId": "demo-prize",
  "amount": "1000.00"
}
```

### 3. Format JSON throughout a note

Use this when a note contains several API responses that need formatting. Run Format JSON fragments in this document, review the preview and select the changes to apply.

To try it, put these two blocks in the same note:

```json
{"code":"0000","data":{"total":1,"items":[1,2]}}
```

```
INFO request={"fundCode":"000001","orderAmount":1000.00}, response=null
```

JSON in both blocks is expanded, while prose between them stays intact. Document scanning protects YAML frontmatter, inline code, Markdown links and code blocks in other languages. Fragments that cannot be identified reliably are skipped; use View last processing details to see why.

This command changes multiple locations in the current note. Keep the default preview enabled for complex notes. Turning off Preview document formatting in settings applies valid changes directly. One undo restores the previous state.

### 4. Copy JSON as JavaScript arguments

Use this when you want to paste API data into JavaScript as an object argument. Select the JSON or place the cursor inside its block, run Copy as JavaScript, then choose a candidate and output form in the preview before copying.

Original JSON:

```json
{"items":[1,2],"id":9223372036854775807}
```

Copied object literal:

```js
{
  items: [
    1,
    2
  ],
  id: 9223372036854775807
}
```

Valid identifier keys lose their quotes, and strings use single quotes. For example:

```js
{
  activityName: '示例基金体验金',
  fundCode: '000001',
  deviceInfo: {
    appType: '0',
    sdkToken: 'demo-token'
  },
  orderAmount: 1000.00
}
```

Copying leaves the original note unchanged. Large integer text is preserved, but evaluating it as a JavaScript `Number` can still lose precision. Choose strings or BigInt according to your API contract.

### 5. Expand stringified JSON fields returned by a CMS

Use this when an API response contains many escaped quotes (`\"`), such as a CMS configuration whose `resData` is a whole JSON document stored as a string. Run Decode stringified JSON fields, check the field paths and select the fields to expand.

Start with this small example:

```json
{
  "data": "{\"total\":1}",
  "path": "C:\\tmp"
}
```

After selecting `/data`:

```json
{
  "data": {
    "total": 1
  },
  "path": "C:\\tmp"
}
```

Then try a CMS response:

```json
{
  "resultData": {
    "datas": {
      "templateType": 2,
      "resData": "{\"qd_res\":{\"type\":\"01\",\"resid\":\"demo-resource\"},\"res_id\":{\"template\":\"2\",\"sysCode\":\"fund_channel\",\"skuCode\":\"000001\"}}"
    },
    "status": "SUCCESS"
  },
  "success": true
}
```

After selecting `/resultData/datas/resData`:

```json
{
  "resultData": {
    "datas": {
      "templateType": 2,
      "resData": {
        "qd_res": {
          "type": "01",
          "resid": "demo-resource"
        },
        "res_id": {
          "template": "2",
          "sysCode": "fund_channel",
          "skuCode": "000001"
        }
      }
    },
    "status": "SUCCESS"
  },
  "success": true
}
```

This changes the field type from a string to an object or array. Ordinary text, paths, URLs and strings such as `"123"` stay unchanged. If the expanded object contains more stringified JSON, run the command again; it does not recursively convert every level at once. Disabling the field-decoding preview converts all recognized fields in the current target directly.

### 6. Split JSON values in logs into separate code blocks

Use this when you have pasted a long log and want to inspect requests, responses and arrays separately. Select the original logs, or place the cursor inside their code block, and run Extract log JSON into code blocks. Select candidates in the preview, check Full log result (surrounding text preserved), then click Apply selected changes.

Sample logs:

```text
26-10-14.10:23:01.813 [T-1324] INFO QueryService - 使用RPC调用组件项目的验资接口返回{"code":"00000","data":[],"msg":"成功"}
26-10-14.10:23:01.813 [T-1324] INFO ApiImpl - 返回值 CheckMissionWidgetResponse=[{"taskId":"37339","canPullModule":false}]
26-10-14.10:23:01.813 [T-1324] INFO ProviderAspect - 入参:[{"pin":"demo-user","reqList":[{"compType":"TASK","taskId":37339}]}], 出参:{"code":"00000","data":[{"canPullModule":false,"taskId":"37339"}],"msg":"成功"}, 耗时3ms
```

After applying, each JSON value below is a separate code block in the note. Timestamps, descriptions, separators, elapsed time and record order are preserved. Necessary line breaks are added around JSON so each fence occupies its own line:

26-10-14.10:23:01.813 [T-1324] INFO QueryService - 使用RPC调用组件项目的验资接口返回
```json
{
  "code": "00000",
  "data": [],
  "msg": "成功"
}
```

26-10-14.10:23:01.813 [T-1324] INFO ApiImpl - 返回值 CheckMissionWidgetResponse=
```json
[
  {
    "taskId": "37339",
    "canPullModule": false
  }
]
```

26-10-14.10:23:01.813 [T-1324] INFO ProviderAspect - 入参:
```json
[
  {
    "pin": "demo-user",
    "reqList": [
      {
        "compType": "TASK",
        "taskId": 37339
      }
    ]
  }
]
```
, 出参:
```json
{
  "code": "00000",
  "data": [
    {
      "canPullModule": false,
      "taskId": "37339"
    }
  ],
  "msg": "成功"
}
```
, 耗时3ms

Requests and responses on the same line can become separate blocks. Unselected JSON stays unchanged. Clearly labelled null responses, such as `response=null`, can also be wrapped separately. No extra request or fragment headings are added. One undo restores the original logs.

Regular formatting expands JSON inside the existing code block; this command creates multiple independent blocks. When processing an entire log block, it removes the outer fence so the new blocks render correctly. For logs in quotes or lists, select the whole block; unsafe partial selections produce a message.

### Two more commands: repair and diagnostics

Data copied from a console may use single quotes, unquoted keys or trailing commas. To prepare it for an API that requires strict JSON, run Repair to strict JSON. For example:

```text
{fundCode:'000001',items:[1,2,],}
```

Preview result:

```json
{
  "fundCode": "000001",
  "items": [
    1,
    2
  ]
}
```

Regular formatting only changes layout. Strict JSON repair may remove comments, normalize syntax or close structural brackets where the result can be determined safely, so always check the preview. Copy or insert the result first; missing strings or field values are never guessed.

If a snippet does not change, run View last processing details to inspect skipped-fragment reasons or conversion warnings, such as mismatched brackets, truncated content or JavaScript precision risks for large integers.

## Supported input and limits

- Strict JSON, plus common JSON5 syntax: comments, single quotes, unquoted/Unicode keys, trailing commas, hexadecimal numbers, Infinity and NaN.
- Formatting preserves token text, including unfinished strings/comments; it never adds brackets or values. Document scanning remains conservative and recovers at known two-digit/four-digit year log boundaries. Repair is separate, preserves numeric tokens and duplicate keys, and refuses lossy NaN/Infinity conversion to strict JSON.
- JS conversion supports complete values, property lists, trailing separator commas and multiple outer log candidates. It does not accept functions, expressions or variable references. Computed `['__proto__']` keys preserve data-property behavior.
- Large integer text is preserved, but evaluating a generated JS literal as a Number can still lose precision; use BigInt where your application requires it. Duplicate JS keys still follow JavaScript's last-value behavior.
- Backtick and tilde fences, CRLF, ordinary list and blockquote containers are supported. Ambiguous or incomplete containers are skipped.
- Reading mode refuses ambiguous source locations. Embedded blocks open their actual source note rather than modifying the host note.
- Default processing limit: 1 MiB, configurable from 0.1 to 10 MiB; maximum structural depth: 128. Inputs containing arbitrary Markdown or invalid log syntax cannot always be inferred correctly; preview document changes before applying.
- Inner stringified JSON must be strict JSON by default. A setting explicitly allows JSON5 inside strings.

### Extract log JSON in place

The extraction command formats selected JSON at its original location and wraps it in an independent `json` code block. Surrounding log text, separators and record order remain intact; unselected candidates remain unchanged. Review the full log result, then apply the selected changes in one undoable operation. No request/response headings are inserted. If the source is an entire log code block, its outer fence is removed so the new JSON fences can render independently. Partial selections inside ordinary fences preserve the other body text; partial selections inside quoted/list containers are rejected rather than generating invalid nested fences.

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

Copy the files in `dist/loose-json-0.2.2/` into a test vault. `npm run dev` rebuilds on source changes; it does not start an HTTP server. Reload the plugin after rebuilding.

The core tokenizer, range scanner, parser, and formatter were written independently. Formatting changes whitespace between tokens rather than parsing and reserializing numeric values. Obsidian and CodeMirror are external host dependencies; JSON5 is bundled solely for string/key decoding.

## Credits and license

Inspired by the practical workflow of [Simple Code Formatter](https://github.com/wiop93256/Simple-Code-Formmater), with thanks to its author. No source or assets were copied from that plugin.

MIT © 2026 Cynthia Ding (Cynthia2023XY). See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
