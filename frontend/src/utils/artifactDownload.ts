import { toCanvas } from 'html-to-image';

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function sanitizeFileBaseName(name: string): string {
  return (name || 'artifact').replace(/[^\w.-]+/g, '_');
}

function getExportTarget(root: HTMLElement): {
  node: HTMLElement;
  width: number;
  height: number;
} {
  const svg = root.querySelector('svg');
  if (svg) {
    const rect = svg.getBoundingClientRect();
    const host =
      svg.parentElement instanceof HTMLElement ? svg.parentElement : root;
    return {
      node: host,
      width: Math.max(1, Math.round(rect.width || root.clientWidth || 1600)),
      height: Math.max(1, Math.round(rect.height || root.clientHeight || 900)),
    };
  }

  const iframe = root.querySelector('iframe') as HTMLIFrameElement | null;
  if (iframe?.contentDocument?.body) {
    const doc = iframe.contentDocument;
    const html = doc.documentElement;
    return {
      node: doc.body,
      width: Math.max(
        1,
        Math.round(
          html.scrollWidth || doc.body.scrollWidth || iframe.clientWidth || root.clientWidth || 1600,
        ),
      ),
      height: Math.max(
        1,
        Math.round(
          html.scrollHeight || doc.body.scrollHeight || iframe.clientHeight || root.clientHeight || 900,
        ),
      ),
    };
  }

  const rect = root.getBoundingClientRect();
  return {
    node: root,
    width: Math.max(1, Math.round(rect.width || root.clientWidth || 1600)),
    height: Math.max(1, Math.round(rect.height || root.clientHeight || 900)),
  };
}

async function exportArtifactPreviewAsImage(opts: {
  previewRoot: HTMLElement | null;
  fileNameBase?: string;
  format: 'png' | 'jpg';
}): Promise<void> {
  const root = opts.previewRoot;
  if (!root) throw new Error('Preview артефакта ещё не готов.');

  const fileBase = sanitizeFileBaseName(opts.fileNameBase || 'artifact');
  const target = getExportTarget(root);
  const canvas = await toCanvas(target.node, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    canvasWidth: target.width,
    canvasHeight: target.height,
    width: target.width,
    height: target.height,
  });
  const mime = opts.format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      resolve,
      mime,
      opts.format === 'jpg' ? 0.92 : undefined,
    );
  });
  if (!blob) {
    throw new Error(`Не удалось собрать ${opts.format.toUpperCase()} из preview артефакта.`);
  }
  downloadBlob(blob, `${fileBase}.${opts.format === 'jpg' ? 'jpg' : 'png'}`);
}

export async function exportArtifactPreviewAsPng(opts: {
  previewRoot: HTMLElement | null;
  fileNameBase?: string;
}): Promise<void> {
  return exportArtifactPreviewAsImage({ ...opts, format: 'png' });
}

export async function exportArtifactPreviewAsJpg(opts: {
  previewRoot: HTMLElement | null;
  fileNameBase?: string;
}): Promise<void> {
  return exportArtifactPreviewAsImage({ ...opts, format: 'jpg' });
}
