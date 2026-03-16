ALTER TABLE `militaries`
  ADD COLUMN `gender` ENUM('MALE', 'FEMALE') NOT NULL DEFAULT 'MALE' AFTER `position`,
  ADD COLUMN `type` ENUM('SQ', 'QNCN', 'HSQ-CS') NOT NULL DEFAULT 'HSQ-CS' AFTER `gender`;

CREATE INDEX `militaries_gender_idx` ON `militaries`(`gender`);
CREATE INDEX `militaries_type_idx` ON `militaries`(`type`);
