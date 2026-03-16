-- User addresses: support a single "default" address per user.
-- Idempotent migration for MySQL

SET @has_col := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'address'
    AND COLUMN_NAME = 'is_default'
);

SET @stmt := IF(
  @has_col = 0,
  'ALTER TABLE `address` ADD COLUMN `is_default` BOOLEAN NOT NULL DEFAULT FALSE;',
  'SELECT 1;'
);

PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;

-- Helpful index for quickly finding a user's default address
SET @has_idx := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'address'
    AND INDEX_NAME = 'address_user_id_is_default_idx'
);

SET @idx_stmt := IF(
  @has_idx = 0,
  'CREATE INDEX `address_user_id_is_default_idx` ON `address`(`user_id`, `is_default`);',
  'SELECT 1;'
);

PREPARE s2 FROM @idx_stmt;
EXECUTE s2;
DEALLOCATE PREPARE s2;

