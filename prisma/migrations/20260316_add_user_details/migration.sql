-- User profile details (separate from auth user record)
-- Idempotent migration for MySQL

SET @has_table := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_details'
);

SET @create_stmt := IF(
  @has_table = 0,
  'CREATE TABLE `user_details` (\
    `user_details_id` INT NOT NULL AUTO_INCREMENT,\
    `user_id` INT NOT NULL,\
    `full_name` VARCHAR(150) NULL,\
    `phone_e164` VARCHAR(32) NULL,\
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),\
    UNIQUE INDEX `user_details_user_id_key` (`user_id`),\
    INDEX `user_details_user_id_idx` (`user_id`),\
    PRIMARY KEY (`user_details_id`)\
  ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
  'SELECT 1;'
);

PREPARE s1 FROM @create_stmt;
EXECUTE s1;
DEALLOCATE PREPARE s1;

-- Add FK if missing
SET @has_fk := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'user_details'
    AND CONSTRAINT_NAME = 'user_details_user_id_fkey'
);

SET @fk_stmt := IF(
  @has_fk = 0,
  'ALTER TABLE `user_details`\
     ADD CONSTRAINT `user_details_user_id_fkey`\
     FOREIGN KEY (`user_id`) REFERENCES `user`(`user_id`)\
     ON DELETE CASCADE ON UPDATE CASCADE;',
  'SELECT 1;'
);

PREPARE s2 FROM @fk_stmt;
EXECUTE s2;
DEALLOCATE PREPARE s2;

