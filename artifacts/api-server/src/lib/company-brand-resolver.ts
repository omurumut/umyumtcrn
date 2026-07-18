import { and, eq } from "drizzle-orm";
import {
  companyAssetsTable,
  companyBrandSettingsTable,
  type CompanyAsset,
  type CompanyBrandSettings,
  db,
} from "@workspace/db";
import { DEFAULT_COMPANY_BRAND_SETTINGS, VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION } from "@workspace/api-zod";
import { companyAssetStorage } from "./company-asset-storage.js";

export type ResolvedCompanyBrand = {
  settings: CompanyBrandSettings | null;
  activeLogo: CompanyAsset | null;
  content: Buffer | null;
};

export async function resolveCompanyBrand(companyId: number): Promise<ResolvedCompanyBrand> {
  const [settings] = await db.select()
    .from(companyBrandSettingsTable)
    .where(eq(companyBrandSettingsTable.companyId, companyId))
    .limit(1);

  const [activeLogo] = await db.select()
    .from(companyAssetsTable)
    .where(and(
      eq(companyAssetsTable.companyId, companyId),
      eq(companyAssetsTable.assetType, "company_logo"),
      eq(companyAssetsTable.status, "active"),
    ))
    .limit(1);

  return {
    settings: settings ?? null,
    activeLogo: activeLogo ?? null,
    content: activeLogo ? await companyAssetStorage.get(activeLogo.storageKey) : null,
  };
}

export function serializeBrandDefaults(companyId: number) {
  return {
    companyId,
    ...DEFAULT_COMPANY_BRAND_SETTINGS,
    brandSettingsVersion: VIRTUAL_DEFAULT_BRAND_SETTINGS_VERSION,
    createdAt: null,
    updatedAt: null,
  };
}
