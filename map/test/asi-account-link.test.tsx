// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AsiAccountLink from '../src/AsiAccountLink';

afterEach(cleanup);

it('only a signed-in account can generate a code, and revoked access disappears', async () => {
  let connected = false;
  const props = { signedIn: true, isActive: true,
    createCode: async () => JSON.stringify({ code: 'a'.repeat(32), expires_at: new Date(Date.now() + 300000).toISOString() }),
    getStatus: async () => JSON.stringify({ connected, expires_at: null }),
    revoke: async () => { connected = false; },
  };
  const { rerender } = render(<AsiAccountLink {...props} signedIn={false} />);
  expect(screen.queryByRole('button', { name: 'Generate link code' })).toBeNull();
  rerender(<AsiAccountLink {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate link code' }));
  expect(await screen.findByText('link ' + 'a'.repeat(32))).toBeTruthy();
  connected = true;
  fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
  await screen.findByText('ASI:One connected');
  expect(screen.queryByText('link ' + 'a'.repeat(32))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect ASI:One' }));
  await screen.findByText('ASI:One is not connected');
});

it('does not expose expired codes or claim a failed connection succeeded', async () => {
  render(<AsiAccountLink signedIn isActive createCode={async () => JSON.stringify({ code: 'expired-secret', expires_at: new Date(0).toISOString() })}
    getStatus={async () => JSON.stringify({ connected: false })} revoke={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Generate link code' }));
  await screen.findByText(/expired/i);
  expect(screen.queryByText('link expired-secret')).toBeNull();
});
