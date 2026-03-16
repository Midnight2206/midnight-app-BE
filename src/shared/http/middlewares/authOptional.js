import authService from "#services/auth.service.js";
import { verifyAccessToken } from "#utils/jwt.js";

export const authOptional = async (req, res, next) => {
  try {
    const token = req.cookies?.accessToken;
    if (!token) return next();

    const payload = verifyAccessToken(token);
    const user = await authService.getCurrentUser(payload.sub);

    if (user) req.user = user;
    next();
  } catch {
    next();
  }
};
