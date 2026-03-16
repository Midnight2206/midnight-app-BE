const allowedOrigins = (process.env.ALLOW_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  throw new Error(
    "ALLOW_ORIGIN is required in production. Set at least one allowed origin.",
  );
}
if (!process.env.ALLOW_ORIGIN && process.env.NODE_ENV !== "production") {
  console.warn("ALLOW_ORIGIN is not defined in environment variables");
}

export const corsOptions = {
  origin: (origin, callback) => {
    // Cho phép request không có origin (mobile app, curl, Postman...)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // ✅ Fix: trả error thay vì false để dễ debug
    return callback(new Error(`CORS: Origin "${origin}" không được phép`));
  },

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],

  // ✅ Fix: thêm Cache-Control và Pragma
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control", "Pragma"],

  preflightContinue: false,
  credentials: true,
  optionsSuccessStatus: 200,
};
