ALTER TABLE `site_settings`
  ADD COLUMN `auth_tagline` VARCHAR(120) NOT NULL DEFAULT 'Nền tảng học IELTS hiện đại' AFTER `logo_url`,
  ADD COLUMN `auth_feature_one_title` VARCHAR(120) NOT NULL DEFAULT 'Khóa học chất lượng' AFTER `auth_tagline`,
  ADD COLUMN `auth_feature_one_description` VARCHAR(160) NOT NULL DEFAULT 'Hàng trăm bài học từ cơ bản đến nâng cao' AFTER `auth_feature_one_title`,
  ADD COLUMN `auth_feature_two_title` VARCHAR(120) NOT NULL DEFAULT 'Giáo viên uy tín' AFTER `auth_feature_one_description`,
  ADD COLUMN `auth_feature_two_description` VARCHAR(160) NOT NULL DEFAULT 'Đội ngũ giáo viên giàu kinh nghiệm' AFTER `auth_feature_two_title`;
