export async function readResumeText(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Your resume must be 10 MB or smaller.');
  if (!/\.(pdf|txt)$/i.test(file.name)) throw new Error('Please attach a PDF or plain text resume.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = '';
  if (/\.txt$/i.test(file.name)) {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('Your text resume must use UTF-8 encoding.'); }
  } else {
    try {
      const pdfjs = await import('pdfjs-dist');
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const loading = pdfjs.getDocument({ data: bytes });
      const document = await loading.promise;
      try {
        for (let page = 1; page <= document.numPages && text.length < 15000; page++) {
          const content = await (await document.getPage(page)).getTextContent();
          text += content.items.map(item => 'str' in item ? item.str : '').join(' ') + '\n';
        }
      } finally { await loading.destroy(); }
    } catch { throw new Error('Could not read this PDF. Use a text-based PDF or UTF-8 TXT resume.'); }
  }
  text = text.trim();
  if (!text) throw new Error('This file contains no readable text. Use a text-based PDF or TXT resume.');
  return text.slice(0, 15000);
}
