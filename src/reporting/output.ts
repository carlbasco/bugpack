import { strToU8, zip } from 'fflate';
import type { BugPackObjectReport } from './types.js';

export async function createZipOutput(report: BugPackObjectReport): Promise<Blob> {
    const {
        screenshot: screenshotAsset,
        annotatedScreenshot: annotatedScreenshotAsset,
        ...manifest
    } = report;
    const screenshot = new Uint8Array(await screenshotAsset.data.arrayBuffer());
    const annotatedScreenshot = new Uint8Array(await annotatedScreenshotAsset.data.arrayBuffer());
    const archive = await new Promise<Uint8Array>((resolve, reject) => {
        zip(
            {
                'report.json': strToU8(JSON.stringify(manifest, null, 2)),
                'screenshot.png': [screenshot, { level: 0 }],
                'annotated-screenshot.png': [annotatedScreenshot, { level: 0 }],
            },
            { level: 0 },
            (error, result) => (error === null ? resolve(result) : reject(error)),
        );
    });
    return new Blob([new Uint8Array(archive).buffer], { type: 'application/zip' });
}
