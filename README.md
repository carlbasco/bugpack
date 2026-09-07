# @bugpack/core

Framework-agnostic browser library for collecting client-side diagnostics and letting users submit annotated bug reports through an application-provided callback.

BugPack keeps report data in memory. It does not upload, persist, categorize, or send reports to a third-party service. Your application decides what happens in `onSubmit`.

## Features

- Visible-page screenshot and annotation dialog
- Pencil, rectangle, selection, eraser, zoom, and maximize tools
- Optional JavaScript error, console, Fetch, and XMLHttpRequest diagnostics
- Static or dynamically resolved metadata
- Configurable privacy filters and screenshot masking
- Object or ZIP output
- Custom dialog text and submit-button color
- Explicit lifecycle with bounded in-memory buffers

## Installation

```sh
npm install @bugpack/core
```

Or:

```sh
yarn add @bugpack/core
```

BugPack is an ES module intended for browser applications. Creating reports requires browser APIs such as the DOM, Canvas, `Blob`, and `AbortController`. Applications can install and bundle the package with Node.js 18 or later. Developing BugPack itself requires Node.js 20 or later because of its test tooling.

## Quick start

Create one instance, enable its configured collectors, and bind `report` to a button:

```ts
import { createBugPack } from '@bugpack/core';

const bugpack = createBugPack({
    metadata: {
        application: 'customer-portal',
        release: '2026.09.06',
    },
    onSubmit: async (report) => {
        await uploadReport(report);
    },
});

bugpack.enable();
document.querySelector('#report-bug')?.addEventListener('click', bugpack.report);
```

```html
<button id="report-bug" type="button">Report a bug</button>
```

BugPack does not create a floating launcher. The application owns the button and can bind `bugpack.report` directly. `report()` returns immediately and handles report-generation and submission failures internally, so a wrapper or `.catch()` is not required.

## Lifecycle

Each instance exposes four methods:

- `enable()` starts every collector whose `enabled` option is `true`. Repeated calls have no effect.
- `disable()` stops collectors and cancels an active report. The instance can be enabled again.
- `report()` starts the report flow. It can open the dialog while collectors are disabled, but only evidence already in the buffers is available.
- `dispose()` stops collectors, cancels an active report, clears captured evidence, and permanently disposes the instance.

Create one instance for the lifetime of the relevant application or component and dispose it during teardown:

```ts
const bugpack = createBugPack({ onSubmit: saveReport });
bugpack.enable();

// Run when the owning application or component is destroyed.
bugpack.dispose();
```

Calling `enable()` after disposal throws. Calls to `report()`, `disable()`, or `dispose()` after disposal are ignored. Only one report flow can be active per instance; additional `report()` calls are ignored until it finishes.

## Configuration defaults

All diagnostic collectors are opt-in. Calling `enable()` only starts collectors explicitly configured with `enabled: true`.

| Option                                    | Default                           |
| ----------------------------------------- | --------------------------------- |
| `metadata`                                | `{}`                              |
| `output.format`                           | `'object'`                        |
| `diagnostics.javascriptErrors.enabled`    | `false`                           |
| `diagnostics.javascriptErrors.types`      | `['error', 'unhandledrejection']` |
| `diagnostics.javascriptErrors.maxEntries` | `50`                              |
| `diagnostics.console.enabled`             | `false`                           |
| `diagnostics.console.levels`              | `['error']`                       |
| `diagnostics.console.maxEntries`          | `50`                              |
| `diagnostics.network.enabled`             | `false`                           |
| `diagnostics.network.capture`             | `['fetch', 'xhr']`                |
| `diagnostics.network.statuses`            | omitted; retain all results       |
| `diagnostics.network.maxRequests`         | `50`                              |
| `dialog.appearance.themeColor`            | `'#537c0b'`                       |
| `dialog.appearance.submitButtonColor`     | theme color                       |

## Metadata

`metadata` accepts a static JSON object or a function invoked once when each report starts.

Use a static object when values are already current:

```ts
const bugpack = createBugPack({
    metadata: { application: 'customer-portal', release: '2026.09.06' },
    onSubmit: saveReport,
});
```

Use a resolver when values must be read or fetched at report time:

```ts
const bugpack = createBugPack({
    metadata: async ({ signal }) => {
        const response = await fetch('/api/report-context', { signal });
        return {
            application: 'customer-portal',
            userRole: currentUser.role,
            ...(await response.json()),
        };
    },
    onSubmit: saveReport,
});
```

The resolver may return immediately or return a Promise. Its `AbortSignal` is aborted when the active report is disabled or disposed.

Metadata must be a plain, finite, acyclic JSON object. Static metadata is validated during `createBugPack()`. Invalid or rejected dynamic metadata stops that report without submitting a partial result.

## Diagnostics

You can enable all three collectors without declaring every selection option:

```ts
diagnostics: {
    console: {
        enabled: true,
        maxEntries: 20,
    },
    network: {
        enabled: true,
        capture: ['fetch', 'xhr'],
        maxRequests: 20,
    },
    javascriptErrors: {
        enabled: true,
        maxEntries: 20,
    },
},
```

This retains the newest 20 `console.error()` calls, the newest 20 fetch/XHR requests across all statuses and failures, and the newest 20 uncaught errors or unhandled Promise rejections. Console `log` and `warn` calls are not included because `levels` defaults to `['error']`. The network `capture` option shown above can also be omitted because it already defaults to `['fetch', 'xhr']`.

### JavaScript errors

```ts
diagnostics: {
    javascriptErrors: {
        enabled: true,
        types: ['error', 'unhandledrejection'],
        maxEntries: 50,
    },
},
```

The `types` values are:

- `error`: an uncaught exception, such as `throw new Error('Something failed')`.
- `unhandledrejection`: a Promise rejection without a rejection handler.

Omitting `types` selects both. An empty array collects neither. `JavascriptErrorType` is exported for typed selections.

Each entry can contain its timestamp, type, sanitized message and stack, source URL, line, and column. Capture does not prevent the browser or application from handling the event.

Caught errors are not global JavaScript errors. A framework error handler may also catch an error before it reaches the browser listener. Such errors are available only if they are rethrown, become unhandled rejections, or are written to an enabled console level. Cross-origin scripts may expose only `Script error.` unless served with suitable CORS headers.

### Console messages

```ts
diagnostics: {
    console: {
        enabled: true,
        levels: ['log', 'warn', 'error'],
        maxEntries: 50,
    },
},
```

`levels` accepts `log`, `warn`, and `error`. It defaults to `['error']` after the collector is enabled. An empty array collects no calls. Each record contains a timestamp, level, and sanitized argument array.

An explicit `console.error()` is different from an uncaught JavaScript error: it is an application log call and does not require an exception. Enable both collectors if both forms of evidence are useful.

One console call retains at most 20 arguments. BugPack preserves the original console behavior and restores its patches when disabled or disposed.

### Network requests

```ts
diagnostics: {
    network: {
        enabled: true,
        capture: ['fetch', 'xhr'],
        statuses: ['2xx', '4xx', '5xx'],
        maxRequests: 50,
    },
},
```

`capture` accepts `fetch` and `xhr`; omitting it selects both APIs.

`statuses` accepts `2xx`, `3xx`, `4xx`, and `5xx`:

- When supplied, only matching completed HTTP responses are retained.
- Pending requests and transport failures without a status are excluded when the filter is present.
- An empty array retains no requests.
- When omitted, all results are retained, including pending requests and transport failures.

Records include the sanitized URL, method, timestamp, duration, lifecycle result, and response status when available. Sanitized textual response bodies and response headers may be included for `4xx` and `5xx` responses. Excluded responses do not consume buffer capacity.

## Privacy

Configure redaction and screenshot masking before enabling diagnostics in production:

```ts
privacy: {
    sensitiveKeys: ['accountNumber', 'customerId'],
    maskElementSelectors: ['[data-private]', '.secret'],
    blockNetworkHeaders: ['x-internal-session'],
    blockUrls: ['/auth', '/billing'],
},
```

Each privacy option applies to specific report data:

| Configuration          | Data it filters                                                                                                                                   | Behavior                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `sensitiveKeys`        | Metadata, console arguments, JavaScript error messages and stacks, network error response bodies, response header values, and sanitized page text | Redacts object properties with matching names and assigned text such as `accountNumber=123`   |
| `maskElementSelectors` | Screenshot only                                                                                                                                   | Covers matching elements and removes or darkens their visible content in the screenshot clone |
| `blockNetworkHeaders`  | Captured `4xx` and `5xx` response headers only                                                                                                    | Removes headers whose names match the configured values                                       |
| `blockUrls`            | Network records, the current page URL and route, and JavaScript error source URLs                                                                 | Drops matching network records and replaces other matching URL fields with `[BLOCKED]`        |

`maskElementSelectors` targets HTML/DOM elements using normal CSS selectors such as an ID (`#account-name`), class (`.secret`), or attribute (`[data-private]`). In the screenshot clone, BugPack covers the matching element area with a dark mask, removes URL-bearing attributes and visible text, clears form values, and darkens image, video, and canvas content. It does not redact the same value from metadata, console, network, or JavaScript error records. Use the other privacy settings for those report sections.

BugPack also treats common credential names—such as passwords, tokens, authorization values, and cookies—as sensitive. URL credentials, queries, and fragments are removed from retained URLs. Authorization and cookie response headers are removed.

Diagnostic serialization is bounded to 10,000 characters per string, 100 array items, 100 object properties, and eight nested levels. Truncation markers are added when a limit is reached. Metadata is validated separately and is not silently truncated.

Privacy filtering reduces accidental exposure but cannot identify every application-specific secret. Review metadata, selectors, console usage, network responses, and the report destination before production use.

## Dialog customization

```ts
const bugpack = createBugPack({
    dialog: {
        labels: {
            title: 'Report a problem',
            instructions: 'Highlight the issue and tell us what happened.',
            comment: 'Additional details (optional)',
            submit: 'Send report',
            cancel: 'Go back',
            eraser: 'Erase annotation',
        },
        appearance: { themeColor: '#2563eb' },
    },
    onSubmit: saveReport,
});
```

Omitted labels use their English defaults. Overrides are plain text, not HTML, and must be non-empty strings.

Available keys are `title`, `preparingScreenshot`, `instructions`, `close`, `annotationTools`, `drawingTools`, `annotationOptions`, `screenshotView`, `pencil`, `rectangle`, `select`, `eraser`, `annotationColor`, `fit`, `zoomIn`, `zoomOut`, `canvas`, `comment`, `clear`, `cancel`, `submit`, `maximize`, and `restore`. Tool labels also provide their tooltips and accessible names.

`themeColor` must be an opaque six-digit hexadecimal color. BugPack derives a light background and dark border/icon color from it for active action icons, and also uses it for the loading spinner and annotation selection. The Generate Report button uses this color by default.

`submitButtonColor` is an optional opaque six-digit hexadecimal override for only the Generate Report button. BugPack chooses contrasting button text and creates the hover treatment.

`reportButtonText` remains available as a legacy title option. `dialog.labels.title` takes precedence when both are provided.

### Annotation behavior

- Pencil draws freehand strokes.
- Rectangle draws outlined rectangles.
- Select moves and resizes rectangles and pans a zoomed screenshot.
- Eraser highlights the topmost stroke or rectangle border and deletes it when clicked or tapped.
- Zoom changes the screenshot inside a stable scrollable area.
- Maximize expands the dialog within the browser viewport, not browser fullscreen.

Empty rectangle interiors are not eraser targets, and eraser hover highlights are not exported.

## Report flow

Calling `report()`:

1. Opens a cancellable **Preparing screenshot…** dialog.
2. Resolves current metadata and captures the visible browser viewport in parallel.
3. Waits for currently captured network response bodies, then snapshots browser, page, JavaScript error, console, and network evidence.
4. Replaces the loading state with the annotation and optional-comment editor once the screenshot is ready.
5. Calls `onSubmit` only after the user confirms.

Closing or cancelling the dialog does not call `onSubmit`.

Resolver, capture, dialog, packaging, and `onSubmit` failures are handled internally. BugPack writes a privacy-safe console error with a stable code, without exposing the underlying error, and the user can retry. Invalid initial configuration and enabling a disposed instance can still throw synchronously because those are developer setup errors.

### Report error codes

| Code    | Meaning                                                       |
| ------- | ------------------------------------------------------------- |
| `BP100` | The report dialog or screenshot editor could not be prepared. |
| `BP110` | The visible-page screenshot could not be captured.            |
| `BP200` | Metadata or diagnostic evidence could not be collected.       |
| `BP300` | The ZIP report archive could not be created.                  |
| `BP400` | The application's `onSubmit` callback failed.                 |
| `BP900` | An unexpected report-generation failure occurred.             |

For example, a screenshot failure is logged as `[BugPack:BP110] Screenshot capture failed. Please try again.` The original caught error is deliberately not logged, as it can contain private application data. User cancellation, disabling, and disposal are expected actions and do not log an error.

## Output formats

### Object output

Object output is the default:

```ts
const bugpack = createBugPack({
    onSubmit: async (report) => {
        await uploadReport(report);
    },
});
```

The callback receives a `BugPackObjectReport`:

```ts
interface BugPackObjectReport {
    formatVersion: 1;
    metadata: JsonObject;
    browser: BrowserReport;
    page: PageReport;
    consoleLogs: ConsoleLogRecord[];
    networkLogs: NetworkLogRecord[];
    javascriptErrors: JavascriptErrorRecord[];
    screenshot: { contentType: 'image/png'; data: Blob };
    annotatedScreenshot: { contentType: 'image/png'; data: Blob };
    userComment: string;
}
```

`BrowserReport` contains the user agent, language, platform, viewport, and device pixel ratio. `PageReport` contains the sanitized URL, title, referrer, and route. Images are PNG `Blob` values rather than base64 strings.

### ZIP output

```ts
const bugpack = createBugPack({
    output: { format: 'zip' },
    onSubmit: async (archive) => {
        const url = URL.createObjectURL(archive);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        link.href = url;
        link.download = `customer-portal-${timestamp}.zip`;
        link.click();
        URL.revokeObjectURL(url);
    },
});
```

The callback receives an `application/zip` `Blob` containing `report.json`, `screenshot.png`, and `annotated-screenshot.png`. The JSON file contains diagnostics, metadata, and the user comment; the images remain separate PNG files. Your application chooses whether and where to upload or download it. The output option is a TypeScript discriminant, so `onSubmit` receives the correct report or `Blob` type.

## Complete example

```ts
import { createBugPack } from '@bugpack/core';

const bugpack = createBugPack({
    metadata: async ({ signal }) => {
        const response = await fetch('/api/report-context', { signal });
        return {
            application: 'customer-portal',
            release: '2026.09.06',
            ...(await response.json()),
        };
    },
    diagnostics: {
        javascriptErrors: {
            enabled: true,
            types: ['error', 'unhandledrejection'],
            maxEntries: 50,
        },
        console: {
            enabled: true,
            levels: ['warn', 'error'],
            maxEntries: 50,
        },
        network: {
            enabled: true,
            capture: ['fetch', 'xhr'],
            statuses: ['4xx', '5xx'],
            maxRequests: 50,
        },
    },
    privacy: {
        sensitiveKeys: ['accountNumber', 'customerId'],
        maskElementSelectors: ['[data-private]', '.secret'],
        blockNetworkHeaders: ['x-internal-session'],
        blockUrls: ['/auth', '/billing'],
    },
    dialog: {
        labels: { title: 'Report a problem', submit: 'Send report' },
        appearance: { themeColor: '#2563eb' },
    },
    output: { format: 'zip' },
    onSubmit: async (archive) => {
        await uploadArchive(archive);
    },
});

bugpack.enable();
document.querySelector('#report-bug')?.addEventListener('click', bugpack.report);

// Call during application teardown:
// bugpack.dispose();
```

## Exported TypeScript API

The package exports `createBugPack` and public types including:

- `BugPack`, `BugPackOptions`, `ObjectBugPackOptions`, and `ZipBugPackOptions`
- `DiagnosticsOptions`
- `JavascriptErrorDiagnosticsOptions`, `JavascriptErrorType`, and `JavascriptErrorRecord`
- `ConsoleDiagnosticsOptions`, `ConsoleLevel`, and `ConsoleLogRecord`
- `NetworkDiagnosticsOptions`, `NetworkCapture`, `NetworkStatusGroup`, and `NetworkLogRecord`
- `PrivacyOptions`
- `DialogOptions` and `DialogLabels`
- `BugPackObjectReport`, `DiagnosticReport`, `BrowserReport`, and `PageReport`
- `JsonObject`, `JsonValue`, and `JsonPrimitive`

```ts
import type { BugPackObjectReport, JavascriptErrorType, NetworkStatusGroup } from '@bugpack/core';
```

## Screenshot limitations

Screenshot capture uses `html2canvas-pro`, which reconstructs the visible viewport from the DOM instead of accessing operating-system pixels. It supports CSS Color 4 functions such as `color()`, `oklch()`, `lab()`, and `lch()`. Cross-origin images without CORS permission, browser plug-ins, video frames, and some advanced CSS may not render exactly.

Pages without an explicit background use a white fallback so the editor background does not alter their appearance. Explicit page backgrounds are respected. This does not guarantee pixel-identical colors for every CSS effect or unsupported color format. Capture failures do not submit a partial report.

## Development

```sh
yarn install
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
```
