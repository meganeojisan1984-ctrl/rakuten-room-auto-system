import * as fs from "fs";
import * as path from "path";

export type SlotId = "slot0" | "slot1" | "slot2";

export interface PersonaSlot {
  id: SlotId;
  name: string;
  priceBand: [number, number];
  trackingId: string;
  genres: string[];
  tone: string;
  hashtags: string[];
  ngWords: string[];
  ctaLine: string;
}

export interface Persona {
  activeSlot: "multi" | SlotId;
  evaluationWindow: number;
  evaluationStartedAt: string;
  slots: Record<SlotId, PersonaSlot>;
}

function personaPath(): string {
  return process.env.PERSONA_PATH_OVERRIDE
    ?? path.join(process.cwd(), "src", "persona", "persona.json");
}

export function loadPersona(): Persona {
  const p = personaPath();
  if (!fs.existsSync(p)) {
    throw new Error(`persona.json が見つかりません: ${p}`);
  }
  return JSON.parse(fs.readFileSync(p, "utf-8")) as Persona;
}

export function savePersona(p: Persona): void {
  const target = personaPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(p, null, 2), "utf-8");
}

export function getSlot(p: Persona, id: SlotId): PersonaSlot {
  const s = p.slots[id];
  if (!s) throw new Error(`unknown slot: ${id}`);
  return s;
}
