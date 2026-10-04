import { expect, it, vi } from 'vitest';
import { createCloudProfileApi } from '../src/profileApi';

it('calls cloud procedures after account readiness, without a separate HTTP backend', async () => {
  const ensure = vi.fn().mockResolvedValue(undefined);
  const load = vi.fn().mockImplementation(async () => {
    expect(ensure).toHaveBeenCalledOnce(); return JSON.stringify({ profile: null });
  });
  const submit = vi.fn().mockResolvedValue('{"user_id":"cloud-owner","name":"Terry"}');
  const api = createCloudProfileApi(load, submit, ensure);
  expect(await api.load()).toEqual({ profile: null });
  expect(await api.submit(' Hello ')).toEqual({ user_id: 'cloud-owner', name: 'Terry' });
  expect(submit).toHaveBeenCalledWith({ message: 'Hello', resumeText: '', filename: '' });
});

it('preserves the draft and skips cloud submission when resume parsing fails', async () => {
  const submit = vi.fn();
  const api = createCloudProfileApi(vi.fn(), submit, async () => {}, async () => { throw new Error('Unreadable resume'); });
  await expect(api.submit('Hello', {} as File)).rejects.toThrow('Unreadable resume');
  expect(submit).not.toHaveBeenCalled();
});
