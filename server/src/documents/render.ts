import { createRequire } from 'node:module';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

const require = createRequire(import.meta.url);
// Roboto из пакета pdfmake: полный набор глифов с кириллицей, без внешних загрузок.
const PdfPrinter = require('pdfmake');
const vfs: Record<string, string> = require('pdfmake/build/vfs_fonts.js');

const font = (name: string) => Buffer.from(vfs[name], 'base64');

const printer = new PdfPrinter({
  Roboto: {
    normal: font('Roboto-Regular.ttf'),
    bold: font('Roboto-Medium.ttf'),
    italics: font('Roboto-Italic.ttf'),
    bolditalics: font('Roboto-MediumItalic.ttf'),
  },
});

export function renderPdf(def: TDocumentDefinitions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(def);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
