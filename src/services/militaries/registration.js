export {
  getSizeRegistrationTemplate,
  getSizeRegistrationTemplateFileName,
} from "#services/militaries/registration.template.js";

export {
  importSizeRegistrationsByTemplate,
  prepareSizeRegistrationsImportPayload,
  previewSizeRegistrationsImportByTemplate,
} from "#services/militaries/registration.import.js";

export {
  createRegistrationYear,
  getMilitaryRegistrations,
  getRegistrationOptions,
  listRegistrationYears,
  reset,
  updateMilitaryRegistrations,
} from "#services/militaries/registration.operations.js";

export { getRegistrationCategories } from "#services/militaries/registration.shared.js";
