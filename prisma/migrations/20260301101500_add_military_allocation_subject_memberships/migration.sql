CREATE TABLE `military_allocation_subject_memberships` (
  `id` VARCHAR(191) NOT NULL,
  `militaryId` VARCHAR(191) NOT NULL,
  `subjectId` INT NOT NULL,
  `transferInYear` INT NOT NULL,
  `transferOutYear` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `masm_mil_sub_in_uk`(`militaryId`, `subjectId`, `transferInYear`),
  INDEX `masm_mil_sub_in_out_idx`(`militaryId`, `subjectId`, `transferInYear`, `transferOutYear`),
  INDEX `masm_sub_in_out_idx`(`subjectId`, `transferInYear`, `transferOutYear`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `military_allocation_subject_memberships`
  ADD CONSTRAINT `military_allocation_subject_memberships_militaryId_fkey`
  FOREIGN KEY (`militaryId`) REFERENCES `militaries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `military_allocation_subject_memberships`
  ADD CONSTRAINT `military_allocation_subject_memberships_subjectId_fkey`
  FOREIGN KEY (`subjectId`) REFERENCES `supply_allocation_subjects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO `military_allocation_subject_memberships` (
  `id`,
  `militaryId`,
  `subjectId`,
  `transferInYear`,
  `transferOutYear`,
  `createdAt`,
  `updatedAt`
)
SELECT
  UUID(),
  m.`id`,
  s.`id`,
  COALESCE(
    (
      SELECT mu.`transferInYear`
      FROM `military_units` mu
      WHERE mu.`militaryId` = m.`id`
        AND mu.`unitId` = s.`unitId`
      ORDER BY mu.`transferInYear` DESC
      LIMIT 1
    ),
    m.`initialCommissioningYear`
  ) AS transferInYear,
  (
    SELECT mu.`transferOutYear`
    FROM `military_units` mu
    WHERE mu.`militaryId` = m.`id`
      AND mu.`unitId` = s.`unitId`
    ORDER BY mu.`transferInYear` DESC
    LIMIT 1
  ) AS transferOutYear,
  NOW(3),
  NOW(3)
FROM `supply_allocation_subjects` s
INNER JOIN `militaries` m ON m.`unitId` = s.`unitId`
WHERE s.`deletedAt` IS NULL
  AND m.`deletedAt` IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM `military_allocation_subject_memberships` masm
    WHERE masm.`militaryId` = m.`id`
      AND masm.`subjectId` = s.`id`
      AND masm.`transferInYear` = COALESCE(
        (
          SELECT mu2.`transferInYear`
          FROM `military_units` mu2
          WHERE mu2.`militaryId` = m.`id`
            AND mu2.`unitId` = s.`unitId`
          ORDER BY mu2.`transferInYear` DESC
          LIMIT 1
        ),
        m.`initialCommissioningYear`
      )
  );
