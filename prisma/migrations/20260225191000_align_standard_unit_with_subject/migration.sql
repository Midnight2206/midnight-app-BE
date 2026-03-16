UPDATE `supply_allocation_standards` s
JOIN `supply_allocation_subjects` subj ON subj.`id` = s.`subjectId`
SET s.`unitId` = subj.`unitId`
WHERE s.`unitId` <> subj.`unitId`;
