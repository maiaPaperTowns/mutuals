// Saves the bridge's state to photon/data/state.json so restarts don't wipe profiles.
// Holds only what people chose to give us (extracted profile, photo, zone); never the raw resume.
// TODO(spacetime): move to the shared database once the schema is merged.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const DIR = new URL("../data/", import.meta.url).pathname;
const FILE = `${DIR}state.json`;

export type State = {
  people: [string, unknown][];
  profiles: [string, unknown][];
  avatars: [string, string][]; // base64 JPEG
  tokens: [string, string][];
  paused: string[];
};

export function load(): State | undefined {
  if (!existsSync(FILE)) return undefined;
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as State;
  } catch (err) {
    console.error("could not read saved state, starting fresh", err);
    return undefined;
  }
}

let last = "";
export function save(state: State) {
  const json = JSON.stringify(state);
  if (json === last) return; // nothing changed
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${FILE}.tmp`, json);
  renameSync(`${FILE}.tmp`, FILE); // atomic, so a crash never leaves half a file
  last = json;
}
