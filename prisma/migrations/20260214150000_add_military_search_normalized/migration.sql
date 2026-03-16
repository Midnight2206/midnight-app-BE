ALTER TABLE `militaries`
  ADD COLUMN `searchNormalized` VARCHAR(1024) NOT NULL DEFAULT '';

CREATE INDEX `militaries_searchNormalized_idx`
  ON `militaries`(`searchNormalized`(191));
