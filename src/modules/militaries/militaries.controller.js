import militariesService from "#services/militaries.service.js";
import { HTTP_CODES } from "#src/constants.js";

class MilitariesController {
  list = async (req, res) => {
    const result = await militariesService.list({
      actor: req.user,
      unitId: req.query.unitId,
      type: req.query.type,
      search: req.query.search,
      sortBy: req.query.sortBy,
      sortDir: req.query.sortDir,
      assuranceScope: req.query.assuranceScope,
      year: req.query.year,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.success({
      data: result,
      message: "Get militaries successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  template = async (req, res) => {
    const templateBuffer = await militariesService.getTemplate({
      type: req.query.type,
    });
    const fileName = militariesService.getTemplateFileName();

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );

    return res.status(HTTP_CODES.OK).send(templateBuffer);
  };

  registrationTemplate = async (req, res) => {
    const templateBuffer = await militariesService.getSizeRegistrationTemplate({
      actor: req.user,
      categoryIds: req.query.categoryIds,
      includeExisting: req.query.includeExisting,
      year: req.query.year,
    });
    const fileName = militariesService.getSizeRegistrationTemplateFileName(
      req.query.year,
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`,
    );

    return res.status(HTTP_CODES.OK).send(templateBuffer);
  };

  import = async (req, res) => {
    const result = await militariesService.importByTemplate({
      actor: req.user,
      req,
    });

    return res.success({
      data: result,
      message: "Import military data successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  listUnits = async (req, res) => {
    const result = await militariesService.listUnits({
      actor: req.user,
      scope: req.query.scope,
    });

    return res.success({
      data: result,
      message: "Get military units successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listTypes = async (req, res) => {
    const result = await militariesService.listTypes({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get military types successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createType = async (req, res) => {
    const result = await militariesService.createType({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create military type successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  deleteType = async (req, res) => {
    const result = await militariesService.deleteType({
      actor: req.user,
      typeId: req.params.typeId,
    });

    return res.success({
      data: result,
      message: "Delete military type successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createUnit = async (req, res) => {
    const result = await militariesService.createUnit({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create unit successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  reset = async (req, res) => {
    const result = await militariesService.reset({
      actor: req.user,
      unitId: req.query.unitId,
    });

    return res.success({
      data: result,
      message: "Reset military data successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getRegistrationOptions = async (req, res) => {
    const result = await militariesService.getRegistrationOptions({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get military registration options successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  listRegistrationYears = async (req, res) => {
    const result = await militariesService.listRegistrationYears({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get registration years successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createRegistrationYear = async (req, res) => {
    const result = await militariesService.createRegistrationYear({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create registration year successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  getMilitaryRegistrations = async (req, res) => {
    const result = await militariesService.getMilitaryRegistrations({
      actor: req.user,
      militaryId: req.params.militaryId,
      year: req.query.year,
    });

    return res.success({
      data: result,
      message: "Get military size registrations successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  updateMilitaryRegistrations = async (req, res) => {
    const result = await militariesService.updateMilitaryRegistrations({
      actor: req.user,
      militaryId: req.params.militaryId,
      year: req.query.year,
      registrations: req.body.registrations,
    });

    return res.success({
      data: result,
      message: "Update military size registrations successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  cutMilitaryAssurance = async (req, res) => {
    const result = await militariesService.cutMilitaryAssurance({
      actor: req.user,
      militaryId: req.params.militaryId,
      transferOutYear: req.body.transferOutYear,
    });

    return res.success({
      data: result,
      message: "Cut military assurance successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  receiveMilitaryAssurance = async (req, res) => {
    const result = await militariesService.receiveMilitaryAssurance({
      actor: req.user,
      militaryCode: req.body.militaryCode,
      transferInYear: req.body.transferInYear,
    });

    return res.success({
      data: result,
      message: "Receive military assurance successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  transferMilitaryAssurance = async (req, res) => {
    const result = await militariesService.transferMilitaryAssurance({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Transfer military assurance successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  createCutTransferRequest = async (req, res) => {
    const result = await militariesService.createCutTransferRequest({
      actor: req.user,
      militaryId: req.params.militaryId,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Create cut assurance transfer request successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  listIncomingTransferRequests = async (req, res) => {
    const result = await militariesService.listIncomingTransferRequests({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get incoming transfer requests successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  acceptTransferRequest = async (req, res) => {
    const result = await militariesService.acceptTransferRequest({
      actor: req.user,
      requestId: req.params.requestId,
    });

    return res.success({
      data: result,
      message: "Accept transfer request successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  undoCutTransferRequest = async (req, res) => {
    const result = await militariesService.undoCutTransferRequest({
      actor: req.user,
      requestId: req.params.requestId,
    });

    return res.success({
      data: result,
      message: "Undo cut assurance transfer request successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  importMilitaryRegistrations = async (req, res) => {
    const result = await militariesService.importSizeRegistrationsByTemplate({
      actor: req.user,
      req,
    });

    return res.success({
      data: result,
      message: "Import military size registrations successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  previewImportMilitaryRegistrations = async (req, res) => {
    const result = await militariesService.previewSizeRegistrationsImportByTemplate({
      actor: req.user,
      req,
    });

    return res.success({
      data: result,
      message: "Preview military size registrations import successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new MilitariesController();
