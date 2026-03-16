ALTER TABLE `supply_allocation_subjects`
  ADD COLUMN `unitId` INT NULL AFTER `id`;

ALTER TABLE `supply_allocation_standards`
  ADD COLUMN `unitId` INT NULL AFTER `id`;

UPDATE `supply_allocation_standards` s
SET s.`unitId` = COALESCE(
  (
    SELECT m.`unitId`
    FROM `supply_allocation_issue_logs` l
    JOIN `militaries` m ON m.`id` = l.`militaryId`
    WHERE l.`standardId` = s.`id`
    ORDER BY l.`issuedAt` DESC
    LIMIT 1
  ),
  (SELECT MIN(`id`) FROM `units`)
)
WHERE s.`unitId` IS NULL;

UPDATE `supply_allocation_subjects` subj
SET subj.`unitId` = COALESCE(
  (
    SELECT s.`unitId`
    FROM `supply_allocation_standards` s
    WHERE s.`subjectId` = subj.`id`
    ORDER BY s.`updatedAt` DESC
    LIMIT 1
  ),
  (SELECT MIN(`id`) FROM `units`)
)
WHERE subj.`unitId` IS NULL;

ALTER TABLE `supply_allocation_subjects`
  MODIFY COLUMN `unitId` INT NOT NULL;

ALTER TABLE `supply_allocation_standards`
  MODIFY COLUMN `unitId` INT NOT NULL;

DROP INDEX `supply_allocation_subjects_nameNormalized_key` ON `supply_allocation_subjects`;

CREATE UNIQUE INDEX `supply_allocation_subjects_unitId_nameNormalized_key`
  ON `supply_allocation_subjects`(`unitId`, `nameNormalized`);

CREATE INDEX `supply_allocation_subjects_unitId_deletedAt_idx`
  ON `supply_allocation_subjects`(`unitId`, `deletedAt`);

CREATE INDEX `supply_allocation_standards_unitId_deletedAt_idx`
  ON `supply_allocation_standards`(`unitId`, `deletedAt`);

ALTER TABLE `supply_allocation_subjects`
  ADD CONSTRAINT `supply_allocation_subjects_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `supply_allocation_standards`
  ADD CONSTRAINT `supply_allocation_standards_unitId_fkey`
  FOREIGN KEY (`unitId`) REFERENCES `units`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
