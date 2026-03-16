import dotenv from "dotenv";

dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH || ".env.test",
});

process.env.NODE_ENV = "test";

