CREATE TABLE `class_schedules` (
  `id` CHAR(36) NOT NULL,
  `class_id` CHAR(36) NOT NULL,
  `day_of_week` TINYINT UNSIGNED NOT NULL,
  `start_time` VARCHAR(5) NOT NULL,
  `duration_minutes` INT NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `class_schedules_class_id_day_of_week_start_time_key`(`class_id`, `day_of_week`, `start_time`),
  INDEX `class_schedules_class_id_idx`(`class_id`),
  CONSTRAINT `class_schedules_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE `class_attendance` (
  `id` CHAR(36) NOT NULL,
  `class_id` CHAR(36) NOT NULL,
  `student_id` CHAR(36) NOT NULL,
  `session_date` DATE NOT NULL,
  `status` ENUM('present', 'absent', 'late') NOT NULL DEFAULT 'present',
  `note` TEXT NULL,
  `marked_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `class_attendance_class_id_student_id_session_date_key`(`class_id`, `student_id`, `session_date`),
  INDEX `class_attendance_class_id_session_date_idx`(`class_id`, `session_date`),
  INDEX `class_attendance_student_id_idx`(`student_id`),
  CONSTRAINT `class_attendance_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `class_attendance_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `class_attendance_marked_by_fkey` FOREIGN KEY (`marked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);
