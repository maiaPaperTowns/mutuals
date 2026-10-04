// Cute (clubs, university mixers: the pixel pup) or formal (recruiting events: clean, no pup). Per browser, shared by
// the map, the events page and the badge.
import { createContext } from 'react';

export type Style = 'cute' | 'formal';
export const STYLE_KEY = 'mutuals-style';
export const StyleContext = createContext<{ style: Style; setStyle: (style: Style) => void }>({ style: 'cute', setStyle: () => {} });

export function loadStyle(): Style {
  try { return localStorage.getItem(STYLE_KEY) === 'formal' ? 'formal' : 'cute'; } catch { return 'cute'; }
}
