// PDF в браузере: те же шаблоны квитанции и акта, что и на сервере, шрифт Roboto из pdfmake (с кириллицей).
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

export async function renderPdf(def: TDocumentDefinitions): Promise<Uint8Array> {
  const [{ default: pdfMake }, vfsModule] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const raw: any = vfsModule;
  const vfs = raw.default?.pdfMake?.vfs ?? raw.default ?? raw.pdfMake?.vfs ?? raw;
  const maker: any = pdfMake;
  if (typeof maker.addVirtualFileSystem === 'function') maker.addVirtualFileSystem(vfs);
  else maker.vfs = vfs;
  return new Promise((resolve) => {
    maker.createPdf(def).getBuffer((buf: Uint8Array) => resolve(buf));
  });
}
