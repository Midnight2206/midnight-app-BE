import { Router } from "express";
import authController from "#controllers/auth.controller.js";
import { validate } from "#middlewares/validateRequest.js";
import {
  registerSchema,
  loginSchema,
  verifyEmailConfirmSchema,
  verifyEmailTestSchema,
} from "#src/zodSchemas/auth.schema.js";
import { wrapRouter } from "#utils/wrapRouter.js";

import { publicRoute, protectedRoute } from "#middlewares/routerMeta.js";
import { authRateLimiter, refreshRateLimiter } from "#middlewares/rateLimit.js";

const router = wrapRouter(Router());

/* =======================
   PUBLIC
======================= */

router.post(
  "/register",
  authRateLimiter,
  publicRoute,
  validate(registerSchema),
  authController.register,
);

router.post(
  "/login",
  authRateLimiter,
  publicRoute,
  validate(loginSchema),
  authController.login,
);

router.post("/refresh", refreshRateLimiter, publicRoute, authController.refresh);

/* =======================
   AUTHENTICATED
======================= */

router.post("/logout", protectedRoute, authController.logout);

router.get("/me", protectedRoute, authController.getCurrentUser);

router.post(
  "/verify-email/request",
  protectedRoute,
  authController.requestVerifyEmail,
);

router.post(
  "/verify-email/test",
  authRateLimiter,
  protectedRoute,
  validate(verifyEmailTestSchema),
  authController.testVerifyEmail,
);

router.get(
  "/verify-email/confirm",
  authRateLimiter,
  publicRoute,
  validate(verifyEmailConfirmSchema),
  authController.confirmVerifyEmail,
);

export default router;
