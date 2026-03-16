INSERT IGNORE INTO `category_warehouse_stocks` (
  `warehouseId`,
  `categoryId`,
  `versionId`,
  `colorId`,
  `quantity`,
  `createdAt`,
  `updatedAt`
)
SELECT
  wc.`warehouseId`,
  cv.`categoryId`,
  cv.`versionId`,
  cv.`colorId`,
  0,
  NOW(3),
  NOW(3)
FROM (
  SELECT DISTINCT `warehouseId`, `categoryId`
  FROM `category_warehouse_stocks`
) wc
JOIN `category_variants` cv
  ON cv.`categoryId` = wc.`categoryId`
JOIN `warehouses` w
  ON w.`id` = wc.`warehouseId`
  AND w.`deletedAt` IS NULL
JOIN `categories` c
  ON c.`id` = cv.`categoryId`
  AND c.`deletedAt` IS NULL
JOIN `versions` v
  ON v.`id` = cv.`versionId`
  AND v.`deletedAt` IS NULL
JOIN `colors` co
  ON co.`id` = cv.`colorId`
  AND co.`deletedAt` IS NULL;
