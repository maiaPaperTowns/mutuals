// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { FavoritePeople, HomeNavigation } from '../src/HomePanels';

afterEach(cleanup);
const events = [{ eventId: 'old', title: 'Past meetup', phase: 'post' }, { eventId: 'now', title: 'Live meetup', phase: 'during' }];

it('deduplicates favorites across events and highlights ongoing memberships without GPS', () => {
  const stars = [{ eventId: 'old', targetId: 'alex' }, { eventId: 'now', targetId: 'alex' }, { eventId: 'old', targetId: 'sam' }];
  const { rerender } = render(<FavoritePeople stars={stars} events={events} names={{ alex: 'Alex', sam: 'Sam' }} signedIn />);
  fireEvent.click(screen.getByText('People'));
  expect(screen.getAllByText('Alex')).toHaveLength(1);
  const alex = screen.getByText('Alex').closest('li')!;
  expect(within(alex).getByText('Ongoing event')).toBeTruthy();
  expect(within(alex).getByRole('link', { name: 'Live meetup' }).getAttribute('href')).toBe('/events?event=now');
  expect(within(screen.getByText('Sam').closest('li')!).queryByText('Ongoing event')).toBeNull();
  rerender(<FavoritePeople stars={[]} events={events} names={{}} signedIn={false} />);
  expect(screen.queryByText('Alex')).toBeNull();
  expect(screen.getByText('Sign in to see your starred people.')).toBeTruthy();
});

it('lists real events and all three role threads without a phase lock', () => {
  render(<HomeNavigation events={events} memberEventIds={['now']} signedIn />);
  fireEvent.click(screen.getByText('Events'));
  expect(screen.getByRole('link', { name: 'Past meetup' }).getAttribute('href')).toBe('/events?event=old');
  fireEvent.click(screen.getByText('Assistance'));
  expect(screen.getAllByRole('link', { name: 'Live meetup' }).some(link => link.getAttribute('href') === '/assistant?event=now')).toBe(true);
  expect(screen.getByRole('link', { name: 'All agent chats' })).toBeTruthy();
});

it('highlights a past-event favorite when they also belong to an ongoing event', () => {
  render(<FavoritePeople stars={[{ eventId: 'old', targetId: 'alex' }]} events={events} names={{ alex: 'Alex' }} ongoingEventsByPerson={{ alex: ['now'] }} signedIn />);
  fireEvent.click(screen.getByText('People'));
  expect(screen.getByText('Ongoing event')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Live meetup' })).toBeTruthy();
});
