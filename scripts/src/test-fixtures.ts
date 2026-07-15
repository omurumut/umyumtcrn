import {
  companiesTable,
  db,
  energySourcesTable,
  pool,
  subUnitsTable,
  unitsTable,
  usersTable,
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

    await tx.insert(subUnitsTable).values([
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
    ]);

    await tx.insert(energySourcesTable).values([
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
    ]);

    await tx.insert(usersTable).values([
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
    ]);
  });

  console.log(
    "[test-fixtures] Fixture oluşturuldu: 3 company, 3 unit, 3 sub-unit, 3 energy source, 11 user.",
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
      Number(subUnitCount.rows[0]?.count) !== 3 ||
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
    if (energySources.rowCount !== 3) {
      throw new Error("Fixture energy source sayısı 3 değil.");
    }
    const expectedSourceScopes = new Set([
      `${tenantAId}:${unitA1.id}:${COMPANY_PREFIX} Common Source`,
      `${tenantAId}:${unitA2.id}:${COMPANY_PREFIX} Source A2`,
      `${tenantBId}:${unitB1.id}:${COMPANY_PREFIX} Common Source`,
    ]);
    for (const source of energySources.rows) {
      if (!expectedSourceScopes.delete(`${source.company_id}:${source.unit_id}:${source.name}`)) {
        throw new Error("Fixture energy source tenant ilişkisi geçersiz.");
      }
    }
    if (expectedSourceScopes.size !== 0) {
      throw new Error("Fixture energy source sözleşmesi eksik.");
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
    "[test-fixtures] Salt-okuma doğrulama başarılı: 3 company, 3 unit, 3 sub-unit, 3 energy source, 11 user.",
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
