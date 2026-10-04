// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProfileChat from '../src/ProfileChat';
import { createProfileApi } from '../src/profileApi';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const profile = { user_id: 'server-derived', name: 'Terry', headline: 'Builder', skills: ['Python'], interests: [], goals: [], offerings: [], introduction: 'I build robots.' };
const api = () => ({ load: vi.fn().mockResolvedValue({ profile: null }), submit: vi.fn().mockResolvedValue(profile) });

describe('profile intake', () => {
  it('asks signed-out users to log in without sending data', async () => {
    const client = api(); const login = vi.fn();
    render(<ProfileChat signedIn={false} accountName="Terry" api={client} onSignIn={login} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in to start' }));
    expect(login).toHaveBeenCalledOnce(); expect(client.load).not.toHaveBeenCalled();
  });
  it('restores a saved profile and accepts text plus a resume', async () => {
    const client = api(); client.load.mockResolvedValue({ profile });
    render(<ProfileChat signedIn accountName="Terry" api={client} onSignIn={() => {}} />);
    await screen.findByText('Builder');
    await userEvent.type(screen.getByLabelText('Your introduction'), 'Looking for a designer.');
    const file = new File(['Python developer'], 'resume.txt', { type: 'text/plain' });
    await userEvent.upload(screen.getByLabelText('Attach resume'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Save to my profile' }));
    await waitFor(() => expect(client.submit).toHaveBeenCalledWith('Looking for a designer.', file));
    await screen.findByText('Your profile is saved. You can add more whenever you like.');
    expect((screen.getByLabelText('Your introduction') as HTMLTextAreaElement).value).toBe('');
  });
  it('keeps the draft and attachment when storage fails', async () => {
    const client = api(); client.submit.mockRejectedValue(new Error('Storage unavailable'));
    render(<ProfileChat signedIn accountName="Terry" api={client} onSignIn={() => {}} />);
    await waitFor(() => expect(client.load).toHaveBeenCalledOnce());
    await userEvent.type(screen.getByLabelText('Your introduction'), 'My introduction');
    await userEvent.upload(screen.getByLabelText('Attach resume'), new File(['resume'], 'resume.txt', { type: 'text/plain' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save to my profile' }));
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Your introduction') as HTMLTextAreaElement).value).toBe('My introduction');
    expect(screen.getByText(/resume\.txt/)).toBeTruthy();
    expect(screen.queryByText('Your profile is saved. You can add more whenever you like.')).toBeNull();
  });
  it('uses a fresh JWT and bootstraps identity before each API request', async () => {
    const getToken = vi.fn().mockResolvedValueOnce('jwt-one').mockResolvedValueOnce('jwt-two');
    const ensureAccount = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ profile }), { status: 200 }));
    const client = createProfileApi('http://localhost:8101/', getToken, ensureAccount);
    await client.load(); await client.submit('Hello', undefined);
    expect(ensureAccount).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('http://localhost:8101/onboarding/profile');
    expect((fetcher.mock.calls[1][1]?.headers as Record<string, string>).Authorization).toBe('Bearer jwt-two');
    const body = fetcher.mock.calls[1][1]?.body as FormData;
    expect(body.get('message')).toBe('Hello'); expect(body.get('user_id')).toBeNull();
  });
  it('does not send unauthenticated requests or overwrite an existing draft with a prompt', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(createProfileApi('http://localhost:8101', async () => null, async () => {}).load()).rejects.toThrow('session expired');
    expect(fetcher).not.toHaveBeenCalled();
    const client = api();
    render(<ProfileChat signedIn accountName="Terry" api={client} onSignIn={() => {}} />);
    await waitFor(() => expect(client.load).toHaveBeenCalledOnce());
    await userEvent.type(screen.getByLabelText('Your introduction'), 'My existing introduction');
    await userEvent.click(screen.getByRole('button', { name: 'I can help with…' }));
    expect((screen.getByLabelText('Your introduction') as HTMLTextAreaElement).value).toBe('My existing introduction\nI can help with…');
  });
  it('rejects unsupported attachments before sending a request', async () => {
    const client = api();
    render(<ProfileChat signedIn accountName="Terry" api={client} onSignIn={() => {}} />);
    await waitFor(() => expect(client.load).toHaveBeenCalledOnce());
    await userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText('Attach resume'), new File(['document'], 'resume.docx'));
    expect((await screen.findByRole('alert')).textContent).toContain('PDF or plain text');
    expect(client.submit).not.toHaveBeenCalled();
  });
});
