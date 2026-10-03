// Commands the bridge answers itself, so they work even when the agent is down.
// Everything else ("what do you know about me?", "delete my GPA") goes to the agent,
// which owns the profile.

export type Command = "stop" | "start" | "forget" | "help";

const PATTERNS: [Command, RegExp][] = [
  ["stop", /^\s*(stop|pause|unsubscribe|leave me alone)\s*[.!]*\s*$/i],
  ["start", /^\s*(start|resume|unpause)\s*[.!]*\s*$/i],
  ["forget", /^\s*(delete me|forget me|delete my (data|account|profile))\s*[.!]*\s*$/i],
  ["help", /^\s*(help|\?|commands)\s*$/i],
];

export function parseCommand(text: string): Command | undefined {
  return PATTERNS.find(([, re]) => re.test(text))?.[0];
}

export const REPLIES: Record<Command, string> = {
  stop: "Paused. I won't send you any intros. Text START whenever you want back in.",
  start: "You're back in! I'll text you when I find someone worth meeting.",
  forget: "Done. I've deleted your profile and intros. Text me anytime to start fresh.",
  help:
    "Here's what I can do:\n" +
    "• Send your resume PDF and I'll build your profile\n" +
    "• Tell me what you're stuck on or who you want to meet\n" +
    "• \"What do you know about me?\" shows your profile\n" +
    "• STOP pauses intros, DELETE ME erases everything",
};
