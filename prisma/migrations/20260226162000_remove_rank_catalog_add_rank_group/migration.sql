ALTER TABLE `militaries`
  ADD COLUMN `rankGroup` ENUM('CAP_UY', 'CAP_TA', 'CAP_TUONG', 'HSQ_BS') NOT NULL DEFAULT 'HSQ_BS' AFTER `rank`;

UPDATE `militaries`
SET `rankGroup` = CASE
  WHEN LOWER(TRIM(`rank`)) LIKE '%tuong%'
    OR LOWER(TRIM(`rank`)) LIKE '%tướng%'
    THEN 'CAP_TUONG'
  WHEN LOWER(TRIM(`rank`)) LIKE '%ta%'
    OR LOWER(TRIM(`rank`)) LIKE '%tá%'
    THEN 'CAP_TA'
  WHEN LOWER(TRIM(`rank`)) LIKE '%uy%'
    OR LOWER(TRIM(`rank`)) LIKE '%úy%'
    THEN 'CAP_UY'
  ELSE 'HSQ_BS'
END;

UPDATE `supply_allocation_standard_item_rules`
SET `rankGroup` = 'HSQ_BS'
WHERE `rankGroup` = 'OTHER';

ALTER TABLE `supply_allocation_standard_item_rules`
  MODIFY COLUMN `rankGroup` ENUM('ANY', 'CAP_UY', 'CAP_TA', 'CAP_TUONG', 'HSQ_BS') NOT NULL DEFAULT 'ANY';

ALTER TABLE `militaries` DROP FOREIGN KEY `militaries_rankId_fkey`;
DROP INDEX `militaries_rankId_idx` ON `militaries`;
ALTER TABLE `militaries` DROP COLUMN `rankId`;

DROP TABLE `military_rank_catalogs`;

CREATE INDEX `militaries_rankGroup_idx` ON `militaries`(`rankGroup`);
