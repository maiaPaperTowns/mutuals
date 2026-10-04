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
  stop: "Paused ⏸ Text START to come back.",
  start: "You're back! 🐶",
  forget: "Deleted everything 🗑 Text me anytime to start fresh.",
  help:
    "🐶 Mutual can:\n" +
    "📄 read your resume or LinkedIn PDF\n" +
    "🔍 find people: \"who knows React?\"\n" +
    "📍 \"I'm in the lounge\" · \"map\" · \"profile\"\n" +
    "✏️ \"my name is …\" · \"my instagram is @…\"\n" +
    "⏸ STOP · 🗑 DELETE ME",
};
