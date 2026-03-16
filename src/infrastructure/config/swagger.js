import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Portfolio API",
      version: "1.0.0",
      description: "API documentation for portfolio project",
    },
    servers: [
      {
        url: "http://localhost:3000/api",
      },
    ],
    components: {
      securitySchemes: {
        accessToken: {
          type: "apiKey",
          in: "cookie",
          name: "accessToken",
        },
        refreshToken: {
          type: "apiKey",
          in: "cookie",
          name: "refreshToken",
        },
      },
    },
  },

  apis: ["./src/docs/*.swagger.js"],
};

const swaggerSpec = swaggerJsdoc(options);

export function setupSwagger(app) {
  app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}
