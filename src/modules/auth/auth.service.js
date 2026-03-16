import {
  login,
  logout,
  refreshToken,
  register,
} from "#services/auth/session.service.js";
import { getCurrentUser } from "#services/auth/profile.service.js";
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
  requestVerifyEmail = requestVerifyEmail;
  confirmVerifyEmail = confirmVerifyEmail;
  testVerifyEmailDelivery = testVerifyEmailDelivery;
}

export default new AuthService();

