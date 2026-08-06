const POSES = ["hello", "joy", "alert", "sad", "work", "think"] as const;
const ROLES = ["commander", "analyst"] as const;

type Pose = typeof POSES[number];
type Role = typeof ROLES[number];

export type PetImageMap = Record<Role, Record<Pose, string>>;

export function buildRolePetImageMap(generated: Partial<Record<Role, string>>): PetImageMap {
  const out = {} as PetImageMap;
  for (const role of ROLES) {
    out[role] = {} as Record<Pose, string>;
    const generatedFile = generated[role];
    for (const pose of POSES) {
      out[role][pose] = generatedFile
        ? `/pet-owner/generated/${encodeURIComponent(generatedFile)}`
        : `/pet/${role}_${pose}.png`;
    }
  }
  return out;
}
