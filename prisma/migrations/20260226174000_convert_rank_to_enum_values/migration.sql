UPDATE `militaries`
SET `rank` = CASE
  WHEN UPPER(TRIM(`rank`)) IN (
    'THIEU_UY','TRUNG_UY','THUONG_UY','DAI_UY',
    'THIEU_TA','TRUNG_TA','THUONG_TA','DAI_TA',
    'THIEU_TUONG','TRUNG_TUONG','THUONG_TUONG','DAI_TUONG',
    'BINH_NHI','BINH_NHAT','HA_SI','TRUNG_SI','THUONG_SI'
  ) THEN UPPER(TRIM(`rank`))
  WHEN LOWER(TRIM(`rank`)) LIKE '%dai%tuong%' OR LOWER(TRIM(`rank`)) LIKE '%đại%tướng%' THEN 'DAI_TUONG'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thuong%tuong%' OR LOWER(TRIM(`rank`)) LIKE '%thượng%tướng%' THEN 'THUONG_TUONG'
  WHEN LOWER(TRIM(`rank`)) LIKE '%trung%tuong%' OR LOWER(TRIM(`rank`)) LIKE '%trung%tướng%' THEN 'TRUNG_TUONG'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thieu%tuong%' OR LOWER(TRIM(`rank`)) LIKE '%thiếu%tướng%' THEN 'THIEU_TUONG'
  WHEN LOWER(TRIM(`rank`)) LIKE '%dai%ta%' OR LOWER(TRIM(`rank`)) LIKE '%đại%tá%' THEN 'DAI_TA'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thuong%ta%' OR LOWER(TRIM(`rank`)) LIKE '%thượng%tá%' THEN 'THUONG_TA'
  WHEN LOWER(TRIM(`rank`)) LIKE '%trung%ta%' OR LOWER(TRIM(`rank`)) LIKE '%trung%tá%' THEN 'TRUNG_TA'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thieu%ta%' OR LOWER(TRIM(`rank`)) LIKE '%thiếu%tá%' THEN 'THIEU_TA'
  WHEN LOWER(TRIM(`rank`)) LIKE '%dai%uy%' OR LOWER(TRIM(`rank`)) LIKE '%đại%úy%' THEN 'DAI_UY'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thuong%uy%' OR LOWER(TRIM(`rank`)) LIKE '%thượng%úy%' THEN 'THUONG_UY'
  WHEN LOWER(TRIM(`rank`)) LIKE '%trung%uy%' OR LOWER(TRIM(`rank`)) LIKE '%trung%úy%' THEN 'TRUNG_UY'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thieu%uy%' OR LOWER(TRIM(`rank`)) LIKE '%thiếu%úy%' THEN 'THIEU_UY'
  WHEN LOWER(TRIM(`rank`)) LIKE '%thuong%si%' OR LOWER(TRIM(`rank`)) LIKE '%thượng%sĩ%' THEN 'THUONG_SI'
  WHEN LOWER(TRIM(`rank`)) LIKE '%trung%si%' OR LOWER(TRIM(`rank`)) LIKE '%trung%sĩ%' THEN 'TRUNG_SI'
  WHEN LOWER(TRIM(`rank`)) LIKE '%ha%si%' OR LOWER(TRIM(`rank`)) LIKE '%hạ%sĩ%' THEN 'HA_SI'
  WHEN LOWER(TRIM(`rank`)) LIKE '%binh%nhat%' OR LOWER(TRIM(`rank`)) LIKE '%binh%nhất%' THEN 'BINH_NHAT'
  WHEN LOWER(TRIM(`rank`)) LIKE '%binh%nhi%' OR LOWER(TRIM(`rank`)) LIKE '%binh%nhì%' THEN 'BINH_NHI'
  ELSE 'BINH_NHI'
END;

ALTER TABLE `militaries`
  MODIFY COLUMN `rank` ENUM(
    'THIEU_UY','TRUNG_UY','THUONG_UY','DAI_UY',
    'THIEU_TA','TRUNG_TA','THUONG_TA','DAI_TA',
    'THIEU_TUONG','TRUNG_TUONG','THUONG_TUONG','DAI_TUONG',
    'BINH_NHI','BINH_NHAT','HA_SI','TRUNG_SI','THUONG_SI'
  ) NOT NULL;

UPDATE `militaries`
SET `rankGroup` = CASE
  WHEN `rank` IN ('THIEU_UY','TRUNG_UY','THUONG_UY','DAI_UY') THEN 'CAP_UY'
  WHEN `rank` IN ('THIEU_TA','TRUNG_TA','THUONG_TA','DAI_TA') THEN 'CAP_TA'
  WHEN `rank` IN ('THIEU_TUONG','TRUNG_TUONG','THUONG_TUONG','DAI_TUONG') THEN 'CAP_TUONG'
  ELSE 'HSQ_BS'
END;
