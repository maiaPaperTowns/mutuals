// User database: one record per person (keyed by their iMessage DM id) holding their profile, photo, zone,
// page link token and paused flag, so people stay "signed in" across restarts and machines.
//
//   DYNAMODB_TABLE set → AWS DynamoDB (needs AWS_REGION + AWS credentials in .env)
//   otherwise          → photon/data/users.json on this laptop
//
// Holds only what people chose to give us (extracted profile, photo, zone); never the raw resume.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export type UserRecord = {
  userId: string;
  person?: unknown;
  profile?: unknown;
  avatar?: string; // base64 JPEG, ≤512px (well under DynamoDB's 400 KB item limit)
  token?: string; // profile page link
  paused?: boolean;
};

interface Backend {
  name: string;
  load(): Promise<UserRecord[]>;
  put(r: UserRecord): Promise<void>;
  del(userId: string): Promise<void>;
}

// ---------- local file ----------

const DIR = process.env.DATA_DIR ? `${process.env.DATA_DIR.replace(/\/$/, "")}/` : new URL("../data/", import.meta.url).pathname;
const FILE = `${DIR}users.json`;
const LEGACY = `${DIR}state.json`; // earlier snapshot format

function readFileRecords(): UserRecord[] {
  if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as UserRecord[];
  if (!existsSync(LEGACY)) return [];
  // Convert the old { people, profiles, avatars, tokens, paused } snapshot.
  const s = JSON.parse(readFileSync(LEGACY, "utf8"));
  const recs = new Map<string, UserRecord>();
  const rec = (id: string) => recs.get(id) ?? recs.set(id, { userId: id }).get(id)!;
  for (const [k, v] of s.people ?? []) rec(k).person = v;
  for (const [k, v] of s.profiles ?? []) rec(k).profile = v;
  for (const [k, v] of s.avatars ?? []) rec(k).avatar = v;
  for (const [k, v] of s.tokens ?? []) rec(k).token = v;
  for (const k of s.paused ?? []) rec(k).paused = true;
  return [...recs.values()];
}

function fileBackend(): Backend {
  const all = new Map<string, UserRecord>();
  const flush = () => {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(`${FILE}.tmp`, JSON.stringify([...all.values()]));
    renameSync(`${FILE}.tmp`, FILE); // atomic, so a crash never leaves half a file
  };
  return {
    name: `file (${FILE})`,
    async load() {
      for (const r of readFileRecords()) all.set(r.userId, r);
      return [...all.values()];
    },
    async put(r) {
      all.set(r.userId, r);
      flush();
    },
    async del(id) {
      all.delete(id);
      flush();
    },
  };
}

// ---------- AWS DynamoDB ----------

async function dynamoBackend(table: string): Promise<Backend> {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, PutCommand, DeleteCommand, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return {
    name: `DynamoDB table "${table}" (${process.env.AWS_REGION ?? "default region"})`,
    async load() {
      const out: UserRecord[] = [];
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const page = await db.send(new ScanCommand({ TableName: table, ExclusiveStartKey }));
        out.push(...((page.Items ?? []) as UserRecord[]));
        ExclusiveStartKey = page.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return out;
    },
    async put(r) {
      await db.send(new PutCommand({ TableName: table, Item: { ...r, updatedAt: new Date().toISOString() } }));
    },
    async del(userId) {
      await db.send(new DeleteCommand({ TableName: table, Key: { userId } }));
    },
  };
}

// ---------- sync ----------

let backend: Backend;
const lastSaved = new Map<string, string>(); // userId → JSON last written, so we only write what changed

export async function open(): Promise<UserRecord[]> {
  const table = process.env.DYNAMODB_TABLE;
  backend = table ? await dynamoBackend(table) : fileBackend();
  let records = await backend.load();
  if (table && records.length === 0) {
    // First run on AWS: bring over whatever this laptop already had.
    records = readFileRecords();
    for (const r of records) await backend.put(r);
    if (records.length) console.log(`moved ${records.length} users from the local file to DynamoDB`);
  }
  for (const r of records) lastSaved.set(r.userId, JSON.stringify(r));
  console.log(`user database: ${backend.name}, ${records.length} users`);
  return records;
}

/** Write changed users and delete removed ones. Safe to call often. */
export async function sync(records: UserRecord[]) {
  const seen = new Set<string>();
  for (const r of records) {
    seen.add(r.userId);
    const json = JSON.stringify(r);
    if (lastSaved.get(r.userId) === json) continue;
    await backend.put(r);
    lastSaved.set(r.userId, json);
  }
  for (const id of [...lastSaved.keys()]) {
    if (seen.has(id)) continue;
    await backend.del(id);
    lastSaved.delete(id);
  }
}
