-- AlterTable
ALTER TABLE `classes` ADD COLUMN `end_date` DATETIME(3) NULL,
    ADD COLUMN `start_date` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `courses` MODIFY `price` DECIMAL(10, 2) NULL DEFAULT 0.00;

-- AlterTable
ALTER TABLE `question_groups` ADD COLUMN `audio_url` TEXT NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `date_of_birth` DATETIME(3) NULL,
    ADD COLUMN `gender` VARCHAR(10) NULL,
    ADD COLUMN `parent_name` VARCHAR(255) NULL,
    ADD COLUMN `parent_phone` VARCHAR(20) NULL,
    ADD COLUMN `phone` VARCHAR(20) NULL;
