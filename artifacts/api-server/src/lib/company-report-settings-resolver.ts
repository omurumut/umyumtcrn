import { and, eq } from "drizzle-orm";
import {
  companyReportProfilesTable,
  companyReportSectionSettingsTable,
  companyReportTypeSettingsTable,
  db,
} from "@workspace/db";
import {
  DEFAULT_COMPANY_REPORT_PROFILE,
  REPORT_TYPE_REGISTRY,
  VIRTUAL_DEFAULT_REPORT_PROFILE_VERSION,
  VIRTUAL_DEFAULT_REPORT_TYPE_SETTINGS_VERSION,
  type ReportCoverStyle,
  type ReportLocale,
  type ReportTypeCode,
} from "@workspace/api-zod";
import { resolveCompanyBrand } from "./company-brand-resolver.js";

export function getReportTypeDefinition(reportType: string) {
  return REPORT_TYPE_REGISTRY.find((definition) => definition.code === reportType) ?? null;
}

export function serializeDefaultReportProfile(companyId: number) {
  return {
    companyId,
    ...DEFAULT_COMPANY_REPORT_PROFILE,
    profileVersion: VIRTUAL_DEFAULT_REPORT_PROFILE_VERSION,
    createdAt: null,
    updatedAt: null,
  };
}

export async function resolveEffectiveCompanyReportSettings({
  companyId,
  reportType,
}: {
  companyId: number;
  reportType: ReportTypeCode;
}) {
  const definition = getReportTypeDefinition(reportType);
  if (!definition) throw new Error("Unknown report type");

  const [profileRow] = await db.select()
    .from(companyReportProfilesTable)
    .where(eq(companyReportProfilesTable.companyId, companyId))
    .limit(1);
  const [typeRow] = await db.select()
    .from(companyReportTypeSettingsTable)
    .where(and(
      eq(companyReportTypeSettingsTable.companyId, companyId),
      eq(companyReportTypeSettingsTable.reportType, reportType),
    ))
    .limit(1);
  const sectionRows = await db.select()
    .from(companyReportSectionSettingsTable)
    .where(and(
      eq(companyReportSectionSettingsTable.companyId, companyId),
      eq(companyReportSectionSettingsTable.reportType, reportType),
    ));
  const brand = await resolveCompanyBrand(companyId);

  const profile = profileRow ?? serializeDefaultReportProfile(companyId);
  const sectionByCode = new Map(sectionRows.map((section) => [section.sectionCode, section]));
  const sections = definition.sections
    .map((section) => {
      const override = sectionByCode.get(section.code);
      const canHide = Boolean(section.canHide);
      const canReorder = Boolean(section.canReorder);
      const visible = section.requirement === "required" || !canHide
        ? true
        : override?.isVisible ?? true;
      const displayOrder = !canReorder
        ? section.defaultOrder
        : override?.displayOrder ?? section.defaultOrder;
      return {
        ...section,
        isVisible: visible,
        displayOrder,
        label: override?.labelOverride ?? section.defaultLabel,
        labelOverride: override?.labelOverride ?? null,
      };
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.defaultOrder - b.defaultOrder);

  return {
    registryVersion: "2026-07-18.phase-3b-3a",
    reportType: definition.code,
    reportDefinition: definition,
    profile,
    profileVersion: profile.profileVersion,
    typeSettingsVersion: typeRow?.typeSettingsVersion ?? VIRTUAL_DEFAULT_REPORT_TYPE_SETTINGS_VERSION,
    title: typeRow?.titleOverride ?? profile.defaultTitle ?? definition.defaultTitle,
    subtitle: typeRow?.subtitleOverride ?? profile.defaultSubtitle,
    locale: (typeRow?.localeOverride ?? profile.defaultLocale) as ReportLocale,
    coverStyle: (typeRow?.coverStyleOverride ?? profile.coverStyle) as ReportCoverStyle,
    sections,
    logo: brand.activeLogo && brand.settings?.showLogoInReports !== false
      ? {
          mimeType: brand.activeLogo.mimeType,
          width: brand.activeLogo.width,
          height: brand.activeLogo.height,
          version: brand.activeLogo.version,
        }
      : null,
  };
}
