import { contentHash } from "../domain/snapshot";
import { emptyFindings, emptySnapshot } from "../domain/snapshot";
import type { Db } from "./db";
import { hashPassword } from "./passwords";

export const IDS = {
  strategist: "11111111-1111-4111-8111-111111111111",
  copyWriter: "22222222-2222-4222-8222-222222222222",
  editor: "33333333-3333-4333-8333-333333333333",
  approver: "44444444-4444-4444-8444-444444444444",
  architect: "55555555-5555-4555-8555-555555555555",
  shelved: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  historical: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  historicalAnalysis: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  historicalBrief: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
};

const ACCOUNTS = [
  [IDS.strategist, "Fixture Strategist", "strategist@fixture.test", ["strategist"]],
  [IDS.copyWriter, "Fixture Copy Writer", "copywriter@fixture.test", ["copy_writer"]],
  [IDS.editor, "Fixture Editor", "editor@fixture.test", ["editor"]],
  [IDS.approver, "Bilal (fixture approver)", "approver@fixture.test", ["approver"]],
  [IDS.architect, "Fixture Architect", "architect@fixture.test", ["architect"]],
] as const;

export async function seedFixtures(db: Db): Promise<void> {
  const configured = process.env.FIXTURE_PASSWORD?.trim() ?? "";
  if (!configured) throw new Error("FIXTURE_PASSWORD is required to seed fixture accounts.");
  const password = hashPassword(configured);
  for (const [id, name, email, roles] of ACCOUNTS) {
    await db.query(
      `INSERT INTO accounts (id, name, email, password_hash, is_fixture) VALUES ($1,$2,$3,$4,true)`,
      [id, name, email, password],
    );
    for (const role of roles) {
      await db.query(`INSERT INTO account_roles (account_id, role) VALUES ($1,$2)`, [id, role]);
    }
  }

  await db.query(
    `INSERT INTO creatives (
      id, creative_code, idea, source_type, spotted_by, spotted_on, hypothesis,
      stage, parked, fixture_kind, created_by
    ) VALUES (
      $1, 'FIXTURE-SHELVED',
      'FIXTURE — Shelved example. Not a live or approved creative.',
      'Swipe', 'Fixture Strategist', '2026-11-01',
      'Shelved fixture. It has no final draft and cannot be approved.',
      'parked', true, 'shelved', $2
    )`,
    [IDS.shelved, IDS.strategist],
  );
  await db.query(
    `INSERT INTO creative_assignments (creative_id, role, account_id, assigned_by) VALUES ($1,'strategist',$2,$2)`,
    [IDS.shelved, IDS.strategist],
  );

  const snapshot = emptySnapshot();
  snapshot.intake = {
    idea: "FIXTURE — Historical order. Copy is dated before analysis. Not a live creative.",
    sourceType: "Swipe",
    spottedBy: "Fixture Strategist",
    spottedOn: "2026-11-01",
    hypothesis: "Historical fixture. The dates are the point, and they are not a performance result.",
    parentCode: "net new",
    sheetLink: "",
    medium: "Still image",
    executionStyle: "Native avatar-story",
    otherMedium: "",
    otherExecution: "",
    brand: "TriCore",
  };
  snapshot.copyAuthoredAt = "2026-11-01T15:00:00.000Z";
  snapshot.modules.native.state = "active";
  snapshot.modules.native.naReason = "";
  snapshot.modules.native.opening = "Historical copy written before the breakdown.";
  snapshot.modules.static.state = "na";
  snapshot.modules.static.naReason = "N/A — covered by the native module.";
  snapshot.modules.video.state = "na";
  snapshot.modules.video.naReason = "N/A — not this format.";
  snapshot.analysis = {
    id: IDS.historicalAnalysis,
    versionNumber: 1,
    state: "draft",
    authoredAt: "2026-11-07T15:00:00.000Z",
  };
  snapshot.findings = emptyFindings();

  await db.query(
    `INSERT INTO creatives (
      id, creative_code, parent_code, idea, source_type, spotted_by, spotted_on, hypothesis,
      medium, execution_style, stage, historical_order, fixture_kind, created_by
    ) VALUES (
      $1, 'FIXTURE-HISTORICAL', 'net new', $2, 'Swipe', 'Fixture Strategist', '2026-11-01', $3,
      'Still image', 'Native avatar-story', 'review', true, 'historical', $4
    )`,
    [IDS.historical, snapshot.intake.idea, snapshot.intake.hypothesis, IDS.strategist],
  );
  await db.query(
    `INSERT INTO creative_assignments (creative_id, role, account_id, assigned_by) VALUES ($1,'strategist',$2,$2)`,
    [IDS.historical, IDS.strategist],
  );
  await db.query(
    `INSERT INTO analysis_versions (id, creative_id, version_number, state, authored_at, payload, created_by)
     VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5)`,
    [IDS.historicalAnalysis, IDS.historical, snapshot.analysis.authoredAt, JSON.stringify({ findings: snapshot.findings }), IDS.copyWriter],
  );
  await db.query(
    `INSERT INTO brief_versions (id, creative_id, version_number, state, analysis_version_id, snapshot, content_hash, created_by)
     VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5,$6)`,
    [IDS.historicalBrief, IDS.historical, IDS.historicalAnalysis, JSON.stringify(snapshot), contentHash(snapshot), IDS.copyWriter],
  );
}
