// mutuals FREE-WILi badge ↔ live map, over USB with Web Serial (Chrome / Edge; https or localhost).
//
// The badge runs the mutuals app (freewili/native). Its display CPU shows up as a USB serial port; once
// connected, the map sends it one line a second and the badge answers with button presses and its points:
//   map → badge:  "M <s> <nearby> <meters> <points> <met> <name>"
//                 s = H not discoverable · A sharing, nobody near · N someone near · C right here
//                 "N <my name>"   the first name this badge broadcasts to nearby badges (radio) while discoverable
//                 "T C" | "T F"   style: cute (clubs, mixers) or formal (recruiting events)
//                 "C a,b,c"       your connections' names, newest first (badge: MENU → NEXT)
//   badge → map:  "B yellow" | "B green" | "B blue" | "B red"   (MENU opens stats on the badge itself)
//                 "P <points> <caught> <met>"  points the badge earned itself: practice, radio finds (higher wins)
//                 "R <count> <rssi> <name>"    other mutuals badges its radio hears right now (no GPS needed)
//                 "F <id> <name>"              its radio just found someone new (added to your connections)
// The badge falls back to its mini-game when the lines stop (5 s), so closing the tab is always safe.
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';

export const NEAR_METERS = 150;   // indoor GPS drifts tens of meters, so "nearby" is generous
export const CLOSE_METERS = 25;

type Pin = { participantId: string; latitude: number; longitude: number };
export type BadgeButton = 'green' | 'red' | 'yellow' | 'blue' | 'gray';
export type BadgeStatus = {
  state: 'H' | 'A' | 'N' | 'C'; nearby: number; meters: number; name: string;
  nearbyIds: string[]; closestId?: string;
};

// Minimal Web Serial typings (not in TypeScript's DOM lib yet).
type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
};
type SerialLike = { requestPort(options?: { filters: { usbVendorId: number; usbProductId?: number }[] }): Promise<SerialPortLike> };
const serial = (): SerialLike | undefined => (navigator as Navigator & { serial?: SerialLike }).serial;

// FREE-WILi OG app USB ids (wiliOGbsp): 093C:2055 is the display CPU, where the pup app listens.
const FREEWILI_VID = 0x093c;
const DISPLAY_PID = 0x2055;

export const badgeSupported = () => Boolean(serial());

/** What the badge should show, from the same pins the map draws. */
export function badgeStatus(pins: Pin[], myId: string, sharing: boolean, nameOf: (id: string) => string | undefined): BadgeStatus {
  const mine = pins.find(pin => pin.participantId === myId);
  if (!sharing) return { state: 'H', nearby: 0, meters: 0, name: '', nearbyIds: [] };
  if (!mine) return { state: 'A', nearby: 0, meters: 0, name: '', nearbyIds: [] };
  const near = pins
    .filter(pin => pin.participantId !== myId)
    .map(pin => ({ pin, meters: L.latLng(mine.latitude, mine.longitude).distanceTo([pin.latitude, pin.longitude]) }))
    .filter(entry => entry.meters <= NEAR_METERS)
    .sort((a, b) => a.meters - b.meters);
  if (!near.length) return { state: 'A', nearby: 0, meters: 0, name: '', nearbyIds: [] };
  const nearest = near[0]!;
  return {
    state: nearest.meters <= CLOSE_METERS ? 'C' : 'N',
    nearby: near.length,
    meters: Math.round(nearest.meters),
    name: nameOf(nearest.pin.participantId) ?? 'someone',
    nearbyIds: near.map(entry => entry.pin.participantId),
    closestId: nearest.meters <= CLOSE_METERS ? nearest.pin.participantId : undefined,
  };
}

/** The badge screen is ASCII only and narrow: plain letters, at most 22 characters. */
const badgeText = (text: string) => text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 22);

export type BadgeScore = { points: number; met: number };
export type RadioPeer = { count: number; rssi: number; name: string; at: number };

export function badgeLine(status: BadgeStatus, score: BadgeScore): string {
  return `M ${status.state} ${status.nearby} ${status.meters} ${score.points} ${score.met} ${badgeText(status.name)}\n`;
}

/** Connect / disconnect the badge, send it a status every second, hear its buttons and its practice points. */
export function useBadge(status: BadgeStatus, score: BadgeScore, myName: string, formal: boolean, connectionNames: string[],
  onButton: (button: BadgeButton) => void, onPoints: (points: number, caught: number, met: number) => void,
  onFound: (badgeId: string, name: string) => void) {
  const [radio, setRadio] = useState<RadioPeer | null>(null);
  const [lastButton, setLastButton] = useState<{ button: BadgeButton; at: number } | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const portRef = useRef<SerialPortLike | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const lineRef = useRef('');
  const buttonRef = useRef(onButton);
  const pointsRef = useRef(onPoints);
  const foundRef = useRef(onFound);
  foundRef.current = onFound;
  const firstName = badgeText(myName.split(/\s+/)[0] ?? '').slice(0, 12);
  const names = connectionNames.map(n => badgeText(n.split(/\s+/)[0] ?? '').replace(/,/g, '').slice(0, 12)).filter(Boolean).slice(0, 8);
  const line = badgeLine(status, score) + `N ${firstName}\nT ${formal ? 'F' : 'C'}\nC ${names.join(',')}\n`;
  lineRef.current = line;
  buttonRef.current = onButton;
  pointsRef.current = onPoints;

  const disconnect = useCallback(async () => {
    setConnected(false);
    const reader = readerRef.current, writer = writerRef.current, port = portRef.current;
    readerRef.current = writerRef.current = portRef.current = null;
    try { await reader?.cancel(); } catch { /* already closed */ }
    try { reader?.releaseLock(); } catch { /* already released */ }
    try { writer?.releaseLock(); } catch { /* already released */ }
    try { await port?.close(); } catch { /* unplugged */ }
  }, []);

  const send = useCallback(async (line: string) => {
    const writer = writerRef.current;
    if (!writer) return;
    try {
      await writer.write(new TextEncoder().encode(line));
    } catch {
      setError('The badge was unplugged.');
      void disconnect();
    }
  }, [disconnect]);

  const connect = useCallback(async () => {
    setError('');
    const api = serial();
    if (!api) { setError('Connecting a badge needs Chrome or Edge on a computer.'); return; }
    try {
      const port = await api.requestPort({ filters: [{ usbVendorId: FREEWILI_VID, usbProductId: DISPLAY_PID }] });
      await port.open({ baudRate: 115200 }); // USB CDC ignores the rate (never 1200: that reboots the badge)
      portRef.current = port;
      writerRef.current = port.writable!.getWriter();
      setConnected(true);
      void send('?\n'); // the badge answers with its practice points
      void send(lineRef.current);
      const reader = port.readable!.getReader();
      readerRef.current = reader;
      void (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newline).trim();
              buffer = buffer.slice(newline + 1);
              const button = /^B (green|red|yellow|blue|gray)$/.exec(line);
              if (button) {
                setLastButton({ button: button[1] as BadgeButton, at: Date.now() });
                buttonRef.current(button[1] as BadgeButton);
              }
              const pts = /^P (\d+) (\d+)(?: (\d+))?$/.exec(line);
              if (pts) pointsRef.current(Number(pts[1]), Number(pts[2]), Number(pts[3] ?? 0));
              const found = /^F ([0-9a-f]{8}) ?(.*)$/.exec(line);
              if (found) foundRef.current(found[1]!, found[2] ?? '');
              const heard = /^R (\d+) (-?\d+) ?(.*)$/.exec(line);
              if (heard) setRadio({ count: Number(heard[1]), rssi: Number(heard[2]), name: heard[3] ?? '', at: Date.now() });
            }
          }
        } catch {
          setError('Lost the badge connection.');
        }
        void disconnect();
      })();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return; // closed the picker
      setError("Couldn't open the badge. Is the pup app running and nothing else using the port?");
      void disconnect();
    }
  }, [disconnect, send]);

  // Heartbeat: the badge leaves map mode after 5 s of silence, so send every second (and on every change).
  useEffect(() => { if (connected) void send(line); }, [connected, line, send]);
  useEffect(() => {
    if (!connected) return;
    const timer = window.setInterval(() => void send(lineRef.current), 1000);
    return () => window.clearInterval(timer);
  }, [connected, send]);
  useEffect(() => () => { void disconnect(); }, [disconnect]);
  // Radio reports arrive every second while someone's heard; drop the last one after 3 s of silence.
  useEffect(() => {
    if (!radio) return;
    const timer = window.setTimeout(() => setRadio(null), 3000);
    return () => window.clearTimeout(timer);
  }, [radio]);

  // Show the last badge button press for a few seconds, so it's visible that the press arrived.
  useEffect(() => {
    if (!lastButton) return;
    const timer = window.setTimeout(() => setLastButton(null), 4000);
    return () => window.clearTimeout(timer);
  }, [lastButton]);

  return { connected, connect, disconnect, error, radio, lastButton };
}
