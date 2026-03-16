import {
  listAccounts,
  listAudits,
  listUnits,
} from "#services/accounts/list.service.js";
import {
  createAdminAccount,
  resetPassword,
  updateAccountStatus,
} from "#services/accounts/manage.service.js";

class AccountsService {
  listAccounts = listAccounts;
  listUnits = listUnits;
  listAudits = listAudits;
  createAdminAccount = createAdminAccount;
  updateAccountStatus = updateAccountStatus;
  resetPassword = resetPassword;
}

export default new AccountsService();

