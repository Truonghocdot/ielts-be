SET @column_exists := (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'highlights'
    AND `COLUMN_NAME` = 'meaning_or_note'
);

SET @drop_sql := IF(
  @column_exists > 0,
  'ALTER TABLE `highlights` DROP COLUMN `meaning_or_note`',
  'SELECT 1'
);

PREPARE stmt FROM @drop_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
