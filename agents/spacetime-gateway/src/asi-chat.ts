type ChatInput = { sessionKey: string; requestId: string; message: string };
type Api = {
  redeemAsiLinkCode(args: { sessionKey: string; requestId: string; code: string }): Promise<string>;
  getAsiChatContext(args: { sessionKey: string }): Promise<string>;
  selectAsiEvent(args: { sessionKey: string; eventId: string }): Promise<unknown>;
  unlinkAsiChat(args: { sessionKey: string }): Promise<unknown>;
  sendAsiAssistantMessage(args: ChatInput & { eventId: string }): Promise<string>;
  generateAsiEventRecap(args: { sessionKey: string; eventId: string; requestId: string }): Promise<string>;
};

export async function dispatchChat(api: Api, value: unknown): Promise<{ reply: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a chat object.');
  const input = value as ChatInput;
  if (Object.keys(input).some(key => !['sessionKey', 'requestId', 'message'].includes(key))) throw new Error('Unexpected chat field.');
  if (!/^[a-f0-9]{64}$/.test(input.sessionKey) || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId)
    || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000) throw new Error('Invalid chat request.');
  const message = input.message.trim();
  if (message.toLowerCase() === 'unlink') {
    await api.unlinkAsiChat({ sessionKey: input.sessionKey }); return { reply: 'This chat is disconnected from your mutuals account.' };
  }
  if (/^link\s+/i.test(message)) {
    const code = message.replace(/^link\s+/i, '').trim();
    if (!/^[a-f0-9]{32}$/.test(code)) return { reply: 'Use link <code> with the five-minute code from your mutuals website account.' };
    try {
      await api.redeemAsiLinkCode({ sessionKey: input.sessionKey, requestId: input.requestId, code });
      return { reply: 'Your mutuals account is linked to this chat for up to 24 hours. Ask about your events, or send events to choose one. Send unlink to disconnect.' };
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      if (/code|profile|switching accounts/i.test(text)) return { reply: 'The code could not be redeemed. It may be expired or already used. Save your website profile and generate a new code; unlink first to switch accounts.' };
      throw e;
    }
  }
  let context: { events: Array<{ event_id: string; title: string; phase: string }>; selected_event_id: string };
  try { context = JSON.parse(await api.getAsiChatContext({ sessionKey: input.sessionKey })); }
  catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    if (/authorization|link.*again|website profile/i.test(text)) return { reply: 'Link your account first: sign in at https://mhacks-live-map.vercel.app/events, generate a code, then send link <code>. Pre and Post work here; During uses website GPS.' };
    throw e;
  }
  const choices = context.events.map(event => `${event.title} (${event.phase}) — event ${event.event_id}`).join('\n');
  if (/^events$/i.test(message)) return { reply: choices || 'You have not joined an event on the mutuals website yet.' };
  if (/^event\s+/i.test(message)) {
    const eventId = message.replace(/^event\s+/i, '').trim(), event = context.events.find(row => row.event_id === eventId);
    if (!event) return { reply: 'That event is unavailable to your account.\n' + choices };
    await api.selectAsiEvent({ sessionKey: input.sessionKey, eventId }); return { reply: `Selected ${event.title} (${event.phase}). Ask your Pre/Post assistant a question. In Post, send recap for a complete event review.` };
  }
  const selected = context.events.find(row => row.event_id === context.selected_event_id) ?? (context.events.length === 1 ? context.events[0] : undefined);
  if (!selected) return { reply: context.events.length ? 'Select an event by sending its event command:\n' + choices : 'Join an event on the mutuals website before using its assistants.' };
  if (/^(recap|回顾|总结活动)$/i.test(message) && selected.phase === 'post') {
    return JSON.parse(await api.generateAsiEventRecap({ sessionKey: input.sessionKey, eventId: selected.event_id, requestId: input.requestId }));
  }
  return JSON.parse(await api.sendAsiAssistantMessage({ ...input, eventId: selected.event_id }));
}
