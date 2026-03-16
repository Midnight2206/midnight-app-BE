ALTER TABLE `size_registration_periods`
  ADD COLUMN `unitId` INT NULL;

UPDATE `size_registration_periods` sp
LEFT JOIN `users` u
  ON u.`id` = sp.`createdById`
SET sp.`unitId` = COALESCE(u.`unitId`, 1)
WHERE sp.`unitId` IS NULL;

ALTER TABLE `size_registration_periods`
  MODIFY `unitId` INT NOT NULL;

ALTER TABLE `size_registration_periods`
  DROP INDEX `size_registration_periods_year_key`;

ALTER TABLE `size_registration_periods`
  ADD CONSTRAINT `size_registration_periods_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX `size_registration_periods_year_unitId_key`
  ON `size_registration_periods`(`year`, `unitId`);

CREATE INDEX `size_registration_periods_unitId_year_idx`
  ON `size_registration_periods`(`unitId`, `year`);

DELETE FROM `registration_year_options`
WHERE `year` < 2025 OR `year` > 2030;
