import sizeRegistrationWorkflowService from "#services/sizeRegistrationWorkflow.service.js";
import { HTTP_CODES } from "#src/constants.js";

class SizeRegistrationWorkflowController {
  listPeriods = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.listPeriods({
      actor: req.user,
    });

    return res.success({
      data: result,
      message: "Get registration periods successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  upsertPeriodStatus = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.upsertPeriodStatus({
      actor: req.user,
      year: Number(req.params.year),
      status: req.body.status,
      note: req.body.note,
    });

    return res.success({
      data: result,
      message: "Update registration period successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getMyContext = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.getMyContext({
      actor: req.user,
      year: req.query.year,
    });

    return res.success({
      data: result,
      message: "Get my registration context successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  submitMyRequest = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.submitMyRequest({
      actor: req.user,
      body: req.body,
    });

    return res.success({
      data: result,
      message: "Submit registration request successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };

  listRequests = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.listRequests({
      actor: req.user,
      year: req.query.year,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });

    return res.success({
      data: result,
      message: "Get registration requests successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  reviewRequest = async (req, res) => {
    const result = await sizeRegistrationWorkflowService.reviewRequest({
      actor: req.user,
      requestId: req.params.requestId,
      action: req.body.action,
      reviewNote: req.body.reviewNote,
    });

    return res.success({
      data: result,
      message: "Review registration request successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
}

export default new SizeRegistrationWorkflowController();
