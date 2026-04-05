CREATE TABLE IF NOT EXISTS `site_settings` (
  `id` VARCHAR(191) NOT NULL,
  `site_name` VARCHAR(255) NOT NULL DEFAULT 'NextBand',
  `logo_url` TEXT NULL,
  `highlight_present` VARCHAR(20) NOT NULL DEFAULT '#fff7a5',
  `highlight_absent` VARCHAR(20) NOT NULL DEFAULT '#ffd7d7',
  `highlight_inactive` VARCHAR(20) NOT NULL DEFAULT '#e5e7eb',
  `slogan_text` VARCHAR(100) NOT NULL DEFAULT 'Khám phá khóa học IELTS',
  `slogan_font_family` VARCHAR(191) NOT NULL DEFAULT '''Be Vietnam Pro'', sans-serif',
  `slogan_font_weight` VARCHAR(20) NOT NULL DEFAULT 'bold',
  `slogan_desktop_size` INT NOT NULL DEFAULT 56,
  `slogan_mobile_size` INT NOT NULL DEFAULT 34,
  `slogan_color` VARCHAR(20) NOT NULL DEFAULT '#0f172a',
  `slogan_align` VARCHAR(20) NOT NULL DEFAULT 'left',
  `slogan_line_height` DECIMAL(3,2) NOT NULL DEFAULT 1.20,
  `hero_description_text` VARCHAR(300) NOT NULL DEFAULT 'Nâng cao kỹ năng tiếng Anh của bạn với các khóa học được thiết kế bởi đội ngũ giáo viên giàu kinh nghiệm.',
  `hero_description_font_family` VARCHAR(191) NOT NULL DEFAULT '''Be Vietnam Pro'', sans-serif',
  `hero_description_font_weight` VARCHAR(20) NOT NULL DEFAULT 'regular',
  `hero_description_desktop_size` INT NOT NULL DEFAULT 30,
  `hero_description_mobile_size` INT NOT NULL DEFAULT 20,
  `hero_description_color` VARCHAR(20) NOT NULL DEFAULT '#64748b',
  `hero_description_align` VARCHAR(20) NOT NULL DEFAULT 'left',
  `hero_description_line_height` DECIMAL(3,2) NOT NULL DEFAULT 1.60,
  `updated_by` VARCHAR(191) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `site_settings` (`id`)
VALUES ('default')
ON DUPLICATE KEY UPDATE `id` = `id`;
