import {
  login,
  logout,
  refreshToken,
  register,
} from "#services/auth/session.service.js";
import { getCurrentUser } from "#services/auth/profile.service.js";
import {
  cancelPasswordChangeRequest,
  confirmPasswordChange,
  getMyProfile,
  getMySessions,
  getPasswordChangeStatus,
  requestPasswordChange,
  updateMyProfile,
} from "#services/auth/account.service.js";
import {
  confirmVerifyEmail,
  requestVerifyEmail,
  testVerifyEmailDelivery,
} from "#services/auth/verifyEmail.service.js";

class AuthService {
  login = login;
  register = register;
  getCurrentUser = getCurrentUser;
  refreshToken = refreshToken;
  logout = logout;
  getMyProfile = getMyProfile;
  updateMyProfile = updateMyProfile;
  getMySessions = getMySessions;
  getPasswordChangeStatus = getPasswordChangeStatus;
  cancelPasswordChangeRequest = cancelPasswordChangeRequest;
  requestPasswordChange = requestPasswordChange;
  confirmPasswordChange = confirmPasswordChange;
  requestVerifyEmail = requestVerifyEmail;
  confirmVerifyEmail = confirmVerifyEmail;
  testVerifyEmailDelivery = testVerifyEmailDelivery;
}

export default new AuthService();
