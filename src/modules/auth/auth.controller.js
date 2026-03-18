import authService from "#src/services/auth.service.js";
import { HTTP_CODES } from "#src/constants.js";
import {
  getClientIp,
  getRefreshTokenHashFromRequest,
  getUserAgent,
} from "#services/auth/request-meta.service.js";

class AuthController {
  _getCookieDomain() {
    if (process.env.NODE_ENV !== "production") return undefined;

    const rawFrontendUrl = String(process.env.FRONTEND_APP_URL || "").trim();
    if (rawFrontendUrl) {
      try {
        const { hostname } = new URL(rawFrontendUrl);
        if (hostname) {
          return hostname.startsWith(".") ? hostname : `.${hostname.replace(/^www\./, "")}`;
        }
      } catch {
        // Ignore malformed FRONTEND_APP_URL and fall back to default host-only cookies.
      }
    }

    return undefined;
  }

  _getCookieOptions() {
    return {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // FE and API are cross-origin but still same-site on the same registrable domain.
      // Lax is more mobile-friendly here while remaining stricter than SameSite=None.
      sameSite: "lax",
      path: "/",
      domain: this._getCookieDomain(),
    };
  }

  _setCookies(res, accessToken, refreshToken) {
    const cookieOptions = this._getCookieOptions();

    // set access token cookie
    res.cookie("accessToken", accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 phút
    });

    // set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 ngày
    });
  }

  _clearCookies(res) {
    const cookieOptions = this._getCookieOptions();

    res.clearCookie("accessToken", {
      ...cookieOptions,
    });
    res.clearCookie("refreshToken", {
      ...cookieOptions,
    });

    // Also clear legacy host-only cookies from previous deployments where no domain was set.
    res.clearCookie("accessToken", {
      ...cookieOptions,
      domain: undefined,
    });
    res.clearCookie("refreshToken", {
      ...cookieOptions,
      domain: undefined,
    });
  }
  login = async (req, res) => {
    const { identifier, password } = req.body;
    const userAgent = getUserAgent(req);
    const ip = getClientIp(req);
    const result = await authService.login({
      identifier,
      password,
      userAgent,
      ip,
    });
    const { user, accessToken, refreshToken } = result;
    this._setCookies(res, accessToken, refreshToken);
    return res.success({
      data: { user },
      message: "Login successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
  register = async (req, res) => {
    const { email, password, username, militaryCode } = req.body;
    const userAgent = getUserAgent(req);
    const ip = getClientIp(req);
    const result = await authService.register({
      email,
      password,
      username,
      militaryCode,
      userAgent,
      ip,
    });
    const { user, accessToken, refreshToken } = result;
    this._setCookies(res, accessToken, refreshToken);
    return res.success({
      data: { user },
      message: "User registered successfully",
      statusCode: HTTP_CODES.CREATED,
    });
  };
  getCurrentUser = async (req, res) => {
    const userId = req.user.id;
    const user = await authService.getCurrentUser(userId);
    return res.success({
      data: {
        user,
      },
      message: "Get current user successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
  refresh = async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    const userAgent = getUserAgent(req);
    const ip = getClientIp(req);

    const { accessToken, refreshToken: newRefreshToken } =
      await authService.refreshToken({
        refreshToken,
        userAgent,
        ip,
      });

    this._setCookies(res, accessToken, newRefreshToken);

    return res.success({
      message: "Refresh token successfully",
      statusCode: HTTP_CODES.OK,
    });
  };
  logout = async (req, res) => {
    const refreshToken = req.cookies?.refreshToken;
    await authService.logout(refreshToken);
    this._clearCookies(res);
    return res.success({
      message: "Logout successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getMyProfile = async (req, res) => {
    const profile = await authService.getMyProfile(req.user.id);
    return res.success({
      data: profile,
      message: "Get profile successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  updateMyProfile = async (req, res) => {
    const profile = await authService.updateMyProfile(req.user.id, req.body || {});
    return res.success({
      data: profile,
      message: "Profile updated successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getMySessions = async (req, res) => {
    const sessions = await authService.getMySessions({
      userId: req.user.id,
      currentRefreshTokenHash: getRefreshTokenHashFromRequest(req),
    });
    return res.success({
      data: { sessions },
      message: "Get sessions successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  getPasswordChangeStatus = async (req, res) => {
    const status = await authService.getPasswordChangeStatus(req.user.id);
    return res.success({
      data: status,
      message: "Get password change status successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  cancelPasswordChangeRequest = async (req, res) => {
    const result = await authService.cancelPasswordChangeRequest(req.user.id);
    return res.success({
      data: result,
      message: "Password change request cancelled successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  requestPasswordChange = async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.requestPasswordChange({
      userId: req.user.id,
      currentPassword,
      newPassword,
      requestOrigin: req.get("origin") || "",
      currentRefreshTokenHash: getRefreshTokenHashFromRequest(req),
    });

    return res.success({
      data: result,
      message: "Password change verification email sent",
      statusCode: HTTP_CODES.OK,
    });
  };

  confirmPasswordChange = async (req, res) => {
    const result = await authService.confirmPasswordChange({
      token: req.body?.token,
      currentRefreshTokenHash: getRefreshTokenHashFromRequest(req),
    });

    return res.success({
      data: result,
      message: "Password changed successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  requestVerifyEmail = async (req, res) => {
    const userId = req.user.id;
    const requestOrigin = req.get("origin") || "";

    const result = await authService.requestVerifyEmail({
      userId,
      requestOrigin,
    });

    return res.success({
      data: result,
      message: result.alreadyVerified
        ? "Email already verified"
        : result.queued
          ? "Verify email request queued"
          : "Verify email request throttled",
      statusCode: HTTP_CODES.OK,
    });
  };

  confirmVerifyEmail = async (req, res) => {
    const { token } = req.query;

    const result = await authService.confirmVerifyEmail({
      token,
    });

    return res.success({
      data: result,
      message: result.alreadyVerified
        ? "Email already verified"
        : "Email verified successfully",
      statusCode: HTTP_CODES.OK,
    });
  };

  testVerifyEmail = async (req, res) => {
    const requestOrigin = req.get("origin") || "";
    const { to } = req.body || {};

    const result = await authService.testVerifyEmailDelivery({
      actor: req.user,
      toEmail: to,
      requestOrigin,
    });

    return res.success({
      data: result,
      message: "Test verify email sent",
      statusCode: HTTP_CODES.OK,
    });
  };
}
export default new AuthController();
