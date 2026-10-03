// Contract between the Photon bridge and the agents (ASI / Agentverse side, Ziquan).
// Set AGENT_URL to the concierge's HTTP endpoint. Until then we answer locally so the
// bridge is demoable on its own.

export type AgentRequest = {
  userId: string; // DM space id, stable per person
  text?: string;
  attachment?: { name: string; mimeType: string; base64: string };
  // "forget": the user texted DELETE ME. Drop their profile; no reply needed.
  event?: "forget";
};

export type AgentResponse = { reply?: string };

export async function askAgent(req: AgentRequest): Promise<AgentResponse> {
  const url = process.env.AGENT_URL;
  if (!url) return fallback(req);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`agent ${res.status}: ${await res.text()}`);
  return (await res.json()) as AgentResponse;
}

function fallback(req: AgentRequest): AgentResponse {
  if (req.event) return {};
  if (req.attachment) {
    return { reply: `Got your ${req.attachment.name}. (Agent offline: profile extraction will plug in here.)` };
  }
  return {
    reply:
      `Hi! I'm your networking recruiter. Send me your resume PDF, or tell me what you're stuck on ` +
      `and I'll find someone nearby who can help. (You said: "${req.text}")`,
  };
}
