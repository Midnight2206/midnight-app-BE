CREATE TABLE IF NOT EXISTS `warehouse_items` (
  `warehouseId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`warehouseId`, `itemId`),
  INDEX `warehouse_items_itemId_idx`(`itemId`),
  CONSTRAINT `warehouse_items_warehouseId_fkey`
    FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `warehouse_items_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `supply_items`(`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

INSERT IGNORE INTO `warehouse_items` (`warehouseId`, `itemId`)
SELECT `warehouseId`, `itemId`
FROM `warehouse_stocks`;
