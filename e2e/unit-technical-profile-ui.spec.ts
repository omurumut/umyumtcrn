import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

function assertDisposableDatabase(): string {
  if (process.env.NODE_ENV !== "test" || process.env.TEST_DB_DISPOSABLE !== "true") {
    throw new Error("Unit technical profile UI E2E yalniz disposable test DB uzerinde calisir.");
  }
  const rawUrl = requiredEnv("DATABASE_URL");
  const url = new URL(rawUrl);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/iso50001_test" || url.port !== process.env.TEST_DB_PORT) {
    throw new Error("Unit technical profile UI E2E disposable localhost DB ile eslesmiyor.");
  }
  return rawUrl;
}

type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
type TestPool = {
  query<Row>(sql: string, values?: unknown[]): Promise<QueryResult<Row>>;
  end(): Promise<void>;
};

const scriptsRequire = createRequire(resolve(process.cwd(), "scripts/package.json"));
const { Pool } = scriptsRequire("pg") as {
  Pool: new (options: { connectionString: string }) => TestPool;
};
const pool = new Pool({ connectionString: assertDisposableDatabase() });

const credentials = {
  standardA1: requiredEnv("E2E_STANDARD_USERNAME"),
  adminA: requiredEnv("E2E_ADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

type LoginResult = {
  token: string;
  user: {
    id: number;
    username: string;
    name: string;
    role: string;
    companyId: number;
    unitId: number | null;
  };
};

function authorization(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function login(request: APIRequestContext, username: string): Promise<LoginResult> {
  const response = await request.post("/api/auth/login", {
    data: { username, password: credentials.password },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as LoginResult;
}

async function useSession(page: Page, session: LoginResult): Promise<void> {
  await page.goto("/");
  await page.evaluate(({ token, user }) => {
    localStorage.setItem("eys_token", token);
    localStorage.setItem("eys_user", JSON.stringify(user));
  }, session);
}

async function resetProfile(unitId: number): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE action LIKE 'unit_technical_profile.%' AND unit_id=$1", [unitId]);
  await pool.query("DELETE FROM unit_technical_profiles WHERE unit_id=$1", [unitId]);
  await pool.query(
    `DELETE FROM unit_technical_profile_field_definitions
     WHERE company_id = (SELECT company_id FROM units WHERE id=$1)`,
    [unitId],
  );
}

async function unitName(unitId: number): Promise<string> {
  const result = await pool.query<{ name: string }>("SELECT name FROM units WHERE id=$1", [unitId]);
  const name = result.rows[0]?.name;
  if (!name) throw new Error(`Unit bulunamadi: ${unitId}`);
  return name;
}

async function openTechnicalProfile(page: Page): Promise<void> {
  await page.goto("/birimler");
  await page.getByRole("tab", { name: "Teknik Profil" }).click();
  await expect(page.getByTestId("unit-technical-profile-tab")).toBeVisible();
}

async function chooseSelectOption(page: Page, testId: string, option: string): Promise<void> {
  await page.getByTestId(testId).click();
  await page.getByRole("option", { name: option }).click();
}

test.afterAll(async () => {
  await pool.end();
});

test("UNIT-TECH-PROFILE-UI standard taslak kaydeder ve client validasyon uygular", async ({ page, request }) => {
  const standard = await login(request, credentials.standardA1);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);

  await useSession(page, standard);
  await openTechnicalProfile(page);

  await expect(page.getByText("Yeni taslak")).toBeVisible();
  await expect(page.getByText("Profil doluluk orani: 0/29 alan (0%)")).toBeVisible();
  await expect(page.getByTestId("unit-technical-profile-section-general")).toContainText("Henuz baslanmadi");
  await expect(page.getByTestId("unit-technical-profile-status")).toHaveCount(0);
  await expect(page.getByTestId("unit-technical-profile-save")).toBeDisabled();

  await page.getByTestId("utp-field-mainActivity").fill("[E2E] Teknik profil UI");
  await page.getByTestId("utp-field-dailyOperatingHours").fill("25");
  await page.getByTestId("utp-field-personnelCount").fill("0");
  await expect(page.getByText("Profil doluluk orani: 3/29 alan (10%)")).toBeVisible();
  await expect(page.getByTestId("unit-technical-profile-section-operation")).toContainText("Kismen tamamlandi");
  await page.getByTestId("unit-technical-profile-save").click();

  await expect(page.getByText("Formu kontrol edin")).toBeVisible();
  await expect(page.getByText("0-24 araliginda olmali")).toBeVisible();

  await page.getByTestId("utp-field-dailyOperatingHours").fill("12");
  await chooseSelectOption(page, "utp-field-generatorStatus", "Bilinmiyor");
  await expect(page.getByText("Profil doluluk orani: 4/29 alan (14%)")).toBeVisible();
  await page.getByTestId("unit-technical-profile-next-incomplete").click();
  await expect(page.getByTestId("unit-technical-profile-section-general")).toBeInViewport();
  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Teknik profil kaydedildi", { exact: true })).toBeVisible();
  await expect(page.getByTestId("unit-technical-profile-save")).toBeDisabled();

  const apiResponse = await request.get(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(standard.token),
  });
  expect(apiResponse.status()).toBe(200);
  const body = await apiResponse.json();
  expect(body.profile).toMatchObject({
    exists: true,
    mainActivity: "[E2E] Teknik profil UI",
    dailyOperatingHours: 12,
    totalEnclosedAreaM2: null,
    personnelCount: 0,
    generatorStatus: "unknown",
    profileStatus: "draft",
    profileVersion: 1,
  });
});

test("UNIT-TECH-PROFILE-UI firma ozel alan profil formunda doldurulur", async ({ page, request }) => {
  const admin = await login(request, credentials.adminA);
  const standard = await login(request, credentials.standardA1);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);

  const code = `phase3c3_ui_req_${Date.now().toString().slice(-6)}`;
  const definition = await request.post("/api/unit-technical-profile-field-definitions", {
    headers: authorization(admin.token),
    data: {
      code,
      label: "UI required custom",
      fieldType: "short_text",
      isRequiredForPublish: true,
      sortOrder: 1,
    },
  });
  expect(definition.status()).toBe(201);

  await useSession(page, standard);
  await openTechnicalProfile(page);

  await expect(page.getByTestId("unit-technical-profile-section-custom")).toBeVisible();
  await expect(page.getByText("Profil doluluk orani: 0/30 alan (0%)")).toBeVisible();
  await page.getByTestId(`utp-custom-field-${code}`).fill("Custom draft value");
  await expect(page.getByText("Profil doluluk orani: 1/30 alan (3%)")).toBeVisible();
  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Teknik profil kaydedildi", { exact: true })).toBeVisible();

  const apiResponse = await request.get(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(standard.token),
  });
  expect(apiResponse.status()).toBe(200);
  const body = await apiResponse.json();
  expect(body.customFieldValues[code]).toBe("Custom draft value");
  expect(body.customFieldDefinitions.some((item: any) => item.code === code && item.isRequiredForPublish === true)).toBe(true);
});

test("UNIT-TECH-PROFILE-UI 409 cakis masinda editleri korur ve yeni versiyonla kaydeder", async ({ page, request }) => {
  const standard = await login(request, credentials.standardA1);
  const admin = await login(request, credentials.adminA);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);

  await useSession(page, standard);
  await openTechnicalProfile(page);
  await page.getByTestId("utp-field-mainActivity").fill("[E2E] Kullanici edit");

  const serverUpdate = await request.patch(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(admin.token),
    data: { expectedProfileVersion: 0, mainActivity: "[E2E] Sunucu edit" },
  });
  expect(serverUpdate.status()).toBe(200);

  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Sunucuda daha guncel surum var")).toBeVisible();
  await expect(page.getByText("Mevcut sunucu versiyonu 1")).toBeVisible();
  await expect(page.getByTestId("utp-field-mainActivity")).toHaveValue("[E2E] Kullanici edit");
  await expect(page.getByText("Profil doluluk orani: 1/29 alan (3%)")).toBeVisible();

  await page.getByRole("button", { name: "Duzenlemeye devam et" }).click();
  await expect(page.getByTestId("utp-field-mainActivity")).toHaveValue("[E2E] Kullanici edit");
  await expect(page.getByText("Profil doluluk orani: 1/29 alan (3%)")).toBeVisible();
  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Teknik profil kaydedildi", { exact: true })).toBeVisible();

  const apiResponse = await request.get(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(standard.token),
  });
  expect(apiResponse.status()).toBe(200);
  const body = await apiResponse.json();
  expect(body.profile.mainActivity).toBe("[E2E] Kullanici edit");
  expect(body.profile.profileVersion).toBe(2);
});

test("UNIT-TECH-PROFILE-UI admin publish minimum alanlari gosterir ve tamamlaninca yayinlar", async ({ page, request }) => {
  const admin = await login(request, credentials.adminA);
  const standard = await login(request, credentials.standardA1);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);
  const selectedUnitName = await unitName(standard.user.unitId!);

  await useSession(page, admin);
  await page.goto("/birimler");
  await chooseSelectOption(page, "unit-tab-filter", selectedUnitName);
  await page.getByRole("tab", { name: "Teknik Profil" }).click();
  await expect(page.getByTestId("unit-technical-profile-tab")).toBeVisible();
  await page.getByTestId("utp-field-facilityUseType").fill("Uretim tesisi");
  await page.getByTestId("unit-technical-profile-status").click();
  await page.getByRole("option", { name: "Published" }).click();
  await page.getByTestId("unit-technical-profile-save").click();

  await expect(page.getByTestId("unit-technical-profile-publish-missing")).toContainText("Ana faaliyet");
  await expect(page.getByTestId("unit-technical-profile-publish-missing")).toContainText("Toplam kapali alan");
  await expect(page.getByTestId("unit-technical-profile-section-general")).toBeInViewport();

  await page.getByTestId("utp-field-mainActivity").fill("Montaj");
  await page.getByTestId("utp-field-totalEnclosedAreaM2").fill("1000");
  await page.getByTestId("utp-field-dailyOperatingHours").fill("8");
  await page.getByTestId("utp-field-heatingSystemType").fill("Dogalgaz kazan");
  await page.getByTestId("utp-field-coolingSystemType").fill("Chiller");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Teknik profil kaydedildi", { exact: true })).toBeVisible();

  const apiResponse = await request.get(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(admin.token),
  });
  expect(apiResponse.status()).toBe(200);
  const body = await apiResponse.json();
  expect(body.profile.profileStatus).toBe("published");
  expect(body.profile.profileVersion).toBe(1);
});

test("UNIT-TECH-PROFILE-UI salt okunur ozet ve responsive yatay tasma kontrolu", async ({ page, request }) => {
  const standard = await login(request, credentials.standardA1);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);

  const seed = await request.patch(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(standard.token),
    data: {
      expectedProfileVersion: 0,
      facilityUseType: "Lojistik",
      mainActivity: "Depolama",
      totalEnclosedAreaM2: 0,
      heatingSystemType: "Yok",
      coolingSystemType: "Split klima",
      dailyOperatingHours: 8,
      generatorStatus: "not_applicable",
    },
  });
  expect(seed.status()).toBe(200);
  const seededBody = await seed.json();

  await useSession(page, standard);
  await page.route(`**/api/unit-technical-profiles/${standard.user.unitId}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ profile: seededBody.profile, permissions: { canEdit: false, canPublish: false } }),
    });
  });

  await page.setViewportSize({ width: 1366, height: 768 });
  await openTechnicalProfile(page);
  await expect(page.getByTestId("unit-technical-profile-summary")).toBeVisible();
  await expect(page.getByTestId("unit-technical-profile-save")).toHaveCount(0);
  await expect(page.getByTestId("utp-field-mainActivity")).toHaveCount(0);
  await expect(page.getByTestId("unit-technical-profile-summary")).toContainText("Profil doluluk orani");
  await expect(page.getByTestId("unit-technical-profile-summary")).toContainText("Uygulanamaz");

  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(desktopOverflow).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(mobileOverflow).toBe(false);
});
