import {
  listPeriods,
  upsertPeriodStatus,
} from "#services/sizeRegistrationWorkflow/period.service.js";
import {
  getMyContext,
  submitMyRequest,
} from "#services/sizeRegistrationWorkflow/user.service.js";
import {
  listRequests,
  reviewRequest,
} from "#services/sizeRegistrationWorkflow/review.service.js";

class SizeRegistrationWorkflowService {
  listPeriods = listPeriods;
  upsertPeriodStatus = upsertPeriodStatus;
  getMyContext = getMyContext;
  submitMyRequest = submitMyRequest;
  listRequests = listRequests;
  reviewRequest = reviewRequest;
}

export default new SizeRegistrationWorkflowService();

