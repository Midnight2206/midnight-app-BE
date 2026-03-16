INSERT INTO `military_gender_catalogs` (`code`, `codeNormalized`, `name`, `createdAt`, `updatedAt`)
VALUES
  ('MALE', 'MALE', 'Nam', NOW(3), NOW(3)),
  ('FEMALE', 'FEMALE', 'Nữ', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `deletedAt` = NULL,
  `updatedAt` = NOW(3);

INSERT INTO `military_rank_catalogs` (`code`, `codeNormalized`, `name`, `createdAt`, `updatedAt`)
VALUES
  ('CAP_UY', 'CAP_UY', 'Cấp úy', NOW(3), NOW(3)),
  ('CAP_TA', 'CAP_TA', 'Cấp tá', NOW(3), NOW(3)),
  ('CAP_TUONG', 'CAP_TUONG', 'Cấp tướng', NOW(3), NOW(3)),
  ('OTHER', 'OTHER', 'Khác', NOW(3), NOW(3))
ON DUPLICATE KEY UPDATE
  `code` = VALUES(`code`),
  `name` = VALUES(`name`),
  `deletedAt` = NULL,
  `updatedAt` = NOW(3);

UPDATE `militaries` m
JOIN `military_gender_catalogs` g
  ON g.`codeNormalized` = UPPER(TRIM(m.`gender`))
SET m.`genderId` = g.`id`;

UPDATE `militaries` m
JOIN `military_rank_catalogs` r
  ON r.`codeNormalized` = (
    CASE
      WHEN LOWER(TRIM(m.`rank`)) LIKE '%tuong%'
        OR LOWER(TRIM(m.`rank`)) LIKE '%tướng%'
        THEN 'CAP_TUONG'
      WHEN LOWER(TRIM(m.`rank`)) LIKE '%ta%'
        OR LOWER(TRIM(m.`rank`)) LIKE '%tá%'
        THEN 'CAP_TA'
      WHEN LOWER(TRIM(m.`rank`)) LIKE '%uy%'
        OR LOWER(TRIM(m.`rank`)) LIKE '%úy%'
        THEN 'CAP_UY'
      ELSE 'OTHER'
    END
  )
SET m.`rankId` = r.`id`;

UPDATE `military_rank_catalogs`
SET `deletedAt` = NOW(3)
WHERE `codeNormalized` NOT IN ('CAP_UY', 'CAP_TA', 'CAP_TUONG', 'OTHER')
  AND `deletedAt` IS NULL;

UPDATE `military_gender_catalogs`
SET `deletedAt` = NOW(3)
WHERE `codeNormalized` NOT IN ('MALE', 'FEMALE')
  AND `deletedAt` IS NULL;

ALTER TABLE `militaries`
  MODIFY COLUMN `rankId` INTEGER NOT NULL,
  MODIFY COLUMN `genderId` INTEGER NOT NULL;
