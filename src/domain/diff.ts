export type Change = { section: string; label: string; before: string; after: string };

const SECTION_NAMES: Record<string, string> = {
  intake: "Intake",
  reference: "Reference",
  analysis: "Breakdown",
  findings: "Breakdown",
  strategy: "Strategy",
  offer: "Offer",
  mechanism: "Claims",
  beats: "Beats",
  guardrails: "Guardrails",
  openItems: "Open items",
  modules: "Format",
  assets: "Assets",
  video: "Video",
  static: "Static",
  native: "Native",
};

function labelize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();
}

function clip(value: string): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > 280 ? `${clean.slice(0, 277)}…` : clean;
}

function text(value: unknown): string {
  if (value == null || value === "") return "Empty";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function walk(before: unknown, after: unknown, section: string, label: string, out: Change[]) {
  if (out.length >= 40) return;
  if (Array.isArray(before) || Array.isArray(after)) {
    const b = text(before);
    const a = text(after);
    if (b !== a) out.push({ section, label, before: clip(b), after: clip(a) });
    return;
  }
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    const b = text(before);
    const a = text(after);
    if (b !== a) out.push({ section, label, before: clip(b), after: clip(a) });
    return;
  }
  const left = before as Record<string, unknown>;
  const right = after as Record<string, unknown>;
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    if (key === "revisions" || key === "revision" || key === "id") continue;
    const nextSection = SECTION_NAMES[key] ?? section;
    walk(left[key], right[key], nextSection, label ? `${label} · ${labelize(key)}` : labelize(key), out);
  }
}

export function describeChanges(before: unknown, after: unknown): Change[] {
  const changes: Change[] = [];
  walk(before, after, "Brief", "", changes);
  return changes;
}
