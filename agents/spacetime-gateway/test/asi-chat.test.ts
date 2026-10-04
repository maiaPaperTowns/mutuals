import assert from 'node:assert/strict';
import test from 'node:test';

test('bridge uses account-scoped event selection and refuses arbitrary user identifiers', async () => {
  const { dispatchChat } = await import('../src/asi-chat.ts');
  const calls: any[] = [];
  const api: any = {
    getAsiChatContext: async () => JSON.stringify({ events: [{ event_id: 'e1', title: 'One', phase: 'pre' }, { event_id: 'e2', title: 'Two', phase: 'post' }], selected_event_id: '' }),
    selectAsiEvent: async (args: any) => { calls.push(args); },
    sendAsiAssistantMessage: async (args: any) => { calls.push(args); return JSON.stringify({ reply: 'Saved', actions: [{ tool: 'set_star' }] }); },
  };
  const input = { sessionKey: 'a'.repeat(64), requestId: 'asi-test', message: 'Help me' };
  assert.match((await dispatchChat(api, input)).reply, /select/i); assert.equal(calls.length, 0);
  assert.match((await dispatchChat(api, { ...input, message: 'event e3' })).reply, /unavailable/i); assert.equal(calls.length, 0);
  assert.match((await dispatchChat(api, { ...input, message: 'event e2' })).reply, /Two/);
  assert.equal(calls[0].eventId, 'e2');
  await assert.rejects(dispatchChat(api, { ...input, userId: 'victim' }), /field/i);
});

test('bridge distinguishes authorization failures from provider failures and forwards exact recap requests', async () => {
  const { dispatchChat } = await import('../src/asi-chat.ts');
  const input = { sessionKey: 'a'.repeat(64), requestId: 'asi-test', message: 'recap' };
  const api: any = { getAsiChatContext: async () => { throw new Error('Chat authorization unavailable. Link again.'); } };
  assert.match((await dispatchChat(api, input)).reply, /link/i);
  api.getAsiChatContext = async () => { throw 'The module instance encountered a fatal error: Chat authorization is unavailable or expired. Link your website account again.'; };
  assert.match((await dispatchChat(api, input)).reply, /Link your account first/);
  api.getAsiChatContext = async () => JSON.stringify({ events: [{ event_id: 'e1', title: 'One', phase: 'post' }], selected_event_id: '' });
  let received: any;
  api.generateAsiEventRecap = async (args: any) => { received = args; return '{"reply":"Actual recap"}'; };
  assert.equal((await dispatchChat(api, input)).reply, 'Actual recap'); assert.equal(received.requestId, input.requestId);
  api.generateAsiEventRecap = async () => { throw new Error('ASI unavailable'); };
  await assert.rejects(dispatchChat(api, input), /ASI unavailable/);
});
