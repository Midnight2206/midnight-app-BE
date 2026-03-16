ALTER TABLE `military_units`
  ADD CONSTRAINT `military_units_transfer_year_range_chk`
  CHECK (`transferOutYear` IS NULL OR `transferOutYear` >= `transferInYear`);

ALTER TABLE `military_units`
  ADD COLUMN `activeFlag` TINYINT
  GENERATED ALWAYS AS (IF(`transferOutYear` IS NULL, 1, NULL)) STORED,
  ADD UNIQUE INDEX `military_units_militaryId_activeFlag_key`(`militaryId`, `activeFlag`);
