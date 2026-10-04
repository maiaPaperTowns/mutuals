import { expect, it } from 'vitest';
import { readResumeText } from '../src/resumeText';

const file = (text: string, name = 'resume.txt') => ({ name, size: text.length,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer } as File);
it('reads bounded UTF-8 resume text without uploading file bytes', async () => {
  expect(await readResumeText(file(' Python engineer '))).toBe('Python engineer');
  expect((await readResumeText(file('a'.repeat(16000)))).length).toBe(15000);
});
it('rejects empty, unsupported and oversized resumes', async () => {
  await expect(readResumeText(file(' '))).rejects.toThrow('readable');
  await expect(readResumeText(file('hello', 'resume.docx'))).rejects.toThrow('PDF or');
  await expect(readResumeText({ name: 'resume.txt', size: 11 * 1024 * 1024 } as File)).rejects.toThrow('10 MB');
});
