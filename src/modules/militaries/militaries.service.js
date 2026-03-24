import { buildMilitarySearchNormalized } from "#utils/searchNormalizer.js";
import { prisma } from "#configs/prisma.config.js";
import {
  createUnit,
  listUnits,
  normalizeUnitName,
  normalizeUnitNameForCompare,
} from "#services/militaries/unit.js";
import {
  createAssignedUnit,
  deleteAssignedUnit,
  listAssignedUnits,
  updateAssignedUnit,
} from "#services/militaries/assigned-unit.js";
import {
  getTemplate,
  getTemplateFileName,
  importByTemplate,
} from "#services/militaries/import-military.js";
import {
  acceptTransferRequest,
  createCutTransferRequest,
  cutMilitaryAssurance,
  listIncomingTransferRequests,
  receiveMilitaryAssurance,
  transferMilitaryAssurance,
  undoCutTransferRequest,
} from "#services/militaries/transfer.js";
import {
  getMilitaryRegistrations,
  getRegistrationCategories,
  getRegistrationOptions,
  createRegistrationYear,
  listRegistrationYears,
  getSizeRegistrationTemplate,
  getSizeRegistrationTemplateFileName,
  importSizeRegistrationsByTemplate,
  prepareSizeRegistrationsImportPayload,
  previewSizeRegistrationsImportByTemplate,
  reset,
  updateMilitaryRegistrations,
} from "#services/militaries/registration.js";
import { createMilitaryListingService } from "#services/militaries/listing.js";
import {
  createMilitaryType,
  deleteMilitaryType,
  listMilitaryTypes,
} from "#services/militaries/type-catalog.js";
import { getPersonalEquipmentLedger } from "#services/militaries/personal-ledger.js";
import {
  getAllocationModeBaselineTemplate,
  importAllocationModeBaselineTemplate,
  updateMilitaryFromPersonalLedger,
} from "#services/militaries/personal-ledger-admin.js";
// Snapshot logic removed; history-only model is used.

const listingService = createMilitaryListingService({
  buildMilitarySearchNormalized,
});

class MilitariesService {
  getTemplateFileName = () => getTemplateFileName();

  getSizeRegistrationTemplateFileName = (year) =>
    getSizeRegistrationTemplateFileName(year);

  normalizeUnitName = (name) => normalizeUnitName(name);

  normalizeUnitNameForCompare = (name) => normalizeUnitNameForCompare(name);

  getRegistrationCategories = async () => getRegistrationCategories();

  listUnits = async ({ actor, scope }) => listUnits({ actor, scope });

  listAssignedUnits = async ({ actor, unitId, status }) =>
    listAssignedUnits({ actor, unitId, status });

  listTypes = async ({ actor }) => listMilitaryTypes({ actor });

  createType = async ({ actor, body }) => createMilitaryType({ actor, body });

  deleteType = async ({ actor, typeId }) => deleteMilitaryType({ actor, typeId });

  createUnit = async ({ actor, body }) => createUnit({ actor, body });

  createAssignedUnit = async ({ actor, body }) => createAssignedUnit({ actor, body });

  updateAssignedUnit = async ({ actor, assignedUnitId, body }) =>
    updateAssignedUnit({ actor, assignedUnitId, body });

  deleteAssignedUnit = async ({ actor, assignedUnitId, unitId }) =>
    deleteAssignedUnit({ actor, assignedUnitId, unitId });

  backfillMissingSearchNormalized = async () =>
    listingService.backfillMissingSearchNormalized();

  hasSearchNormalizedColumn = async () => listingService.hasSearchNormalizedColumn();

  list = async (args) => listingService.list(args);

  getTemplate = async ({ type } = {}) => getTemplate({ type });

  getSizeRegistrationTemplate = async ({
    actor,
    categoryIds,
    includeExisting,
    year,
  }) =>
    getSizeRegistrationTemplate({
      actor,
      categoryIds,
      includeExisting,
      year,
    });

  importByTemplate = async ({ actor, req }) =>
    importByTemplate({
      actor,
      req,
      hasSearchNormalizedColumn: listingService.hasSearchNormalizedColumn,
      buildMilitarySearchNormalized,
    });

  prepareSizeRegistrationsImportPayload = async ({ actor, req }) =>
    prepareSizeRegistrationsImportPayload({ actor, req });

  previewSizeRegistrationsImportByTemplate = async ({ actor, req }) =>
    previewSizeRegistrationsImportByTemplate({ actor, req });

  importSizeRegistrationsByTemplate = async ({ actor, req }) =>
    importSizeRegistrationsByTemplate({ actor, req });

  reset = async ({ actor, unitId }) => reset({ actor, unitId });

  getRegistrationOptions = async ({ actor }) => getRegistrationOptions({ actor });

  listRegistrationYears = async ({ actor }) => listRegistrationYears({ actor });

  createRegistrationYear = async ({ actor, body }) =>
    createRegistrationYear({ actor, body });

  getMilitaryRegistrations = async ({ actor, militaryId, year }) =>
    getMilitaryRegistrations({ actor, militaryId, year });

  getMyPersonalLedger = async ({ actor, query }) =>
    getPersonalEquipmentLedger({ actor, query });

  getMilitaryPersonalLedger = async ({ actor, militaryId, query }) =>
    getPersonalEquipmentLedger({ actor, militaryId, query });

  updateMilitaryFromPersonalLedger = async ({ actor, militaryId, body }) =>
    updateMilitaryFromPersonalLedger({ actor, militaryId, body });

  getAllocationModeBaselineTemplate = async ({ actor, unitId }) =>
    getAllocationModeBaselineTemplate({ actor, unitId });

  importAllocationModeBaselineTemplate = async ({ actor, req }) =>
    importAllocationModeBaselineTemplate({ actor, req });

  updateMilitaryRegistrations = async ({ actor, militaryId, year, registrations }) =>
    updateMilitaryRegistrations({ actor, militaryId, year, registrations });

  cutMilitaryAssurance = async ({ actor, militaryId, transferOutYear, typeId }) =>
    cutMilitaryAssurance({
      actor,
      militaryId,
      transferOutYear,
      typeId,
    });

  receiveMilitaryAssurance = async ({ actor, militaryCode, transferInYear, typeId }) =>
    receiveMilitaryAssurance({
      actor,
      militaryCode,
      transferInYear,
      typeId,
    });

  transferMilitaryAssurance = async ({ actor, body }) =>
    transferMilitaryAssurance({
      actor,
      payload: body,
    });

  createCutTransferRequest = async ({ actor, militaryId, body }) =>
    createCutTransferRequest({
      actor,
      militaryId,
      typeId: body.typeId,
      toUnitId: body.toUnitId,
      transferYear: body.transferYear,
      note: body.note,
    });

  listIncomingTransferRequests = async ({ actor }) =>
    listIncomingTransferRequests({ actor });

  acceptTransferRequest = async ({ actor, requestId, body }) =>
    acceptTransferRequest({
      actor,
      requestId,
      assignedUnitId: body?.assignedUnitId,
    });

  undoCutTransferRequest = async ({ actor, requestId }) =>
    undoCutTransferRequest({
      actor,
      requestId,
    });

}

export default new MilitariesService();
