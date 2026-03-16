import express from "express";
import morgan from "morgan";
import cors from "cors";
import cookieParser from "cookie-parser";

import { setupSwagger } from "#src/infrastructure/config/swagger.js";
import { corsOptions } from "#src/infrastructure/config/cors.config.js";
import { notFoundMiddleware } from "#src/shared/http/middlewares/notFound.js";
import { errorMiddleware } from "#src/shared/http/middlewares/handleError.js";
import { responseMiddleware } from "#src/shared/http/middlewares/responseFormat.js";
import { apiRateLimiter } from "#src/shared/http/middlewares/rateLimit.js";
import { authOptional } from "#src/shared/http/middlewares/authOptional.js";
import { securityHeaders } from "#src/shared/http/middlewares/securityHeaders.js";
import { csrfProtection } from "#src/shared/http/middlewares/csrfProtection.js";
import rootRoute from "#src/app/routes/api-root.js";

const app = express();
app.set("trust proxy", true);

/* =======================
   BASE MIDDLEWARE
======================= */

// enable CORS
app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// parse cookie
app.use(cookieParser());

// parse json body (limit 2mb for API payloads; backup upload uses multipart)
app.use(express.json({ limit: "2mb" }));

// baseline security hardening without extra runtime dependencies
app.use(securityHeaders);

// log request (dev)
app.use(morgan("dev"));

/* =======================
   SWAGGER
======================= */
setupSwagger(app);

/* =======================
   RESPONSE FORMAT
======================= */
app.use(responseMiddleware);

/* =======================
   API PIPELINE
   (RẤT QUAN TRỌNG: đúng thứ tự)
======================= */
app.use(
  "/api",
  apiRateLimiter, // chống spam
  authOptional, // đọc token nếu có
  csrfProtection, // chặn cross-site state-changing requests dùng auth cookie
  rootRoute, // controller chạy sau khi pass auth
);

/* =======================
   404 HANDLER
======================= */
app.use(notFoundMiddleware);

/* =======================
   ERROR HANDLER
======================= */
app.use(errorMiddleware);

export default app;
