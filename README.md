# Creative pipeline

Internal tool for TriCore creative briefs. The finished artifact is the **final draft**: one approved version of the universal brief, then an editor handoff. Acceptance does not authorize production, publishing, or ad spend.

The app does not write to Notion, Drive, or the creative-intelligence sheet. It does not launch ads, build landing pages, or call an AI model.

## Run

Postgres needs a database named `creative_pipeline`. Copy `.env.example` to `.env.local`, then:

```bash
npm install
npm run db:setup
npm run dev
```

Open http://127.0.0.1:3000. Fixture accounts use the password `fixture-only`:

| Email | Role |
| --- | --- |
| strategist@fixture.test | Strategist |
| copywriter@fixture.test | Copy writer |
| editor@fixture.test | Editor |
| approver@fixture.test | Approver |
| architect@fixture.test | Architect |

The session cookie is `httpOnly` and not marked `secure`, so it works on local HTTP.

Two labelled fixtures are seeded. `FIXTURE-SHELVED` is parked and cannot be approved. `FIXTURE-HISTORICAL` keeps copy dated before the analysis and cannot become a final draft.

## Checks

```bash
npm run test:unit
npm run test:e2e
```

Unit tests use a separate database, `creative_pipeline_test`.
