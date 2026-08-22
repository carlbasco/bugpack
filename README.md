# @bugpack/core

Framework-agnostic browser library for collecting bounded client-side diagnostics and handing a portable bug report to an application-provided callback. BugPack does not upload or persist reports itself.

## Usage

```ts
import { createBugPack } from '@bugpack/core';

const bugpack = createBugPack({
    metadata: { application: 'customer-portal', release: '2026.07.29' },
    resolveMetadata: async ({ signal }) => {
        const response = await fetch('/api/report-context', { signal });
        return response.json();
    },
    diagnostics: {
        console: { enabled: true, maxEntries: 50 },
        network: { enabled: true, maxRequests: 50, capture: ['fetch', 'xhr'] },
    },
    floatingButton: { enabled: true, position: 'bottom-right' },
    privacy: {
        sensitiveKeys: ['accountNumber', 'customerId'],
        maskTextSelectors: ['[data-private]', '.secret'],
        blockUrls: ['/auth', '/billing'],
    },
    onSubmit: async (report) => {
        // `report.screenshot.data` and `report.annotatedScreenshot.data` are PNG Blobs.
        await saveReport(report);
    },
});

bugpack.enable();
```

`enable()` starts configured collectors and mounts the floating button. `disable()` stops collectors, removes the UI, and cancels an active report; the same instance can later be enabled again. `dispose()` permanently restores patched APIs, clears buffers, removes UI, and makes the instance unusable. `report()` can be called programmatically while the instance is enabled or disabled.

The floating button supports `bottom-right`, `bottom-left`, `top-right`, `top-left`, `middle-right`, and `middle-left` positions.

Only the newest configured number of console and network records are retained. Both collectors are disabled unless explicitly enabled. The floating button is enabled by default.

To keep individual diagnostic entries bounded, one console call retains at most 20 arguments. Diagnostic serialization keeps up to 10,000 characters per string, 100 array items, 100 object properties, and eight nested levels, adding explicit truncation markers when a limit is reached. Developer metadata is validated separately and is never silently truncated.

## Report flow

Calling `report()` performs the same flow as selecting the floating button:

1. Resolve and merge current metadata.
2. Snapshot browser, page, console, and network evidence.
3. Capture the visible viewport.
4. Open the annotation and optional-comment dialog. Pencil, rectangle, circle, and text tools are available with a configurable annotation color; annotations can be selected, moved, resized where applicable, or deleted before report generation.
5. Call `onSubmit` only after the user confirms.

Only one report flow can run per instance. Resolver, capture, and submission errors reject the `report()` promise. Errors from the floating button are emitted as a bubbling `bugpack:error` custom event from the button host.

Static and resolved metadata must be plain, finite, acyclic JSON data. Invalid metadata fails initialization or rejects the report flow; it is never silently coerced or partially submitted.

Object output is the default. Image data is passed as `Blob` assets and is not embedded as base64 JSON.

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

The callback receives an `application/zip` `Blob` containing `report.json` and two PNG files. Choose the download name in `onSubmit`; this lets the application incorporate its own metadata and timestamp. The output option is a TypeScript discriminant, so the callback parameter is typed as either a report object or a ZIP `Blob`.

## Privacy behavior

- URL credentials, query parameters, and fragments are removed before network records are retained.
- Blocked URLs are not retained at all.
- Failed HTTP responses may include sanitized, truncated textual response bodies and response headers. Authorization and cookie headers are redacted; add other sensitive header names to `blockNetworkHeaders`.
- Common credential fields and configured sensitive keys are redacted recursively from console arguments and metadata.
- Configured DOM selectors are masked in the cloned document before screenshot pixels are rendered.
- Collection remains in memory until disposal. BugPack has no transport, storage, identity, category, backend, or third-party integration.

## Screenshot limitations

Screenshot capture uses `html2canvas`, which reconstructs the current viewport from the DOM rather than accessing operating-system pixels. Cross-origin images without CORS permission, browser plug-ins, video frames, and some advanced CSS may not render exactly. Capture failures reject `report()` and do not submit a partial report.

## Development

```sh
yarn install
yarn format:check
yarn lint
yarn typecheck
yarn test
yarn build
```
