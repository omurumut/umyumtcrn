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
}

async function openTechnicalProfile(page: Page): Promise<void> {
  await page.goto("/birimler");
  await page.getByRole("tab", { name: "Teknik Profil" }).click();
  await expect(page.getByTestId("unit-technical-profile-tab")).toBeVisible();
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
  await expect(page.getByTestId("unit-technical-profile-status")).toHaveCount(0);
  await expect(page.getByTestId("unit-technical-profile-save")).toBeDisabled();

  await page.getByLabel("Ana faaliyet").fill("[E2E] Teknik profil UI");
  await page.getByLabel("Gunluk calisma suresi (saat/gun)").fill("25");
  await page.getByLabel("Personel sayisi (kisi)").fill("0");
  await page.getByTestId("unit-technical-profile-save").click();

  await expect(page.getByText("Formu kontrol edin")).toBeVisible();
  await expect(page.getByText("0-24 araliginda olmali")).toBeVisible();

  await page.getByLabel("Gunluk calisma suresi (saat/gun)").fill("12");
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
    profileStatus: "draft",
    profileVersion: 1,
  });
});

test("UNIT-TECH-PROFILE-UI 409 cakis masinda editleri korur ve yeni versiyonla kaydeder", async ({ page, request }) => {
  const standard = await login(request, credentials.standardA1);
  const admin = await login(request, credentials.adminA);
  expect(standard.user.unitId).not.toBeNull();
  await resetProfile(standard.user.unitId!);

  await useSession(page, standard);
  await openTechnicalProfile(page);
  await page.getByLabel("Ana faaliyet").fill("[E2E] Kullanici edit");

  const serverUpdate = await request.patch(`/api/unit-technical-profiles/${standard.user.unitId}`, {
    headers: authorization(admin.token),
    data: { expectedProfileVersion: 0, mainActivity: "[E2E] Sunucu edit" },
  });
  expect(serverUpdate.status()).toBe(200);

  await page.getByTestId("unit-technical-profile-save").click();
  await expect(page.getByText("Sunucuda daha guncel surum var")).toBeVisible();
  await expect(page.getByText("Mevcut sunucu versiyonu 1")).toBeVisible();
  await expect(page.getByLabel("Ana faaliyet")).toHaveValue("[E2E] Kullanici edit");

  await page.getByRole("button", { name: "Duzenlemeye devam et" }).click();
  await expect(page.getByLabel("Ana faaliyet")).toHaveValue("[E2E] Kullanici edit");
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
