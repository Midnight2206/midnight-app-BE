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
  `warehouseId`,
  `categoryId`,
  `versionId`,
  `colorId`,
  0,
  NOW(3),
  NOW(3)
FROM `category_warehouse_items`;

DROP TABLE IF EXISTS `category_warehouse_items`;
