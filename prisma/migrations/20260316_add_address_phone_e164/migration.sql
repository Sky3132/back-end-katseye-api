-- Ensure address.phone_e164 exists for checkout phone capture
SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'address'
    AND COLUMN_NAME = 'phone_e164'
);

SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `address` ADD COLUMN `phone_e164` VARCHAR(32) NULL;',
  'SELECT 1;'
);

PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;

