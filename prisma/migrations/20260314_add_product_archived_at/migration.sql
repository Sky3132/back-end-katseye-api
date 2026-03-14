-- Soft-delete / archive support for products
ALTER TABLE `product`
  ADD COLUMN `archived_at` DATETIME NULL;

CREATE INDEX `product_archived_at_idx` ON `product` (`archived_at`);

