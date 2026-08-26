import swaggerUi from "swagger-ui-express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const swaggerSpec = yaml.load(
  readFileSync(join(__dirname, "./swagger.yaml"), "utf8")
);

const onboardingSwaggerSpec = yaml.load(
  readFileSync(join(__dirname, "./onboarding_swagger.yaml"), "utf8")
);

export const swaggerDocs = (app, config) => {
  // Generate Google reCAPTCHA token
  app.get("/api/v1/api-docs/captcha.html", (req, res) => {
    const captchaHtml = readFileSync(join(__dirname, "./captcha.html"), "utf8");
    const htmlWithSitekey = captchaHtml.replace(
      'data-sitekey="sitekey"',
      `data-sitekey="${config.recaptcha.sitekey}"`
    );
    res.setHeader("Content-Type", "text/html");
    res.send(htmlWithSitekey);
  });

  // Regular API documentation
  app.use(
    "/api/v1/api-docs",
    swaggerUi.serveFiles(swaggerSpec),
    swaggerUi.setup(swaggerSpec)
  );

  app.get("/api/v1/api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(swaggerSpec);
  });

  // Onboarding API documentation
  app.use(
    "/api/v1/onboarding-api-docs",
    swaggerUi.serveFiles(onboardingSwaggerSpec),
    swaggerUi.setup(onboardingSwaggerSpec)
  );

  app.get("/api/v1/onboarding-api-docs.json", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.send(onboardingSwaggerSpec);
  });
};
