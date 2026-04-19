import { FastifyPluginAsync } from "fastify";
import { authenticate, requireRoles } from "../middlewares/auth.middleware.js";

const SETTINGS_ID = "default";

async function ensureDefaultRow(fastify: any) {
  await fastify.prisma.$executeRawUnsafe(
    "INSERT INTO `site_settings` (`id`) VALUES (?) ON DUPLICATE KEY UPDATE `id` = `id`",
    SETTINGS_ID,
  );
}

function normalizeRow(row: any) {
  return {
    ...row,
    logoUrl: row?.logoUrl || "",
    authTagline: row?.authTagline || "Nền tảng học IELTS hiện đại",
    authFeatureOneTitle: row?.authFeatureOneTitle || "Khóa học chất lượng",
    authFeatureOneDescription:
      row?.authFeatureOneDescription ||
      "Hàng trăm bài học từ cơ bản đến nâng cao",
    authFeatureTwoTitle: row?.authFeatureTwoTitle || "Giáo viên uy tín",
    authFeatureTwoDescription:
      row?.authFeatureTwoDescription || "Đội ngũ giáo viên giàu kinh nghiệm",
    sloganLineHeight: Number(row?.sloganLineHeight ?? 1.2),
    heroDescriptionLineHeight: Number(row?.heroDescriptionLineHeight ?? 1.6),
  };
}

const siteSettingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/", async () => {
    await ensureDefaultRow(fastify);
    const rows = await fastify.prisma.$queryRawUnsafe<any[]>(
      "SELECT `id`, `site_name` AS siteName, `logo_url` AS logoUrl, `auth_tagline` AS authTagline, `auth_feature_one_title` AS authFeatureOneTitle, `auth_feature_one_description` AS authFeatureOneDescription, `auth_feature_two_title` AS authFeatureTwoTitle, `auth_feature_two_description` AS authFeatureTwoDescription, `highlight_present` AS highlightPresent, `highlight_absent` AS highlightAbsent, `highlight_inactive` AS highlightInactive, `slogan_text` AS sloganText, `slogan_font_family` AS sloganFontFamily, `slogan_font_weight` AS sloganFontWeight, `slogan_desktop_size` AS sloganDesktopSize, `slogan_mobile_size` AS sloganMobileSize, `slogan_color` AS sloganColor, `slogan_align` AS sloganAlign, `slogan_line_height` AS sloganLineHeight, `hero_description_text` AS heroDescriptionText, `hero_description_font_family` AS heroDescriptionFontFamily, `hero_description_font_weight` AS heroDescriptionFontWeight, `hero_description_desktop_size` AS heroDescriptionDesktopSize, `hero_description_mobile_size` AS heroDescriptionMobileSize, `hero_description_color` AS heroDescriptionColor, `hero_description_align` AS heroDescriptionAlign, `hero_description_line_height` AS heroDescriptionLineHeight, `updated_by` AS updatedBy, `updated_at` AS updatedAt, `created_at` AS createdAt FROM `site_settings` WHERE `id` = ? LIMIT 1",
      SETTINGS_ID,
    );
    return normalizeRow(rows[0] || {});
  });

  fastify.put(
    "/",
    { preHandler: [authenticate, requireRoles("admin")] },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const user = request.user;

      const str = (v: unknown, max: number) =>
        typeof v === "string" ? v.trim().slice(0, max) : undefined;
      const int = (v: unknown, min: number, max: number) => {
        if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
        return Math.min(max, Math.max(min, Math.round(v)));
      };
      const float = (v: unknown, min: number, max: number) => {
        if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
        const clamped = Math.min(max, Math.max(min, v));
        return Number(clamped.toFixed(2));
      };

      const data: Record<string, unknown> = {
        siteName: str(body.siteName, 255),
        logoUrl: str(body.logoUrl, 5000) || null,
        authTagline: str(body.authTagline, 120),
        authFeatureOneTitle: str(body.authFeatureOneTitle, 120),
        authFeatureOneDescription: str(body.authFeatureOneDescription, 160),
        authFeatureTwoTitle: str(body.authFeatureTwoTitle, 120),
        authFeatureTwoDescription: str(body.authFeatureTwoDescription, 160),
        highlightPresent: str(body.highlightPresent, 20),
        highlightAbsent: str(body.highlightAbsent, 20),
        highlightInactive: str(body.highlightInactive, 20),
        sloganText: str(body.sloganText, 100),
        sloganFontFamily: str(body.sloganFontFamily, 191),
        sloganFontWeight: str(body.sloganFontWeight, 20),
        sloganDesktopSize: int(body.sloganDesktopSize, 20, 96),
        sloganMobileSize: int(body.sloganMobileSize, 14, 72),
        sloganColor: str(body.sloganColor, 20),
        sloganAlign: str(body.sloganAlign, 20),
        sloganLineHeight: float(body.sloganLineHeight, 1, 2),
        heroDescriptionText: str(body.heroDescriptionText, 300),
        heroDescriptionFontFamily: str(body.heroDescriptionFontFamily, 191),
        heroDescriptionFontWeight: str(body.heroDescriptionFontWeight, 20),
        heroDescriptionDesktopSize: int(body.heroDescriptionDesktopSize, 14, 56),
        heroDescriptionMobileSize: int(body.heroDescriptionMobileSize, 12, 40),
        heroDescriptionColor: str(body.heroDescriptionColor, 20),
        heroDescriptionAlign: str(body.heroDescriptionAlign, 20),
        heroDescriptionLineHeight: float(body.heroDescriptionLineHeight, 1, 2.2),
        updatedBy: user.id,
      };

      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined),
      );

      if (Object.keys(cleanData).length === 0) {
        return reply.status(400).send({ error: "Không có dữ liệu hợp lệ để cập nhật" });
      }

      await ensureDefaultRow(fastify);

      const columns: Record<string, string> = {
        siteName: "site_name",
        logoUrl: "logo_url",
        authTagline: "auth_tagline",
        authFeatureOneTitle: "auth_feature_one_title",
        authFeatureOneDescription: "auth_feature_one_description",
        authFeatureTwoTitle: "auth_feature_two_title",
        authFeatureTwoDescription: "auth_feature_two_description",
        highlightPresent: "highlight_present",
        highlightAbsent: "highlight_absent",
        highlightInactive: "highlight_inactive",
        sloganText: "slogan_text",
        sloganFontFamily: "slogan_font_family",
        sloganFontWeight: "slogan_font_weight",
        sloganDesktopSize: "slogan_desktop_size",
        sloganMobileSize: "slogan_mobile_size",
        sloganColor: "slogan_color",
        sloganAlign: "slogan_align",
        sloganLineHeight: "slogan_line_height",
        heroDescriptionText: "hero_description_text",
        heroDescriptionFontFamily: "hero_description_font_family",
        heroDescriptionFontWeight: "hero_description_font_weight",
        heroDescriptionDesktopSize: "hero_description_desktop_size",
        heroDescriptionMobileSize: "hero_description_mobile_size",
        heroDescriptionColor: "hero_description_color",
        heroDescriptionAlign: "hero_description_align",
        heroDescriptionLineHeight: "hero_description_line_height",
        updatedBy: "updated_by",
      };

      const entries = Object.entries(cleanData).filter(([key]) => columns[key]);
      const setClause = entries.map(([key]) => `\`${columns[key]}\` = ?`).join(", ");
      const values = entries.map(([, value]) => value);

      await fastify.prisma.$executeRawUnsafe(
        `UPDATE \`site_settings\` SET ${setClause} WHERE \`id\` = ?`,
        ...values,
        SETTINGS_ID,
      );

      const rows = await fastify.prisma.$queryRawUnsafe<any[]>(
        "SELECT `id`, `site_name` AS siteName, `logo_url` AS logoUrl, `auth_tagline` AS authTagline, `auth_feature_one_title` AS authFeatureOneTitle, `auth_feature_one_description` AS authFeatureOneDescription, `auth_feature_two_title` AS authFeatureTwoTitle, `auth_feature_two_description` AS authFeatureTwoDescription, `highlight_present` AS highlightPresent, `highlight_absent` AS highlightAbsent, `highlight_inactive` AS highlightInactive, `slogan_text` AS sloganText, `slogan_font_family` AS sloganFontFamily, `slogan_font_weight` AS sloganFontWeight, `slogan_desktop_size` AS sloganDesktopSize, `slogan_mobile_size` AS sloganMobileSize, `slogan_color` AS sloganColor, `slogan_align` AS sloganAlign, `slogan_line_height` AS sloganLineHeight, `hero_description_text` AS heroDescriptionText, `hero_description_font_family` AS heroDescriptionFontFamily, `hero_description_font_weight` AS heroDescriptionFontWeight, `hero_description_desktop_size` AS heroDescriptionDesktopSize, `hero_description_mobile_size` AS heroDescriptionMobileSize, `hero_description_color` AS heroDescriptionColor, `hero_description_align` AS heroDescriptionAlign, `hero_description_line_height` AS heroDescriptionLineHeight, `updated_by` AS updatedBy, `updated_at` AS updatedAt, `created_at` AS createdAt FROM `site_settings` WHERE `id` = ? LIMIT 1",
        SETTINGS_ID,
      );

      return normalizeRow(rows[0] || {});
    },
  );
};

export default siteSettingsRoutes;
