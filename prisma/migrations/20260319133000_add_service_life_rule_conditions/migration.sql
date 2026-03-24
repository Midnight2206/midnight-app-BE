ALTER TABLE `supply_allocation_service_life_rules`
  ADD COLUMN `gender` ENUM('ANY', 'MALE', 'FEMALE') NOT NULL DEFAULT 'ANY' AFTER `serviceLifeYears`,
  ADD COLUMN `rankGroup` ENUM('ANY', 'CAP_UY', 'CAP_TA', 'CAP_TUONG', 'HSQ_BS') NOT NULL DEFAULT 'ANY' AFTER `gender`;
