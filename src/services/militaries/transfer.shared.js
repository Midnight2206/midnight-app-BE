import { HTTP_CODES } from "#src/constants.js";
import { AppError } from "#utils/AppError.js";

const OPEN_ENDED_TRANSFER_YEAR = 9999;

function hasYearRangeOverlap({ leftStart, leftEnd, rightStart, rightEnd }) {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function normalizeTransferEndYear(year) {
  return year ?? OPEN_ENDED_TRANSFER_YEAR;
}

export async function findUnitOrThrow({ tx, unitId, fieldName }) {
  const unit = await tx.unit.findFirst({
    where: {
      id: unitId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!unit) {
    throw new AppError({
      message: `${fieldName} không tồn tại`,
      statusCode: HTTP_CODES.NOT_FOUND,
      errorCode: "UNIT_NOT_FOUND",
    });
  }

  return unit;
}

export async function ensureNoOverlapTransfer({
  tx,
  militaryId,
  typeId = null,
  transferInYear,
  transferOutYear = null,
}) {
  const existedAssignments = await tx.militaryUnit.findMany({
    where: {
      militaryId,
      ...(Number.isInteger(typeId) ? { typeId } : {}),
    },
    select: {
      transferInYear: true,
      transferOutYear: true,
    },
  });

  const leftStart = transferInYear;
  const leftEnd = normalizeTransferEndYear(transferOutYear);

  const conflicted = existedAssignments.find((assignment) =>
    hasYearRangeOverlap({
      leftStart,
      leftEnd,
      rightStart: assignment.transferInYear,
      rightEnd: normalizeTransferEndYear(assignment.transferOutYear),
    }),
  );

  if (conflicted) {
    throw new AppError({
      message: "Khoảng năm điều chuyển bị chồng lấn với lịch sử đơn vị hiện có",
      statusCode: HTTP_CODES.CONFLICT,
      errorCode: "MILITARY_UNIT_ASSIGNMENT_OVERLAP",
    });
  }
}
