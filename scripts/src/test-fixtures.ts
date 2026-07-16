import {
  companiesTable,
  consumptionTable,
  db,
  energyActionPlansTable,
  energyBaselinesTable,
  energyTargetsTable,
  energyUseGroupsTable,
  energySourcesTable,
  metersTable,
  pool,
  riskNotesTable,
  risksTable,
  seuAssessmentItemsTable,
  seuAssessmentsTable,
  seuTable,
  subUnitsTable,
  swotTable,
  unitsTable,
  usersTable,
  variablesTable,
  variableValuesTable,
  vapProjectsTable,
} from "@workspace/db";
import { count, like, sql } from "drizzle-orm";

const COMPANY_PREFIX = "[E2E]";
const USER_PREFIX = "e2e_";
const TENANT_A_SUBDOMAIN = "e2e-tenant-a";
const TENANT_B_SUBDOMAIN = "e2e-tenant-b";
const TENANT_C_SUBDOMAIN = "e2e-tenant-c-inactive";

const USERS = {
  admin: "e2e_admin_a",
  kontrolAdmin: "e2e_kontrol_admin_a",
  standardA1: "e2e_user_a1",
  standardA2: "e2e_user_a2",
  nullUnit: "e2e_user_null_unit",
  inactive: "e2e_inactive_user_a1",
  inactiveCompany: "e2e_inactive_company_user",
  session: "e2e_session_user",
  standardB1: "e2e_user_b1",
  adminB: "e2e_admin_b",
  superadmin: "e2e_superadmin",
} as const;

type PasswordHelpers = {
  hashPassword(password: string): Promise<string>;
  verifyPassword(password: string, storedHash: string): Promise<boolean>;
};

function assertDisposableEnvironment(): void {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.TEST_DB_DISPOSABLE !== "true" ||
    !/^[a-f0-9]{64}$/i.test(process.env.TEST_DB_CONTAINER_ID ?? "") ||
    !/^[a-f0-9]{24}$/i.test(process.env.TEST_DB_RUN_ID ?? "")
  ) {
    throw new Error(
      "Fixture yalnız doğrulanmış disposable test DB üzerinde çalışır.",
    );
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error("Disposable DATABASE_URL eksik.");
  const databaseUrl = new URL(rawUrl);
  if (
    !["postgres:", "postgresql:"].includes(databaseUrl.protocol) ||
    databaseUrl.hostname !== "127.0.0.1" ||
    databaseUrl.pathname !== "/iso50001_test" ||
    databaseUrl.port !== process.env.TEST_DB_PORT
  ) {
    throw new Error(
      "Fixture bağlantısı localhost disposable DB ile eşleşmiyor.",
    );
  }
}

function fixturePassword(): string {
  const password = process.env.E2E_TEST_PASSWORD;
  if (!password || password.length < 24) {
    throw new Error("E2E_TEST_PASSWORD güvenli runtime değeri eksik.");
  }
  return password;
}

async function passwordHelpers(): Promise<PasswordHelpers> {
  const moduleUrl = new URL(
    "../../artifacts/api-server/src/security/passwords.ts",
    import.meta.url,
  ).href;
  return (await import(moduleUrl)) as PasswordHelpers;
}

async function applyFixtures(): Promise<void> {
  const password = fixturePassword();
  const { hashPassword } = await passwordHelpers();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    const [companyMarker] = await tx
      .select({ value: count() })
      .from(companiesTable)
      .where(like(companiesTable.name, `${COMPANY_PREFIX}%`));
    const [userMarker] = await tx
      .select({ value: count() })
      .from(usersTable)
      .where(like(usersTable.username, `${USER_PREFIX}%`));
    if ((companyMarker?.value ?? 0) > 0 || (userMarker?.value ?? 0) > 0) {
      throw new Error(
        "Fixture marker kayıtları zaten mevcut; ikinci apply reddedildi.",
      );
    }

    await tx.execute(sql`
      SELECT setval(
        pg_get_serial_sequence('companies', 'id'),
        COALESCE((SELECT max(id) FROM companies), 1),
        true
      )
    `);

    const [tenantA] = await tx
      .insert(companiesTable)
      .values({
        name: `${COMPANY_PREFIX} Tenant A`,
        subdomain: TENANT_A_SUBDOMAIN,
      })
      .returning({ id: companiesTable.id });
    const [tenantB] = await tx
      .insert(companiesTable)
      .values({
        name: `${COMPANY_PREFIX} Tenant B`,
        subdomain: TENANT_B_SUBDOMAIN,
      })
      .returning({ id: companiesTable.id });
    const [tenantC] = await tx
      .insert(companiesTable)
      .values({
        name: `${COMPANY_PREFIX} Tenant C Inactive`,
        subdomain: TENANT_C_SUBDOMAIN,
        isActive: false,
      })
      .returning({ id: companiesTable.id });
    if (!tenantA || !tenantB || !tenantC) {
      throw new Error("Fixture company kayıtları oluşturulamadı.");
    }

    const [unitA1, unitA2, unitB1] = await tx
      .insert(unitsTable)
      .values([
        {
          companyId: tenantA.id,
          name: `${COMPANY_PREFIX} Unit A1`,
          location: "Test A1",
          city: "Ankara",
        },
        {
          companyId: tenantA.id,
          name: `${COMPANY_PREFIX} Unit A2`,
          location: "Test A2",
          city: "İzmir",
        },
        {
          companyId: tenantB.id,
          name: `${COMPANY_PREFIX} Unit B1`,
          location: "Test B1",
          city: "Bursa",
        },
      ])
      .returning({ id: unitsTable.id, companyId: unitsTable.companyId });
    if (!unitA1 || !unitA2 || !unitB1) {
      throw new Error("Fixture unit kayıtları oluşturulamadı.");
    }

    const [subUnitA1, subUnitA2, subUnitB1, campusA1, campusA2, campusB1] = await tx.insert(subUnitsTable).values([
      {
        companyId: tenantA.id,
        unitId: unitA1.id,
        name: `${COMPANY_PREFIX} Sub-unit A1`,
      },
      {
        companyId: tenantA.id,
        unitId: unitA2.id,
        name: `${COMPANY_PREFIX} Sub-unit A2`,
      },
      {
        companyId: tenantB.id,
        unitId: unitB1.id,
        name: `${COMPANY_PREFIX} Sub-unit B1`,
      },
      { companyId: tenantA.id, unitId: unitA1.id, name: `${COMPANY_PREFIX} Campus A1`, city: "Ankara / Cankaya" },
      { companyId: tenantA.id, unitId: unitA2.id, name: `${COMPANY_PREFIX} Campus A2`, city: "Izmir / Konak" },
      { companyId: tenantB.id, unitId: unitB1.id, name: `${COMPANY_PREFIX} Campus A1`, city: "Bursa / Nilufer" },
    ]).returning({ id: subUnitsTable.id });
    if (!subUnitA1 || !subUnitA2 || !subUnitB1 || !campusA1 || !campusA2 || !campusB1) {
      throw new Error("Fixture sub-unit kayıtları oluşturulamadı.");
    }

    const [, , , electricityA1, naturalGasA1, electricityA2, electricityB1] = await tx.insert(energySourcesTable).values([
      {
        companyId: tenantA.id,
        unitId: unitA1.id,
        type: "elektrik",
        name: `${COMPANY_PREFIX} Common Source`,
        unit: "kWh",
      },
      {
        companyId: tenantA.id,
        unitId: unitA2.id,
        type: "dogalgaz",
        name: `${COMPANY_PREFIX} Source A2`,
        unit: "m3",
      },
      {
        companyId: tenantB.id,
        unitId: unitB1.id,
        type: "elektrik",
        name: `${COMPANY_PREFIX} Common Source`,
        unit: "kWh",
      },
      { companyId: tenantA.id, unitId: unitA1.id, type: "elektrik", name: `${COMPANY_PREFIX} Electricity A1`, unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA1.id, type: "dogalgaz", name: `${COMPANY_PREFIX} Natural Gas A1`, unit: "m3" },
      { companyId: tenantA.id, unitId: unitA2.id, type: "elektrik", name: `${COMPANY_PREFIX} Electricity A2`, unit: "kWh" },
      { companyId: tenantB.id, unitId: unitB1.id, type: "elektrik", name: `${COMPANY_PREFIX} Electricity A1`, unit: "kWh" },
    ]).returning({ id: energySourcesTable.id });
    if (!electricityA1 || !naturalGasA1 || !electricityA2 || !electricityB1) {
      throw new Error("Fixture energy source kayıtları oluşturulamadı.");
    }

    const [lightingA1, heatingA1, groupA2, lightingB1, seuElectricityGroup, seuNaturalGasGroup] = await tx
      .insert(energyUseGroupsTable)
      .values([
        { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Lighting`, groupType: "lighting", createdBy: "E2E fixture" },
        { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: naturalGasA1.id, name: `${COMPANY_PREFIX} Heating`, groupType: "hvac", createdBy: "E2E fixture" },
        { companyId: tenantA.id, unitId: unitA2.id, subUnitId: campusA2.id, energySourceId: electricityA2.id, name: `${COMPANY_PREFIX} Production A2`, groupType: "production", createdBy: "E2E fixture" },
        { companyId: tenantB.id, unitId: unitB1.id, subUnitId: campusB1.id, energySourceId: electricityB1.id, name: `${COMPANY_PREFIX} Lighting`, groupType: "lighting", createdBy: "E2E fixture" },
        { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} SEU Electricity Group`, groupType: "production", isSeuCandidate: true, createdBy: "E2E fixture" },
        { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: naturalGasA1.id, name: `${COMPANY_PREFIX} SEU Natural Gas Group`, groupType: "hvac", isSeuCandidate: true, createdBy: "E2E fixture" },
      ])
      .returning({ id: energyUseGroupsTable.id });
    if (!lightingA1 || !heatingA1 || !groupA2 || !lightingB1 || !seuElectricityGroup || !seuNaturalGasGroup) {
      throw new Error("Fixture energy use group records could not be created.");
    }

    const [electricMeterA1, gasMeterA1, manualMeterA1, virtualMeterA1, importMeterA1, dependencyMeterA1, meterA2, meterB1] = await tx.insert(metersTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, energyUseGroupId: lightingA1.id, name: `${COMPANY_PREFIX} Shared Meter`, type: "elektrik", recordType: "physical_meter", location: "Main Panel", city: "Ankara / Cankaya", unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: naturalGasA1.id, name: `${COMPANY_PREFIX} Gas Meter A1`, type: "dogalgaz", recordType: "physical_meter", location: "Boiler Room", city: "Ankara / Cankaya", unit: "m3" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Manual Meter A1`, type: "elektrik", recordType: "manual_consumption_point", location: "Invoice", city: "Ankara / Cankaya", unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Virtual Meter A1`, type: "elektrik", recordType: "virtual_meter", location: "Calculated", city: "Ankara / Cankaya", unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Import Meter A1`, type: "elektrik", recordType: "physical_meter", location: "Import", city: "Ankara / Cankaya", unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Dependency Meter A1`, type: "elektrik", recordType: "physical_meter", location: "Dependency", city: "Ankara / Cankaya", unit: "kWh" },
      { companyId: tenantA.id, unitId: unitA2.id, subUnitId: campusA2.id, energySourceId: electricityA2.id, name: `${COMPANY_PREFIX} Meter A2`, type: "elektrik", recordType: "physical_meter", location: "A2 Panel", city: "Izmir / Konak", unit: "kWh" },
      { companyId: tenantB.id, unitId: unitB1.id, subUnitId: campusB1.id, energySourceId: electricityB1.id, name: `${COMPANY_PREFIX} Shared Meter`, type: "elektrik", recordType: "physical_meter", location: "B1 Panel", city: "Bursa / Nilufer", unit: "kWh" },
    ]).returning({ id: metersTable.id });
    if (!electricMeterA1 || !gasMeterA1 || !manualMeterA1 || !virtualMeterA1 || !importMeterA1 || !dependencyMeterA1 || !meterA2 || !meterB1) {
      throw new Error("Fixture meter kayıtları oluşturulamadı.");
    }

    await tx.insert(consumptionTable).values([
      { companyId: tenantA.id, meterId: electricMeterA1.id, year: 2025, month: 1, kwh: 1000, tep: 0.086, co2: 400, hdd: 120, cdd: 10 },
      { companyId: tenantA.id, meterId: electricMeterA1.id, year: 2025, month: 2, kwh: 1500, tep: 0.129, co2: 600, hdd: 90, cdd: 20 },
      { companyId: tenantA.id, meterId: electricMeterA1.id, year: 2025, month: 3, kwh: 2000, tep: 0.172, co2: 800, hdd: 60, cdd: 30 },
      { companyId: tenantA.id, meterId: gasMeterA1.id, year: 2025, month: 1, kwh: 1000, tep: 0.86, co2: 202, hdd: 120, cdd: 10 },
      { companyId: tenantA.id, meterId: gasMeterA1.id, year: 2026, month: 1, kwh: 1500, tep: 1.29, co2: 303, hdd: 130, cdd: 5 },
      { companyId: tenantA.id, meterId: dependencyMeterA1.id, year: 2025, month: 1, kwh: 250, tep: 0.0215, co2: 100 },
      { companyId: tenantB.id, meterId: meterB1.id, year: 2025, month: 1, kwh: 700, tep: 0.0602, co2: 280 },
      { companyId: tenantB.id, meterId: meterB1.id, year: 2025, month: 2, kwh: 900, tep: 0.0774, co2: 360 },
      ...Array.from({ length: 9 }, (_, index) => {
        const month = index + 4;
        const kwh = 2500 + index * 500;
        return { companyId: tenantA.id, meterId: electricMeterA1.id, year: 2025, month, kwh, tep: kwh * 0.000086, co2: kwh * 0.4, hdd: Math.max(0, 50 - index * 6), cdd: 40 + index * 8 };
      }),
      ...Array.from({ length: 11 }, (_, index) => {
        const month = index + 2;
        const kwh = 1000 + index * 100;
        return { companyId: tenantA.id, meterId: gasMeterA1.id, year: 2025, month, kwh, tep: kwh * 0.00086, co2: kwh * 0.202, hdd: Math.max(0, 110 - index * 9), cdd: index * 5 };
      }),
      ...Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const kwh = 1200 + index * 150;
        return { companyId: tenantA.id, meterId: meterA2.id, year: 2025, month, kwh, tep: kwh * 0.000086, co2: kwh * 0.4 };
      }),
      ...Array.from({ length: 10 }, (_, index) => {
        const month = index + 3;
        const kwh = 1100 + index * 100;
        return { companyId: tenantB.id, meterId: meterB1.id, year: 2025, month, kwh, tep: kwh * 0.000086, co2: kwh * 0.4 };
      }),
    ]);

    const [productionQuantity, operatingHours, importVariable, dependencyVariable, operatingHoursB, partialVariable, invalidModelVariable] = await tx
      .insert(variablesTable)
      .values([
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Production Quantity`, code: "E2E_PRODUCTION", category: "production", unitLabel: "adet", variableType: "numeric", sourceType: "production_manual", scopeType: "company" },
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Operating Hours`, code: "E2E_HOURS", category: "operational", unitLabel: "saat", variableType: "numeric", sourceType: "operation_manual", scopeType: "unit" },
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Import Variable`, code: "E2E_IMPORT", category: "operational", unitLabel: "adet", variableType: "numeric", sourceType: "operation_manual", scopeType: "unit" },
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Dependency Variable`, code: "E2E_DEPENDENCY", category: "operational", unitLabel: "adet", variableType: "numeric", sourceType: "operation_manual", scopeType: "company" },
        { companyId: tenantB.id, name: `${COMPANY_PREFIX} Operating Hours`, code: "E2E_HOURS", category: "operational", unitLabel: "saat", variableType: "numeric", sourceType: "operation_manual", scopeType: "unit" },
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Partial Variable`, code: "E2E_PARTIAL", category: "operational", unitLabel: "adet", variableType: "numeric", sourceType: "operation_manual", scopeType: "company" },
        { companyId: tenantA.id, name: `${COMPANY_PREFIX} Invalid Model Variable`, code: "E2E_INVALID_MODEL", category: "operational", unitLabel: "adet", variableType: "numeric", sourceType: "operation_manual", scopeType: "company" },
      ])
      .returning({ id: variablesTable.id });
    if (!productionQuantity || !operatingHours || !importVariable || !dependencyVariable || !operatingHoursB || !partialVariable || !invalidModelVariable) {
      throw new Error("Fixture variable records could not be created.");
    }

    await tx.insert(variableValuesTable).values([
      { companyId: tenantA.id, variableId: productionQuantity.id, periodStart: "2025-01-01", periodEnd: "2025-01-31", value: 100, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: productionQuantity.id, periodStart: "2025-02-01", periodEnd: "2025-02-28", value: 150.5, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: productionQuantity.id, periodStart: "2025-03-01", periodEnd: "2025-03-31", value: 200, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA1.id, periodStart: "2025-01-01", periodEnd: "2025-01-31", value: 100, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA1.id, periodStart: "2025-02-01", periodEnd: "2025-02-28", value: 150.5, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA1.id, periodStart: "2025-03-01", periodEnd: "2025-03-31", value: 200, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA2.id, periodStart: "2026-01-01", periodEnd: "2026-01-31", value: 300, source: "E2E fixture" },
      { companyId: tenantA.id, variableId: dependencyVariable.id, periodStart: "2026-01-01", periodEnd: "2026-01-31", value: 1, source: "E2E fixture" },
      { companyId: tenantB.id, variableId: operatingHoursB.id, unitId: unitB1.id, periodStart: "2025-01-01", periodEnd: "2025-01-31", value: 700, source: "E2E fixture" },
      { companyId: tenantB.id, variableId: operatingHoursB.id, unitId: unitB1.id, periodStart: "2025-02-01", periodEnd: "2025-02-28", value: 900, source: "E2E fixture" },
      ...Array.from({ length: 9 }, (_, index) => ({
        companyId: tenantA.id, variableId: productionQuantity.id,
        periodStart: `2025-${String(index + 4).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 4).padStart(2, "0")}-28`,
        value: 250 + index * 50, source: "E2E fixture",
      })),
      ...[250, 300, 350, 400, 450, 500, 550, 600, 650].map((value, index) => ({
        companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA1.id,
        periodStart: `2025-${String(index + 4).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 4).padStart(2, "0")}-28`, value, source: "E2E fixture",
      })),
      ...Array.from({ length: 12 }, (_, index) => ({
        companyId: tenantA.id, variableId: operatingHours.id, unitId: unitA2.id,
        periodStart: `2025-${String(index + 1).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 1).padStart(2, "0")}-28`, value: 50 + index * 7, source: "E2E fixture",
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        companyId: tenantA.id, variableId: partialVariable.id,
        periodStart: `2025-${String(index + 1).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 1).padStart(2, "0")}-28`, value: 10 + index * 3, source: "E2E fixture",
      })),
      ...[9, 2, 11, 4, 8, 1, 12, 5, 7, 3, 10, 6].map((value, index) => ({
        companyId: tenantA.id, variableId: invalidModelVariable.id,
        periodStart: `2025-${String(index + 1).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 1).padStart(2, "0")}-28`, value, source: "E2E fixture",
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        companyId: tenantB.id, variableId: operatingHoursB.id, unitId: unitB1.id,
        periodStart: `2025-${String(index + 3).padStart(2, "0")}-01`, periodEnd: `2025-${String(index + 3).padStart(2, "0")}-28`, value: 1000 + index * 100, source: "E2E fixture",
      })),
    ]);

    const [officialA1, draftA1, officialA2, officialB1] = await tx.insert(seuAssessmentsTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, year: 2025, analysisLevel: "meter", recordType: "unit_official", isOfficial: true, unitTotalTep: 12.5 },
      { companyId: tenantA.id, unitId: unitA1.id, year: 2025, analysisLevel: "meter", recordType: "admin_review", isOfficial: false, unitTotalTep: 1 },
      { companyId: tenantA.id, unitId: unitA2.id, year: 2025, analysisLevel: "meter", recordType: "unit_official", isOfficial: true, unitTotalTep: 2.1 },
      { companyId: tenantB.id, unitId: unitB1.id, year: 2025, analysisLevel: "meter", recordType: "unit_official", isOfficial: true, unitTotalTep: 1.5 },
    ]).returning({ id: seuAssessmentsTable.id });
    if (!officialA1 || !draftA1 || !officialA2 || !officialB1) throw new Error("Fixture SEU assessments could not be created.");

    const [acceptedA1, rejectedA1, monitorA1, draftAcceptedA1, acceptedA2, acceptedB1] = await tx.insert(seuAssessmentItemsTable).values([
      { assessmentId: officialA1.id, meterId: electricMeterA1.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, energyUseGroupId: lightingA1.id, name: `${COMPANY_PREFIX} SEU Electricity A1`, energyTep: 4.5, consumptionSharePercent: 60, hasOpportunity: true, priorityResult: 1, systemRecommendation: "seu_candidate", userDecision: "accepted_as_seu" },
      { assessmentId: officialA1.id, meterId: gasMeterA1.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: naturalGasA1.id, energyUseGroupId: heatingA1.id, name: `${COMPANY_PREFIX} SEU Natural Gas A1`, energyTep: 3.5, consumptionSharePercent: 30, priorityResult: 3, systemRecommendation: "seu_candidate", userDecision: "not_seu" },
      { assessmentId: officialA1.id, meterId: dependencyMeterA1.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} SEU Monitoring A1`, energyTep: 0.5, consumptionSharePercent: 10, priorityResult: 3, systemRecommendation: "seu_candidate", userDecision: "monitor" },
      { assessmentId: draftA1.id, meterId: manualMeterA1.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, name: `${COMPANY_PREFIX} Draft Accepted A1`, energyTep: 1, consumptionSharePercent: 100, priorityResult: 1, systemRecommendation: "seu_candidate", userDecision: "accepted_as_seu" },
      { assessmentId: officialA2.id, meterId: meterA2.id, unitId: unitA2.id, subUnitId: campusA2.id, energySourceId: electricityA2.id, energyUseGroupId: groupA2.id, name: `${COMPANY_PREFIX} SEU Electricity A2`, energyTep: 2.1, consumptionSharePercent: 100, priorityResult: 1, systemRecommendation: "seu_candidate", userDecision: "accepted_as_seu" },
      { assessmentId: officialB1.id, meterId: meterB1.id, unitId: unitB1.id, subUnitId: campusB1.id, energySourceId: electricityB1.id, energyUseGroupId: lightingB1.id, name: `${COMPANY_PREFIX} SEU Electricity A1`, energyTep: 1.5, consumptionSharePercent: 100, priorityResult: 1, systemRecommendation: "seu_candidate", userDecision: "accepted_as_seu" },
    ]).returning({ id: seuAssessmentItemsTable.id });
    if (!acceptedA1 || !rejectedA1 || !monitorA1 || !draftAcceptedA1 || !acceptedA2 || !acceptedB1) {
      throw new Error("Fixture SEU assessment items could not be created.");
    }

    const [baselineA1, baselineA2, baselineB1] = await tx.insert(energyBaselinesTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, seuAssessmentItemId: acceptedA1.id, baselineYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31", modelType: "linear", status: "active", isValid: true, notes: `${COMPANY_PREFIX} target parent fixture` },
      { companyId: tenantA.id, unitId: unitA2.id, seuAssessmentItemId: acceptedA2.id, baselineYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31", modelType: "linear", status: "active", isValid: true, notes: `${COMPANY_PREFIX} target parent fixture` },
      { companyId: tenantB.id, unitId: unitB1.id, seuAssessmentItemId: acceptedB1.id, baselineYear: 2025, periodStart: "2025-01-01", periodEnd: "2025-12-31", modelType: "linear", status: "active", isValid: true, notes: `${COMPANY_PREFIX} target parent fixture` },
    ]).returning({ id: energyBaselinesTable.id });
    if (!baselineA1 || !baselineA2 || !baselineB1) throw new Error("Fixture target baselines could not be created.");

    await tx.insert(seuTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, name: `${COMPANY_PREFIX} Manual SEU A1`, category: "electricity", annualKwh: 10000, percentage: 40, priority: 1 },
      { companyId: tenantA.id, unitId: unitA2.id, name: `${COMPANY_PREFIX} Manual SEU A2`, category: "electricity", annualKwh: 5000, percentage: 25, priority: 2 },
      { companyId: tenantB.id, unitId: unitB1.id, name: `${COMPANY_PREFIX} Manual SEU A1`, category: "electricity", annualKwh: 7000, percentage: 30, priority: 1 },
    ]);

    const fixtureUsers = await tx.insert(usersTable).values([
      {
        companyId: tenantA.id,
        username: USERS.standardA1,
        passwordHash,
        name: "E2E User A1",
        role: "user",
        unitId: unitA1.id,
      },
      {
        companyId: tenantA.id,
        username: USERS.standardA2,
        passwordHash,
        name: "E2E User A2",
        role: "user",
        unitId: unitA2.id,
      },
      {
        companyId: tenantA.id,
        username: USERS.admin,
        passwordHash,
        name: "E2E Admin A",
        role: "admin",
        unitId: null,
      },
      {
        companyId: tenantA.id,
        username: USERS.kontrolAdmin,
        passwordHash,
        name: "E2E Kontrol Admin A",
        role: "kontrol_admin",
        unitId: null,
      },
      {
        companyId: tenantA.id,
        username: USERS.nullUnit,
        passwordHash,
        name: "E2E Null Unit User",
        role: "user",
        unitId: null,
      },
      {
        companyId: tenantA.id,
        username: USERS.inactive,
        passwordHash,
        name: "E2E Inactive User",
        role: "user",
        unitId: unitA1.id,
        active: false,
      },
      {
        companyId: tenantC.id,
        username: USERS.inactiveCompany,
        passwordHash,
        name: "E2E Inactive Company User",
        role: "user",
        unitId: null,
      },
      {
        companyId: tenantA.id,
        username: USERS.session,
        passwordHash,
        name: "E2E Session User",
        role: "user",
        unitId: unitA1.id,
      },
      {
        companyId: tenantB.id,
        username: USERS.standardB1,
        passwordHash,
        name: "E2E User B1",
        role: "user",
        unitId: unitB1.id,
      },
      {
        companyId: tenantB.id,
        username: USERS.adminB,
        passwordHash,
        name: "E2E Admin B",
        role: "admin",
        unitId: null,
      },
      {
        companyId: tenantA.id,
        username: USERS.superadmin,
        passwordHash,
        name: "E2E Superadmin",
        role: "superadmin",
        unitId: null,
      },
    ]).returning({ id: usersTable.id, username: usersTable.username });

    const userIdByUsername = new Map(fixtureUsers.map((user) => [user.username, user.id]));
    const adminAId = userIdByUsername.get(USERS.admin);
    const standardA1Id = userIdByUsername.get(USERS.standardA1);
    const standardB1Id = userIdByUsername.get(USERS.standardB1);
    if (!adminAId || !standardA1Id || !standardB1Id) {
      throw new Error("Fixture SWOT/risk note users could not be resolved.");
    }

    const [targetA1, targetA1Gas, targetA1Delete, targetA2, targetB1] = await tx.insert(energyTargetsTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: electricityA1.id, seuAssessmentId: officialA1.id, seuAssessmentItemId: acceptedA1.id, baselineId: baselineA1.id, name: `${COMPANY_PREFIX} Electricity Reduction Target`, baselineYear: 2025, targetYear: 2028, targetReductionPercent: 10, baselineValue: 1000, targetValue: 900, unitLabel: "kWh", targetType: "consumption_reduction", status: "active", objectiveText: "Elektrik tüketimini azalt" },
      { companyId: tenantA.id, unitId: unitA1.id, subUnitId: campusA1.id, energySourceId: naturalGasA1.id, seuAssessmentId: officialA1.id, seuAssessmentItemId: acceptedA1.id, baselineId: baselineA1.id, name: `${COMPANY_PREFIX} Natural Gas Monitoring Target`, baselineYear: 2025, targetYear: 2027, targetReductionPercent: 5, baselineValue: 500, targetValue: 475, unitLabel: "kWh", targetType: "monitoring", status: "draft" },
      { companyId: tenantA.id, unitId: unitA1.id, seuAssessmentId: officialA1.id, seuAssessmentItemId: acceptedA1.id, baselineId: baselineA1.id, name: `${COMPANY_PREFIX} Independent Delete Target`, baselineYear: 2025, targetYear: 2029, targetReductionPercent: 3, targetType: "efficiency_improvement", status: "draft" },
      { companyId: tenantA.id, unitId: unitA2.id, subUnitId: campusA2.id, energySourceId: electricityA2.id, seuAssessmentId: officialA2.id, seuAssessmentItemId: acceptedA2.id, baselineId: baselineA2.id, name: `${COMPANY_PREFIX} Unit A2 Target`, baselineYear: 2025, targetYear: 2026, targetReductionPercent: 8, baselineValue: 1200, targetValue: 1104, unitLabel: "kWh", targetType: "consumption_reduction", status: "active" },
      { companyId: tenantB.id, unitId: unitB1.id, subUnitId: campusB1.id, energySourceId: electricityB1.id, seuAssessmentId: officialB1.id, seuAssessmentItemId: acceptedB1.id, baselineId: baselineB1.id, name: `${COMPANY_PREFIX} Electricity Reduction Target`, baselineYear: 2025, targetYear: 2028, targetReductionPercent: 10, baselineValue: 700, targetValue: 630, unitLabel: "kWh", targetType: "consumption_reduction", status: "active" },
    ]).returning({ id: energyTargetsTable.id });
    if (!targetA1 || !targetA1Gas || !targetA1Delete || !targetA2 || !targetB1) throw new Error("Fixture target records could not be created.");

    const [motorsAction, overdueAction, completedAction, deleteAction, motorVapAction, deleteVapAction, actionA2, actionB1] = await tx.insert(energyActionPlansTable).values([
      { companyId: tenantA.id, targetId: targetA1.id, title: `${COMPANY_PREFIX} Replace inefficient motors`, responsibleUserId: standardA1Id, responsibleName: "E2E User A1", priority: "high", startDate: "2025-01-01", dueDate: "2026-12-31", progressPercent: 25, status: "in_progress", isVap: true, expectedCostSaving: 50000, investmentCost: 100000, paybackMonths: 24 },
      { companyId: tenantA.id, targetId: targetA1.id, title: `${COMPANY_PREFIX} Optimize operating schedule`, responsibleUserId: standardA1Id, responsibleName: "E2E User A1", priority: "medium", startDate: "2024-01-01", dueDate: "2024-06-30", progressPercent: 40, status: "in_progress" },
      { companyId: tenantA.id, targetId: targetA1.id, title: `${COMPANY_PREFIX} Completed lighting retrofit`, responsibleUserId: standardA1Id, responsibleName: "E2E User A1", startDate: "2024-01-01", dueDate: "2024-12-31", completionDate: "2024-11-30", progressPercent: 100, status: "completed" },
      { companyId: tenantA.id, targetId: targetA1.id, title: `${COMPANY_PREFIX} Independent Delete Action`, progressPercent: 0, status: "planned" },
      { companyId: tenantA.id, targetId: targetA1Gas.id, title: `${COMPANY_PREFIX} High Efficiency Motor Action`, progressPercent: 10, status: "planned", isVap: true },
      { companyId: tenantA.id, targetId: targetA1Gas.id, title: `${COMPANY_PREFIX} Delete VAP Action`, progressPercent: 0, status: "planned", isVap: true },
      { companyId: tenantA.id, targetId: targetA2.id, title: `${COMPANY_PREFIX} Unit A2 Action`, progressPercent: 20, status: "in_progress", isVap: true },
      { companyId: tenantB.id, targetId: targetB1.id, title: `${COMPANY_PREFIX} Replace inefficient motors`, responsibleUserId: standardB1Id, responsibleName: "E2E User B1", progressPercent: 25, status: "in_progress", isVap: true },
    ]).returning({ id: energyActionPlansTable.id });
    if (!motorsAction || !overdueAction || !completedAction || !deleteAction || !motorVapAction || !deleteVapAction || !actionA2 || !actionB1) throw new Error("Fixture action records could not be created.");

    await tx.insert(vapProjectsTable).values([
      { companyId: tenantA.id, actionPlanId: motorsAction.id, projectCode: "E2E-VAP-001", projectTitle: `${COMPANY_PREFIX} Heat Recovery VAP`, projectType: "efficiency", annualEnergySavingValue: 250, annualEnergySavingUnit: "MWh", annualCostSaving: 50000, investmentCost: 100000, paybackMonths: 24, status: "active", startDate: "2025-01-01", endDate: "2026-12-31" },
      { companyId: tenantA.id, actionPlanId: motorVapAction.id, projectCode: "E2E-VAP-002", projectTitle: `${COMPANY_PREFIX} High Efficiency Motor VAP`, annualEnergySavingValue: 100, annualEnergySavingUnit: "MWh", annualCostSaving: 20000, investmentCost: 60000, paybackMonths: 36, status: "planned" },
      { companyId: tenantA.id, actionPlanId: deleteVapAction.id, projectCode: "E2E-VAP-DELETE", projectTitle: `${COMPANY_PREFIX} Independent Delete VAP`, status: "idea" },
      { companyId: tenantA.id, actionPlanId: actionA2.id, projectCode: "E2E-VAP-A2", projectTitle: `${COMPANY_PREFIX} Unit A2 VAP`, annualCostSaving: 10000, investmentCost: 20000, paybackMonths: 24, status: "active" },
      { companyId: tenantB.id, actionPlanId: actionB1.id, projectCode: "E2E-VAP-B1", projectTitle: `${COMPANY_PREFIX} Heat Recovery VAP`, annualCostSaving: 30000, investmentCost: 60000, paybackMonths: 24, status: "active" },
    ]);

    await tx.insert(swotTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, category: "strengths", title: `${COMPANY_PREFIX} Efficient Equipment`, description: "A1 strength", score: 5, impact: "yuksek" },
      { companyId: tenantA.id, unitId: unitA1.id, category: "weaknesses", title: `${COMPANY_PREFIX} Manual Readings`, description: "A1 weakness", score: 3, impact: "orta" },
      { companyId: tenantA.id, unitId: unitA1.id, category: "opportunities", title: `${COMPANY_PREFIX} Solar Potential`, description: "A1 opportunity", score: 4, impact: "yuksek" },
      { companyId: tenantA.id, unitId: unitA1.id, category: "threats", title: `${COMPANY_PREFIX} Tariff Increase`, description: "A1 threat", score: 2, impact: "dusuk" },
      { companyId: tenantA.id, unitId: unitA2.id, category: "strengths", title: `${COMPANY_PREFIX} Efficient Equipment`, description: "A2 strength", score: 4, impact: "orta" },
      { companyId: tenantB.id, unitId: unitB1.id, category: "strengths", title: `${COMPANY_PREFIX} Efficient Equipment`, description: "B1 strength", score: 5, impact: "yuksek" },
    ]);

    const [riskLowA1, riskMediumA1, riskHighA1, opportunityA1, actionRiskA1, riskA2, riskB1] = await tx.insert(risksTable).values([
      { companyId: tenantA.id, unitId: unitA1.id, type: "risk", title: `${COMPANY_PREFIX} Shared Supply Risk`, description: "Low A1 risk", probability: 1, severity: 2, score: 2, responseType: "izleme", status: "acik" },
      { companyId: tenantA.id, unitId: unitA1.id, type: "risk", title: `${COMPANY_PREFIX} Medium Equipment Risk`, description: "Medium A1 risk", probability: 3, severity: 3, score: 9, responseType: "izleme", status: "devam" },
      { companyId: tenantA.id, unitId: unitA1.id, type: "risk", title: `${COMPANY_PREFIX} High Supply Risk`, description: "High A1 risk", probability: 5, severity: 5, score: 25, responseType: "izleme", status: "acik" },
      { companyId: tenantA.id, unitId: unitA1.id, type: "firsat", title: `${COMPANY_PREFIX} Efficiency Opportunity`, description: "A1 opportunity", probability: 4, severity: 4, score: 16, responseType: "izleme", status: "acik" },
      { companyId: tenantA.id, unitId: unitA1.id, type: "risk", title: `${COMPANY_PREFIX} Action Risk`, description: "A1 action risk", probability: 4, severity: 5, score: 20, responseType: "aksiyon", mitigationPlan: "E2E mitigation plan", targetProbability: 2, targetSeverity: 2, targetScore: 4, owner: "Energy Team", status: "devam" },
      { companyId: tenantA.id, unitId: unitA2.id, type: "risk", title: `${COMPANY_PREFIX} Unit A2 Risk`, description: "A2 risk", probability: 2, severity: 3, score: 6, responseType: "izleme", status: "acik" },
      { companyId: tenantB.id, unitId: unitB1.id, type: "risk", title: `${COMPANY_PREFIX} Shared Supply Risk`, description: "B1 risk", probability: 4, severity: 4, score: 16, responseType: "izleme", status: "acik" },
    ]).returning({ id: risksTable.id });
    if (!riskLowA1 || !riskMediumA1 || !riskHighA1 || !opportunityA1 || !actionRiskA1 || !riskA2 || !riskB1) {
      throw new Error("Fixture risk records could not be created.");
    }

    await tx.insert(riskNotesTable).values([
      { companyId: tenantA.id, riskId: riskMediumA1.id, userId: standardA1Id, userName: "E2E User A1", content: `${COMPANY_PREFIX} A1 progress note` },
      { companyId: tenantA.id, riskId: actionRiskA1.id, userId: adminAId, userName: "E2E Admin A", content: `${COMPANY_PREFIX} A1 admin note` },
      { companyId: tenantB.id, riskId: riskB1.id, userId: standardB1Id, userName: "E2E User B1", content: `${COMPANY_PREFIX} B1 progress note` },
    ]);
  });

  console.log(
    "[test-fixtures] Fixture oluşturuldu: 3 company, 3 unit, 6 sub-unit, 7 energy source, 6 energy use group, 8 meter, 50 consumption, 7 variable, 69 variable value, 4 SEU assessment, 6 SEU assessment item, 3 manual SEU, 5 target, 8 action, 5 VAP, 6 SWOT, 7 risk, 3 risk note, 11 user.",
  );
}

async function assertFixtures(): Promise<void> {
  const password = fixturePassword();
  const { verifyPassword } = await passwordHelpers();
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const companies = await client.query<{
      id: number;
      subdomain: string;
      is_active: boolean;
    }>(
      "SELECT id, subdomain, is_active FROM companies WHERE subdomain = ANY($1::text[]) ORDER BY subdomain",
      [[TENANT_A_SUBDOMAIN, TENANT_B_SUBDOMAIN, TENANT_C_SUBDOMAIN]],
    );
    if (companies.rowCount !== 3) {
      throw new Error("Fixture company sayısı 3 değil.");
    }
    const companyBySubdomain = new Map(
      companies.rows.map((row) => [row.subdomain, row.id]),
    );
    const tenantAId = companyBySubdomain.get(TENANT_A_SUBDOMAIN);
    const tenantBId = companyBySubdomain.get(TENANT_B_SUBDOMAIN);
    const tenantCId = companyBySubdomain.get(TENANT_C_SUBDOMAIN);
    const tenantC = companies.rows.find(
      (company) => company.subdomain === TENANT_C_SUBDOMAIN,
    );
    if (!tenantAId || !tenantBId || !tenantCId || tenantC?.is_active !== false) {
      throw new Error("Fixture tenant kimlikleri çözülemedi.");
    }

    const units = await client.query<{
      id: number;
      company_id: number;
      name: string;
    }>(
      "SELECT id, company_id, name FROM units WHERE name LIKE $1 ORDER BY name",
      [`${COMPANY_PREFIX}%`],
    );
    if (units.rowCount !== 3) throw new Error("Fixture unit sayısı 3 değil.");
    const unitByName = new Map(units.rows.map((row) => [row.name, row]));
    const unitA1 = unitByName.get(`${COMPANY_PREFIX} Unit A1`);
    const unitA2 = unitByName.get(`${COMPANY_PREFIX} Unit A2`);
    const unitB1 = unitByName.get(`${COMPANY_PREFIX} Unit B1`);
    if (!unitA1 || !unitA2 || !unitB1) {
      throw new Error("Fixture unit eşlemesi eksik.");
    }
    if (
      unitA1.company_id !== tenantAId ||
      unitA2.company_id !== tenantAId ||
      unitB1.company_id !== tenantBId
    ) {
      throw new Error("Fixture unit tenant ilişkisi geçersiz.");
    }

    const invalidSubUnits = await client.query(
      `SELECT su.id FROM sub_units su
       JOIN units u ON u.id = su.unit_id
       WHERE su.name LIKE $1 AND su.company_id <> u.company_id`,
      [`${COMPANY_PREFIX}%`],
    );
    const subUnitCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM sub_units WHERE name LIKE $1",
      [`${COMPANY_PREFIX}%`],
    );
    if (
      Number(subUnitCount.rows[0]?.count) !== 6 ||
      invalidSubUnits.rowCount !== 0
    ) {
      throw new Error("Fixture sub-unit sayısı veya tenant ilişkisi geçersiz.");
    }

    const energySources = await client.query<{
      company_id: number;
      unit_id: number;
      name: string;
    }>(
      `SELECT company_id, unit_id, name
       FROM energy_sources
       WHERE name LIKE $1
       ORDER BY id`,
      [`${COMPANY_PREFIX}%`],
    );
    if (energySources.rowCount !== 7) {
      throw new Error("Fixture energy source sayısı 7 değil.");
    }
    const expectedSourceScopes = new Set([
      `${tenantAId}:${unitA1.id}:${COMPANY_PREFIX} Common Source`,
      `${tenantAId}:${unitA2.id}:${COMPANY_PREFIX} Source A2`,
      `${tenantBId}:${unitB1.id}:${COMPANY_PREFIX} Common Source`,
      `${tenantAId}:${unitA1.id}:${COMPANY_PREFIX} Electricity A1`,
      `${tenantAId}:${unitA1.id}:${COMPANY_PREFIX} Natural Gas A1`,
      `${tenantAId}:${unitA2.id}:${COMPANY_PREFIX} Electricity A2`,
      `${tenantBId}:${unitB1.id}:${COMPANY_PREFIX} Electricity A1`,
    ]);
    for (const source of energySources.rows) {
      if (!expectedSourceScopes.delete(`${source.company_id}:${source.unit_id}:${source.name}`)) {
        throw new Error("Fixture energy source tenant ilişkisi geçersiz.");
      }
    }
    if (expectedSourceScopes.size !== 0) {
      throw new Error("Fixture energy source sözleşmesi eksik.");
    }

    const meterIntegrity = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM meters m
       JOIN units u ON u.id = m.unit_id
       JOIN sub_units su ON su.id = m.sub_unit_id
       JOIN energy_sources es ON es.id = m.energy_source_id
       WHERE m.name LIKE $1
         AND m.company_id = u.company_id
         AND m.company_id = su.company_id
         AND m.company_id = es.company_id
         AND m.unit_id = su.unit_id
         AND m.unit_id = es.unit_id`,
      [`${COMPANY_PREFIX}%`],
    );
    if (Number(meterIntegrity.rows[0]?.count) !== 8) {
      throw new Error("Fixture meter tenant/parent ilişkisi geçersiz.");
    }

    const consumptionIntegrity = await client.query<{ count: string; distinct_periods: string }>(
      `SELECT count(*)::text AS count,
              count(DISTINCT (c.meter_id, c.year, c.month))::text AS distinct_periods
       FROM consumption c
       JOIN meters m ON m.id = c.meter_id
       WHERE m.name LIKE $1 AND c.company_id = m.company_id`,
      [`${COMPANY_PREFIX}%`],
    );
    if (
      Number(consumptionIntegrity.rows[0]?.count) !== 50 ||
      Number(consumptionIntegrity.rows[0]?.distinct_periods) !== 50
    ) {
      throw new Error("Fixture consumption tenant/dönem ilişkisi geçersiz.");
    }

    const numericValues = await client.query<{ kwh: number; tep: number; co2: number }>(
      `SELECT c.kwh, c.tep, c.co2 FROM consumption c
       JOIN meters m ON m.id = c.meter_id
       WHERE m.name = $1 AND c.year = 2025 AND c.month = 1`,
      [`${COMPANY_PREFIX} Shared Meter`],
    );
    if (!numericValues.rows.some(row => row.kwh === 1000 && Math.abs(row.tep - 0.086) < 1e-6 && row.co2 === 400)) {
      throw new Error("Fixture consumption numeric precision sözleşmesi geçersiz.");
    }

    const groupIntegrity = await client.query<{ count: string; tenant_count: string }>(
      `SELECT count(*)::text AS count,
              count(DISTINCT eug.company_id)::text AS tenant_count
       FROM energy_use_groups eug
       JOIN units u ON u.id = eug.unit_id
       JOIN sub_units su ON su.id = eug.sub_unit_id
       JOIN energy_sources es ON es.id = eug.energy_source_id
       WHERE eug.name LIKE $1
         AND eug.company_id = u.company_id
         AND eug.company_id = su.company_id
         AND eug.company_id = es.company_id
         AND eug.unit_id = su.unit_id
         AND eug.unit_id = es.unit_id`,
      [`${COMPANY_PREFIX}%`],
    );
    if (
      Number(groupIntegrity.rows[0]?.count) !== 6 ||
      Number(groupIntegrity.rows[0]?.tenant_count) !== 2
    ) {
      throw new Error("Fixture energy use group tenant/parent ilişkisi geçersiz.");
    }

    const linkedGroup = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM meters m
       JOIN energy_use_groups eug ON eug.id = m.energy_use_group_id
       WHERE m.name = $1 AND eug.name = $2
         AND m.company_id = eug.company_id
         AND m.unit_id = eug.unit_id`,
      [`${COMPANY_PREFIX} Shared Meter`, `${COMPANY_PREFIX} Lighting`],
    );
    if (Number(linkedGroup.rows[0]?.count) !== 1) {
      throw new Error("Fixture energy use group dependency ilişkisi geçersiz.");
    }

    const variableIntegrity = await client.query<{ variable_count: string; value_count: string; tenant_count: string; distinct_periods: string }>(
      `SELECT count(DISTINCT v.id)::text AS variable_count,
              count(vv.id)::text AS value_count,
              count(DISTINCT v.company_id)::text AS tenant_count,
              (count(DISTINCT (vv.variable_id, vv.period_start, vv.period_end, vv.unit_id, vv.sub_unit_id, vv.meter_id))
                FILTER (WHERE vv.id IS NOT NULL))::text AS distinct_periods
       FROM variables v
       LEFT JOIN variable_values vv ON vv.variable_id = v.id AND vv.company_id = v.company_id
       WHERE v.name LIKE $1`,
      [`${COMPANY_PREFIX}%`],
    );
    const variableStats = variableIntegrity.rows[0];
    if (
      Number(variableStats?.variable_count) !== 7 ||
      Number(variableStats?.value_count) !== 69 ||
      Number(variableStats?.tenant_count) !== 2 ||
      Number(variableStats?.distinct_periods) !== 69
    ) {
      throw new Error("Fixture variable tenant/dönem ilişkisi geçersiz.");
    }

    const invalidVariableScopes = await client.query(
      `SELECT vv.id
       FROM variable_values vv
       JOIN variables v ON v.id = vv.variable_id
       LEFT JOIN units u ON u.id = vv.unit_id
       WHERE v.name LIKE $1 AND (
         vv.company_id <> v.company_id OR
         (v.scope_type = 'company' AND vv.unit_id IS NOT NULL) OR
         (v.scope_type = 'unit' AND (vv.unit_id IS NULL OR u.company_id <> vv.company_id))
       )`,
      [`${COMPANY_PREFIX}%`],
    );
    if (invalidVariableScopes.rowCount !== 0) {
      throw new Error("Fixture variable company/unit scope ilişkisi geçersiz.");
    }

    const operatingHoursCatalog = await client.query<{
      company_id: number;
      variable_id: number;
      unit_id: number;
      periods: string[];
    }>(
      `SELECT v.company_id, v.id AS variable_id, vv.unit_id,
              array_agg(vv.period_start ORDER BY vv.period_start) AS periods
       FROM variables v
       JOIN variable_values vv ON vv.variable_id = v.id AND vv.company_id = v.company_id
       WHERE v.name = $1 AND v.scope_type = 'unit'
       GROUP BY v.company_id, v.id, vv.unit_id
       ORDER BY v.company_id, vv.unit_id`,
      [`${COMPANY_PREFIX} Operating Hours`],
    );
    const tenantACatalogRows = operatingHoursCatalog.rows.filter((row) => row.company_id === tenantAId);
    const tenantBCatalogRows = operatingHoursCatalog.rows.filter((row) => row.company_id === tenantBId);
    if (
      operatingHoursCatalog.rowCount !== 3 ||
      tenantACatalogRows.length !== 2 ||
      new Set(tenantACatalogRows.map((row) => row.variable_id)).size !== 1 ||
      tenantACatalogRows.find((row) => row.unit_id === unitA1.id)?.periods.length !== 12 ||
      tenantACatalogRows.find((row) => row.unit_id === unitA1.id)?.periods[0] !== "2025-01-01" ||
      tenantACatalogRows.find((row) => row.unit_id === unitA1.id)?.periods[11] !== "2025-12-01" ||
      tenantACatalogRows.find((row) => row.unit_id === unitA2.id)?.periods.length !== 13 ||
      tenantACatalogRows.find((row) => row.unit_id === unitA2.id)?.periods[0] !== "2025-01-01" ||
      tenantACatalogRows.find((row) => row.unit_id === unitA2.id)?.periods[12] !== "2026-01-01" ||
      tenantBCatalogRows.length !== 1 ||
      tenantBCatalogRows[0]?.unit_id !== unitB1.id ||
      tenantBCatalogRows[0]?.periods.length !== 12 ||
      tenantBCatalogRows[0]?.periods[0] !== "2025-01-01" ||
      tenantBCatalogRows[0]?.periods[11] !== "2025-12-01" ||
      tenantBCatalogRows[0]?.variable_id === tenantACatalogRows[0]?.variable_id
    ) {
      throw new Error("Fixture ortak variable katalog/unit value sözleşmesi geçersiz.");
    }

    const variablePrecision = await client.query<{ value: number }>(
      `SELECT vv.value
       FROM variable_values vv
       JOIN variables v ON v.id = vv.variable_id
       WHERE v.name = $1 AND vv.period_start = '2025-02-01'`,
      [`${COMPANY_PREFIX} Production Quantity`],
    );
    if (!variablePrecision.rows.some((row) => Math.abs(row.value - 150.5) < 1e-6)) {
      throw new Error("Fixture variable numeric precision sözleşmesi geçersiz.");
    }

    const seuIntegrity = await client.query<{
      assessment_count: string;
      item_count: string;
      official_count: string;
      accepted_count: string;
      rejected_count: string;
      monitor_count: string;
      tenant_count: string;
    }>(
      `SELECT count(DISTINCT sa.id)::text AS assessment_count,
              count(sai.id)::text AS item_count,
              count(DISTINCT sa.id) FILTER (WHERE sa.is_official)::text AS official_count,
              count(sai.id) FILTER (WHERE sai.user_decision = 'accepted_as_seu')::text AS accepted_count,
              count(sai.id) FILTER (WHERE sai.user_decision = 'not_seu')::text AS rejected_count,
              count(sai.id) FILTER (WHERE sai.user_decision = 'monitor')::text AS monitor_count,
              count(DISTINCT sa.company_id)::text AS tenant_count
       FROM seu_assessments sa
       LEFT JOIN seu_assessment_items sai ON sai.assessment_id = sa.id
       WHERE sai.name LIKE $1`,
      [`${COMPANY_PREFIX}%`],
    );
    const seuStats = seuIntegrity.rows[0];
    if (
      Number(seuStats?.assessment_count) !== 4 ||
      Number(seuStats?.item_count) !== 6 ||
      Number(seuStats?.official_count) !== 3 ||
      Number(seuStats?.accepted_count) !== 4 ||
      Number(seuStats?.rejected_count) !== 1 ||
      Number(seuStats?.monitor_count) !== 1 ||
      Number(seuStats?.tenant_count) !== 2
    ) {
      throw new Error("Fixture SEU assessment/item sözleşmesi geçersiz.");
    }

    const invalidSeuParents = await client.query(
      `SELECT sai.id
       FROM seu_assessment_items sai
       JOIN seu_assessments sa ON sa.id = sai.assessment_id
       LEFT JOIN units u ON u.id = sai.unit_id
       LEFT JOIN meters m ON m.id = sai.meter_id
       WHERE sai.name LIKE $1 AND (
         sai.unit_id IS DISTINCT FROM sa.unit_id OR
         u.company_id IS DISTINCT FROM sa.company_id OR
         m.company_id IS DISTINCT FROM sa.company_id OR
         m.unit_id IS DISTINCT FROM sa.unit_id
       )`,
      [`${COMPANY_PREFIX}%`],
    );
    if (invalidSeuParents.rowCount !== 0) {
      throw new Error("Fixture SEU assessment item parent ilişkisi geçersiz.");
    }

    const regressionCoverage = await client.query<{ name: string; company_id: number; month_count: string }>(
      `SELECT m.name, m.company_id, count(DISTINCT c.month)::text AS month_count
       FROM meters m
       JOIN consumption c ON c.meter_id = m.id AND c.company_id = m.company_id
       WHERE m.name = ANY($1::text[]) AND c.year = 2025
       GROUP BY m.name, m.company_id
       ORDER BY m.company_id, m.name`,
      [[`${COMPANY_PREFIX} Shared Meter`, `${COMPANY_PREFIX} Gas Meter A1`, `${COMPANY_PREFIX} Meter A2`]],
    );
    if (regressionCoverage.rowCount !== 4 || regressionCoverage.rows.some((row) => Number(row.month_count) !== 12)) {
      throw new Error("Fixture regression consumption coverage sözleşmesi geçersiz.");
    }

    const swotIntegrity = await client.query<{ count: string; tenant_count: string; category_count: string }>(
      `SELECT count(*)::text AS count,
              count(DISTINCT s.company_id)::text AS tenant_count,
              count(DISTINCT s.category) FILTER (WHERE s.company_id = $2 AND s.unit_id = $3)::text AS category_count
       FROM swot_items s
       JOIN units u ON u.id = s.unit_id
       WHERE s.title LIKE $1 AND s.company_id = u.company_id`,
      [`${COMPANY_PREFIX}%`, tenantAId, unitA1.id],
    );
    if (
      Number(swotIntegrity.rows[0]?.count) !== 6 ||
      Number(swotIntegrity.rows[0]?.tenant_count) !== 2 ||
      Number(swotIntegrity.rows[0]?.category_count) !== 4
    ) {
      throw new Error("Fixture SWOT tenant/category contract is invalid.");
    }

    const riskIntegrity = await client.query<{ count: string; tenant_count: string; bad_score_count: string }>(
      `SELECT count(*)::text AS count,
              count(DISTINCT r.company_id)::text AS tenant_count,
              count(*) FILTER (WHERE r.score <> r.probability * r.severity)::text AS bad_score_count
       FROM risks r
       JOIN units u ON u.id = r.unit_id
       WHERE r.title LIKE $1 AND r.company_id = u.company_id`,
      [`${COMPANY_PREFIX}%`],
    );
    if (
      Number(riskIntegrity.rows[0]?.count) !== 7 ||
      Number(riskIntegrity.rows[0]?.tenant_count) !== 2 ||
      Number(riskIntegrity.rows[0]?.bad_score_count) !== 0
    ) {
      throw new Error("Fixture risk tenant/score contract is invalid.");
    }

    const riskNoteIntegrity = await client.query<{ count: string; bad_scope_count: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE rn.company_id <> r.company_id OR rn.user_id IS NULL)::text AS bad_scope_count
       FROM risk_notes rn
       JOIN risks r ON r.id = rn.risk_id
       WHERE rn.content LIKE $1`,
      [`${COMPANY_PREFIX}%`],
    );
    if (
      Number(riskNoteIntegrity.rows[0]?.count) !== 3 ||
      Number(riskNoteIntegrity.rows[0]?.bad_scope_count) !== 0
    ) {
      throw new Error("Fixture risk note parent/tenant contract is invalid.");
    }

    const targetActionVapIntegrity = await client.query<{
      target_count: string; action_count: string; vap_count: string;
      bad_target_parent: string; bad_target_lookup_parent: string; duplicate_target_key: string;
      bad_action_scope: string; bad_vap_scope: string;
    }>(
      `SELECT
         (SELECT count(*) FROM energy_targets WHERE name LIKE $1)::text AS target_count,
         (SELECT count(*) FROM energy_action_plans WHERE title LIKE $1)::text AS action_count,
         (SELECT count(*) FROM vap_projects WHERE project_title LIKE $1)::text AS vap_count,
         (SELECT count(*) FROM energy_targets t
            LEFT JOIN seu_assessment_items i ON i.id = t.seu_assessment_item_id
            LEFT JOIN seu_assessments a ON a.id = i.assessment_id
            LEFT JOIN energy_baselines b ON b.id = t.baseline_id
          WHERE t.name LIKE $1 AND (
            i.id IS NULL OR a.id <> t.seu_assessment_id OR a.company_id <> t.company_id OR a.unit_id <> t.unit_id OR
            a.record_type <> 'unit_official' OR a.is_official IS NOT TRUE OR i.user_decision <> 'accepted_as_seu' OR
            b.id IS NULL OR b.company_id <> t.company_id OR b.unit_id <> t.unit_id OR b.seu_assessment_item_id <> i.id OR
            b.status <> 'active' OR b.is_valid IS NOT TRUE
          ))::text AS bad_target_parent,
         (SELECT count(*) FROM energy_targets t
            LEFT JOIN sub_units su ON su.id = t.sub_unit_id
            LEFT JOIN energy_sources es ON es.id = t.energy_source_id
          WHERE t.name LIKE $1 AND (
            (t.sub_unit_id IS NOT NULL AND (su.id IS NULL OR su.company_id <> t.company_id OR su.unit_id <> t.unit_id)) OR
            (t.energy_source_id IS NOT NULL AND (es.id IS NULL OR es.company_id <> t.company_id OR (es.unit_id IS NOT NULL AND es.unit_id <> t.unit_id)))
          ))::text AS bad_target_lookup_parent,
         (SELECT count(*) FROM (
            SELECT company_id, unit_id, seu_assessment_item_id, target_year
            FROM energy_targets
            WHERE name LIKE $1 AND seu_assessment_item_id IS NOT NULL AND unit_id IS NOT NULL
            GROUP BY company_id, unit_id, seu_assessment_item_id, target_year
            HAVING count(*) > 1
          ) duplicate_keys)::text AS duplicate_target_key,
         (SELECT count(*) FROM energy_action_plans a JOIN energy_targets t ON t.id = a.target_id WHERE a.title LIKE $1 AND a.company_id <> t.company_id)::text AS bad_action_scope,
         (SELECT count(*) FROM vap_projects v JOIN energy_action_plans a ON a.id = v.action_plan_id WHERE v.project_title LIKE $1 AND v.company_id <> a.company_id)::text AS bad_vap_scope`,
      [`${COMPANY_PREFIX}%`],
    );
    const lifecycle = targetActionVapIntegrity.rows[0];
    if (Number(lifecycle?.target_count) !== 5 || Number(lifecycle?.action_count) !== 8 ||
        Number(lifecycle?.vap_count) !== 5 || Number(lifecycle?.bad_target_parent) !== 0 ||
        Number(lifecycle?.bad_target_lookup_parent) !== 0 || Number(lifecycle?.duplicate_target_key) !== 0 ||
        Number(lifecycle?.bad_action_scope) !== 0 ||
        Number(lifecycle?.bad_vap_scope) !== 0) {
      throw new Error("Fixture target/action/VAP tenant-parent contract is invalid.");
    }

    const users = await client.query<{
      username: string;
      company_id: number;
      unit_id: number | null;
      role: string;
      active: boolean;
      password_hash: string;
    }>(
      "SELECT username, company_id, unit_id, role, active, password_hash FROM users WHERE username LIKE $1 ORDER BY username",
      [`${USER_PREFIX}%`],
    );
    if (users.rowCount !== 11) throw new Error("Fixture user sayısı 11 değil.");
    const userByName = new Map(users.rows.map((row) => [row.username, row]));
    const expected = new Map<
      string,
      {
        companyId: number;
        unitId: number | null;
        role: string;
        active: boolean;
      }
    >([
      [
        USERS.standardA1,
        { companyId: tenantAId, unitId: unitA1.id, role: "user", active: true },
      ],
      [
        USERS.standardA2,
        { companyId: tenantAId, unitId: unitA2.id, role: "user", active: true },
      ],
      [
        USERS.admin,
        { companyId: tenantAId, unitId: null, role: "admin", active: true },
      ],
      [
        USERS.kontrolAdmin,
        {
          companyId: tenantAId,
          unitId: null,
          role: "kontrol_admin",
          active: true,
        },
      ],
      [
        USERS.nullUnit,
        { companyId: tenantAId, unitId: null, role: "user", active: true },
      ],
      [
        USERS.inactive,
        {
          companyId: tenantAId,
          unitId: unitA1.id,
          role: "user",
          active: false,
        },
      ],
      [
        USERS.inactiveCompany,
        {
          companyId: tenantCId,
          unitId: null,
          role: "user",
          active: true,
        },
      ],
      [
        USERS.session,
        { companyId: tenantAId, unitId: unitA1.id, role: "user", active: true },
      ],
      [
        USERS.standardB1,
        { companyId: tenantBId, unitId: unitB1.id, role: "user", active: true },
      ],
      [
        USERS.adminB,
        { companyId: tenantBId, unitId: null, role: "admin", active: true },
      ],
      [
        USERS.superadmin,
        {
          companyId: tenantAId,
          unitId: null,
          role: "superadmin",
          active: true,
        },
      ],
    ]);

    for (const [username, wanted] of expected) {
      const actual = userByName.get(username);
      if (
        !actual ||
        actual.company_id !== wanted.companyId ||
        actual.unit_id !== wanted.unitId ||
        actual.role !== wanted.role ||
        actual.active !== wanted.active
      ) {
        throw new Error(`Fixture kullanıcı sözleşmesi geçersiz: ${username}`);
      }
      if (
        !actual.password_hash.startsWith("scrypt$") ||
        !(await verifyPassword(password, actual.password_hash))
      ) {
        throw new Error(`Fixture parola hash sözleşmesi geçersiz: ${username}`);
      }
    }

    const crossTenantUsers = await client.query(
      `SELECT usr.id FROM users usr JOIN units u ON u.id = usr.unit_id
       WHERE usr.username LIKE $1 AND usr.company_id <> u.company_id`,
      [`${USER_PREFIX}%`],
    );
    if (crossTenantUsers.rowCount !== 0) {
      throw new Error("Cross-tenant fixture user ilişkisi bulundu.");
    }
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }

  console.log(
    "[test-fixtures] Salt-okuma doğrulama başarılı: 3 company, 3 unit, 6 sub-unit, 7 energy source, 6 energy use group, 8 meter, 50 consumption, 7 variable, 69 variable value, 4 SEU assessment, 6 SEU assessment item, 3 manual SEU, 5 target, 8 action, 5 VAP, 6 SWOT, 7 risk, 3 risk note, 11 user.",
  );
}

async function main(): Promise<void> {
  assertDisposableEnvironment();
  const mode = process.argv[2];
  if (mode === "--apply") await applyFixtures();
  else if (mode === "--assert") await assertFixtures();
  else throw new Error("Kullanım: test-fixtures.ts --apply | --assert");
}

try {
  await main();
} catch (error) {
  console.error(
    `[test-fixtures] Hata: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
