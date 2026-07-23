import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} runtime degeri zorunludur.`);
  return value;
}

const scriptsRequire = createRequire(process.cwd() + "/scripts/package.json");
const ExcelJS = scriptsRequire("exceljs") as typeof import("exceljs");

const credentials = {
  admin: requiredEnv("E2E_ADMIN_USERNAME"),
  password: requiredEnv("E2E_TEST_PASSWORD"),
} as const;

async function loginUi(page: Page, username: string) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(credentials.password);
  await page.locator('button[type="submit"]').click();
  await page.waitForFunction(() => localStorage.getItem("eys_token") !== null);
}

async function makeInvalidFormulaWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ekipmanlar");
  sheet.addRow(["equipment_code", "name", "category", "unit_code"]);
  sheet.addRow([`F3D6-UI-${Date.now()}`, "=1+1", "pump", "unit:999999"]);
  workbook.addWorksheet("Ekipman-Sayac").addRow(["equipment_code", "meter_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  workbook.addWorksheet("Ekipman-Enerji").addRow(["equipment_code", "energy_source_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  const dir = join(tmpdir(), "iso50001-equipment-import-ui");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `equipment-import-${Date.now()}.xlsx`);
  await writeFile(path, Buffer.from(await workbook.xlsx.writeBuffer()));
  return path;
}

async function makeValidWorkbook(unitId: number, equipmentCode: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Ekipmanlar");
  sheet.addRow([
    "equipment_code",
    "name",
    "equipment_kind",
    "category",
    "status",
    "unit_code",
    "measurement_method",
    "measurement_confidence",
    "installed_power_kw",
    "is_energy_intensive",
    "is_critical",
  ]);
  sheet.addRow([
    equipmentCode,
    "Faz 3D.6 UI import",
    "physical",
    "pump",
    "active",
    `unit:${unitId}`,
    "direct",
    "high",
    0,
    "no",
    "no",
  ]);
  workbook.addWorksheet("Ekipman-Sayac").addRow(["equipment_code", "meter_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  workbook.addWorksheet("Ekipman-Enerji").addRow(["equipment_code", "energy_source_code", "relation_role", "is_primary", "share_percent", "measurement_confidence"]);
  const dir = join(tmpdir(), "iso50001-equipment-import-ui");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `equipment-import-valid-${Date.now()}.xlsx`);
  await writeFile(path, Buffer.from(await workbook.xlsx.writeBuffer()));
  return path;
}

async function firstUnitId(page: Page) {
  return page.evaluate(async () => {
    const token = localStorage.getItem("eys_token");
    const response = await fetch("/api/units", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const rows = await response.json();
    return rows[0]?.id as number | undefined;
  });
}

test("equipment import/export toolbar ve preview dialog calisir", async ({ page }) => {
  await loginUi(page, credentials.admin);
  await page.goto("/equipment");
  await expect(page.getByTestId("equipment-page")).toBeVisible();
  await expect(page.getByTestId("equipment-template-button")).toBeVisible();
  await expect(page.getByTestId("equipment-export-button")).toBeVisible();
  await expect(page.getByTestId("equipment-import-button")).toBeVisible();

  const [templateDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("equipment-template-button").click(),
  ]);
  expect(templateDownload.suggestedFilename()).toContain("ekipman-import-sablonu");

  const [exportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("equipment-export-button").click(),
  ]);
  expect(exportDownload.suggestedFilename()).toContain("ekipman-envanteri");

  await page.getByTestId("equipment-import-button").click();
  const dialog = page.getByTestId("equipment-import-dialog");
  await expect(dialog).toBeVisible();
  const workbookPath = await makeInvalidFormulaWorkbook();
  await dialog.locator("#equipment-import-file").setInputFiles(workbookPath);
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("cell", { name: "formula_not_allowed" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();

  const unitId = await firstUnitId(page);
  expect(unitId).toBeTruthy();
  const equipmentCode = `F3D6-UI-${Date.now()}`;
  const validWorkbookPath = await makeValidWorkbook(unitId!, equipmentCode);
  await dialog.locator("#equipment-import-file").setInputFiles(validWorkbookPath);
  await dialog.getByRole("button", { name: "Preview" }).click();
  await expect(dialog.getByRole("cell", { name: "create" })).toBeVisible();
  await expect(dialog.getByText(equipmentCode)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("status")).toContainText(/Import uyguland/);
});
