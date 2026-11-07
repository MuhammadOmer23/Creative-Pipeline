import { expect, test, type Page } from "@playwright/test";

const LABELS = [
  "Beats / anatomy",
  "Awareness level",
  "Market sophistication",
  "Unique problem",
  "Unique solution",
  "Authority",
  "Messenger",
  "Format / visual grammar",
  "Stakes",
  "Emotional valence",
  "Angle",
  "Belief: current",
  "Mass desire",
  "Persuasion techniques",
  "Gradualization",
  "Problem",
  "Mechanism depth",
  "Do-not-copy",
];

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("fixture-only");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/pipeline/);
}

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function saved(page: Page) {
  await expect(page.getByTestId("save-status")).toHaveText("Saved");
}

test("fixture rows stay visibly shelved, and a copy writer cannot open intake", async ({ page }) => {
  await login(page, "copywriter@fixture.test");
  await expect(page.getByTestId("new-intake")).toHaveCount(0);
  const refused = await page.request.post("/api/creatives", { data: { idempotencyKey: crypto.randomUUID() } });
  expect(refused.status()).toBe(403);
  await logout(page);

  await login(page, "strategist@fixture.test");
  await expect(page.getByText("Test fixture. Not a live creative. Not a final draft.").first()).toBeVisible();
  await page.getByLabel("Stage").selectOption("Parked");
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page.getByRole("link", { name: /Shelved example/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Historical order/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Shelved example/ }).click();
  await expect(page.getByText("Test fixture. Not a live creative. Not a final draft.")).toBeVisible();
  await expect(page.getByText("No final draft. Not approved.")).toBeVisible();
  await page.getByRole("link", { name: "Review and handoff" }).click();
  await expect(page.getByTestId("final-draft")).toHaveText("No final draft");
  await expect(page.getByTestId("approve")).toHaveCount(0);
  await expect(page.locator("[data-launch-controls='none']")).toBeVisible();
  await expect(page.getByTestId("disclaimer")).toContainText("does not authorize production, publishing, or ad spend");
  await page.goto("/pipeline");
  await page.getByLabel("Search").fill("Historical order");
  await page.getByRole("button", { name: "Filter" }).click();
  await page.getByRole("link", { name: /Historical order/ }).click();
  await expect(page.locator(".note", { hasText: "Copy is dated before the analysis" })).toBeVisible();
  await expect(page.getByText("No final draft. Not approved.")).toBeVisible();
});

test("intake survives a reload, an interrupted save, and a stale second tab", async ({ page, browser }) => {
  await login(page, "strategist@fixture.test");
  await page.getByTestId("new-intake").click();
  await expect(page).toHaveURL(/\/creatives\//);
  await page.getByTestId("idea").fill("Reload doorway");
  await page.getByLabel("Source type").selectOption("Organic");
  await page.getByLabel("Spotted by").fill("Fixture Strategist");
  await page.getByLabel("Date").fill("2026-11-07");
  await page.getByLabel("One-line hypothesis").fill("The object can carry the story.");
  await page.getByRole("button", { name: "Save intake" }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByTestId("idea")).toHaveValue("Reload doorway");

  let aborted = false;
  await page.route("**/api/creatives/**/actions", async (route) => {
    const body = route.request().postData() ?? "";
    if (!aborted && body.includes("save_intake")) {
      aborted = true;
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.getByTestId("idea").fill("Recovered doorway");
  await page.getByRole("button", { name: "Save intake" }).click();
  await expect(page.getByTestId("save-status")).toContainText("Could not save");
  await page.unroute("**/api/creatives/**/actions");
  await page.reload();
  await expect(page.getByTestId("recovery")).toBeVisible();
  await page.getByRole("button", { name: "Restore it" }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByTestId("idea")).toHaveValue("Recovered doorway");

  const url = page.url();
  const other = await browser.newPage();
  await login(other, "strategist@fixture.test");
  await other.goto(url);
  await expect(other.getByTestId("idea")).toHaveValue("Recovered doorway");
  await page.getByTestId("idea").fill("Newer doorway");
  await page.getByRole("button", { name: "Save intake" }).click();
  await saved(page);
  await other.getByLabel("One-line hypothesis").fill("A stale hypothesis from the other tab.");
  await other.getByRole("button", { name: "Save intake" }).click();
  await expect(other.getByTestId("conflict")).toBeVisible();
  await other.getByRole("button", { name: "Load their version" }).click();
  await expect(other.getByTestId("idea")).toHaveValue("Newer doorway");
  await other.close();
});

test("a native still becomes an accepted final draft and nothing launches", async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, "strategist@fixture.test");
  await page.getByTestId("new-intake").click();
  await page.getByTestId("idea").fill("Native hallway shoes");
  await page.getByLabel("Source type").selectOption("Organic");
  await page.getByLabel("Spotted by").fill("Fixture Strategist");
  await page.getByLabel("Date").fill("2026-11-07");
  await page.getByLabel("One-line hypothesis").fill("A repeated object can carry the story.");
  await page.getByLabel("Medium").selectOption("Still image");
  await page.getByLabel("Execution style").selectOption("Native avatar-story");
  await page.getByLabel("Copy writer").selectOption({ label: "Fixture Copy Writer" });
  await saved(page);
  await page.getByLabel("Editor").selectOption({ label: "Fixture Editor" });
  await saved(page);
  await page.getByRole("button", { name: "Save intake" }).click();
  await saved(page);
  await page.reload();
  await expect(page.getByLabel("Medium")).toHaveValue("Still image");
  await expect(page.getByLabel("Execution style")).toHaveValue("Native avatar-story");
  await page.getByTestId("select-pipeline").click();
  await expect(page.getByText(/Pipeline ID TC-PIPE-\d+/)).toBeVisible();

  await page.getByRole("button", { name: "Reference", exact: true }).click();
  await page.getByLabel("Reference link").fill("https://example.test/reference");
  await page.getByLabel("Reference title").fill("Reference ad");
  await page.getByRole("button", { name: "Save reference" }).click();
  await saved(page);
  await page.getByTestId("review-reference").click();
  await saved(page);
  const creativeUrl = page.url().split("?")[0];
  await logout(page);

  await login(page, "copywriter@fixture.test");
  await page.goto(creativeUrl);
  await page.getByRole("button", { name: "Breakdown", exact: true }).click();
  for (const [index, label] of LABELS.entries()) {
    await page.getByRole("button", { name: new RegExp(`^${index + 1}\\. ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    await page.getByLabel("Reference observed").fill(`Observed: ${label}`);
    await page.getByLabel("Inference").fill("Marked inference.");
    await page.getByTestId("save-finding").click();
    await saved(page);
    await page.getByLabel("Evidence location").fill("0:12");
    await page.getByLabel("Evidence quote").fill("A line from the reference.");
    await page.getByRole("button", { name: "Add evidence" }).click();
    await saved(page);
  }
  await logout(page);

  await login(page, "strategist@fixture.test");
  await page.goto(creativeUrl);
  await page.getByRole("button", { name: "Breakdown", exact: true }).click();
  for (const [index, label] of LABELS.entries()) {
    await page.getByRole("button", { name: new RegExp(`^${index + 1}\\. ${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }).click();
    await page.getByLabel("Our adaptation").fill(`Our version of ${label}`);
    await page.getByTestId("save-finding").click();
    await saved(page);
  }
  await page.getByRole("button", { name: "Strategy", exact: true }).click();
  await page.getByLabel("Concept").fill("Doorway");
  await page.getByLabel("Buyer / situation").fill("Cold reader");
  await page.getByLabel("Test hypothesis").fill("The object holds the story.");
  await page.getByLabel("Why this format").fill("A native still lets the copy carry it.");
  await page.getByLabel("Core and secondary variable").fill("The opening object");
  await page.getByLabel("Controls").fill("No live control.");
  await page.getByRole("button", { name: "Save Strategy" }).click();
  await saved(page);
  await logout(page);

  await login(page, "copywriter@fixture.test");
  await page.goto(`${creativeUrl}?section=breakdown`);
  await page.getByTestId("mark-ready").click();
  await saved(page);
  await page.getByRole("button", { name: "Offer and claims" }).click();
  await page.getByLabel("Landing page URL").fill("https://example.test/offer");
  await page.getByLabel("Landing source and date verified").fill("Approved page 2026-11-01");
  await page.getByLabel("Offer / price / bundle").fill("Bundle as listed on the approved page");
  await page.getByLabel("Offer source and date").fill("Approved offer 2026-11-01");
  await page.getByLabel("Offer limits / terms").fill("As published on the approved page");
  await page.getByLabel("Limits source and date").fill("Approved terms 2026-11-01");
  await page.getByLabel("CTA wording").fill("Learn more");
  await page.getByLabel("Required product language / locked product facts").fill("Use the approved product name only.");
  await page.getByRole("button", { name: "Save Offer and destination" }).click();
  await saved(page);
  await page.getByLabel("Mechanism", { exact: true }).fill("A compressed causal chain.");
  await page.getByLabel("Mechanism honesty line").fill("Do not imply a cure or a medical event.");
  await page.getByRole("checkbox", { name: "No claims" }).check();
  await page.getByRole("checkbox", { name: "No proof items" }).check();
  await page.getByRole("checkbox", { name: "No real person" }).check();
  await page.getByRole("button", { name: "Save claims" }).click();
  await saved(page);
  await page.getByRole("button", { name: "Add beat" }).click();
  await page.getByLabel("Reference beat 1").fill("Doorway");
  await page.getByLabel("Our beat 1").fill("Doorway");
  await page.getByRole("button", { name: "Save beats" }).click();
  await saved(page);
  await page.getByRole("button", { name: "Copy and format" }).click();
  await expect(page.getByText("Static: N/A — covered by the native module.")).toBeVisible();
  const native: [string, string][] = [
    ["Subject and action", "A pair of shoes"],
    ["Setting", "A hallway"],
    ["Framing", "Still, little context"],
    ["Emotional cue", "Quiet recognition"],
    ["Why the image earns attention", "The object is familiar."],
    ["What the copy makes the image mean", "The shoes stand for a life that paused."],
    ["Asset source and permission", "Illustrative still"],
    ["Avatar situation and perspective", "Someone who stopped going out"],
    ["Narrative voice", "1st"],
    ["Story opening", "The shoes stayed by the door."],
    ["Incident / problem", "Plans kept being cancelled."],
    ["Current beliefs and failed attempts", "Rest alone would fix it."],
    ["Turning point", "The explanation changed."],
    ["Payoff", "The shoes were put on."],
    ["Transition / CTA", "Read the story."],
    ["Permission", "No real person is shown."],
  ];
  for (const [label, value] of native) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel("Embedded headline / labels / logo").selectOption("none");
  await page.getByLabel("Platform CTA / ad labels").fill("Learn more");
  await page.getByLabel("Real or illustrative").selectOption("illustrative");
  await page.getByRole("button", { name: "Save Native image and avatar story" }).click();
  await saved(page);
  await page.goto(`${creativeUrl}/review`);
  await page.getByRole("button", { name: "Attest: nothing was invented as ours" }).click();
  await expect(page.getByText("Saved").last()).toBeVisible();
  await page.getByRole("button", { name: "Attest the honesty line" }).click();
  await expect(page.getByText("Saved").last()).toBeVisible();
  await logout(page);

  await login(page, "editor@fixture.test");
  await page.goto(`${creativeUrl}?section=assets`);
  await page.getByRole("button", { name: "Add asset" }).click();
  await page.getByLabel("Asset label 1").fill("Native still");
  await page.getByLabel("Asset status 1").selectOption("permission_recorded");
  await page.getByLabel("Asset permission 1").fill("Illustrative. No real person.");
  await page.getByRole("button", { name: "Save assets" }).click();
  await saved(page);
  await page.goto(`${creativeUrl}/review`);
  await expect(page.getByTestId("approve")).toHaveCount(0);
  await logout(page);

  await login(page, "strategist@fixture.test");
  await page.goto(`${creativeUrl}/review`);
  await page.getByTestId("submit-approval").click();
  await expect(page.getByText("Awaiting approval of v1")).toBeVisible();
  await logout(page);

  await login(page, "approver@fixture.test");
  await page.goto(`${creativeUrl}/review`);
  await page.getByTestId("approve-words").fill("Approved as the final draft.");
  await page.getByTestId("approve").click();
  await expect(page.getByTestId("final-draft")).toHaveText("Final draft v1");
  await logout(page);

  await login(page, "strategist@fixture.test");
  await page.goto(`${creativeUrl}/review`);
  await page.getByRole("button", { name: "Hand this final draft to the editor" }).click();
  await expect(page.getByText("Awaiting editor acceptance")).toBeVisible();
  await logout(page);

  await login(page, "editor@fixture.test");
  await page.goto(`${creativeUrl}/review`);
  await expect(page.locator("[data-launch-controls='none']")).toBeVisible();
  await expect(page.getByTestId("approve")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Launch|Publish|Spend/ })).toHaveCount(0);
  await page.getByTestId("accept-handoff").click();
  await expect(page.getByTestId("final-draft")).toHaveText("Final draft v1");
  await expect(page.getByText("Accepted · no launch permission")).toBeVisible();
  await expect(page.getByTestId("disclaimer")).toHaveText("Recipient acceptance does not authorize production, publishing, or ad spend.");
  await page.screenshot({ path: "/opt/cursor/artifacts/final-draft.png", fullPage: true });
});
