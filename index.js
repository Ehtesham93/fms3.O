import NodeCache from "node-cache";

import APIServer from "./app/apiserver.js";
import config from "./app/config/config.js";
import PgPool from "./app/utils/pgpool.js";
import RedisSvc from "./app/utils/redissvc.js";
import { swaggerDocs } from "./docs/swagger.js";

import HealthHdlr from "./app/handlers/healthhdlr/healthhdlr.js";
import ChargeInsightHdlr from "./app/handlers/modules/chargeinsights/chargeinsightshdlr.js";
import FleetInsightHdlr from "./app/handlers/modules/fleetinsights/fleetinsightshdlr.js";
import FmsAccountHdlr from "./app/handlers/modules/fmsaccount/fmsaccounthdlr.js";
import HistoryDataHdlr from "./app/handlers/modules/historydata/historydatahdlr.js";
import LivetrackingHdlr from "./app/handlers/modules/livetracking/livetrackinghdlr.js";
import TripsInsightHdlr from "./app/handlers/modules/tripsinsights/tripsinsightshdlr.js";
import PlatformHdlr from "./app/handlers/platformhdlr/platformhdlr.js";
import PublicHdlr from "./app/handlers/publichdlr/publichdlr.js";
import UserHdlr from "./app/handlers/userhdlr/userhdlr.js";
import AuthSvc from "./app/services/external/authsvc/authsvc.js";
import EmailSvc from "./app/services/external/emailsvc/emailsvc.js";
import FmsSvc from "./app/services/fmssvc/fmssvc.js";
import HealthSvc from "./app/services/healthsvc/healthsvc.js";
import ChargeInsightSvc from "./app/services/modules/chargeinsights/chargeinsightssvc.js";
import FleetInsightSvc from "./app/services/modules/fleetinsights/fleetinsightssvc.js";
import FmsAccountSvc from "./app/services/modules/fmsaccount/fmsaccountsvc.js";
import HistoryDataSvc from "./app/services/modules/historydata/historydatasvc.js";
import LivetrackingSvc from "./app/services/modules/livetracking/livetrackingsvc.js";
import TripsInsightSvc from "./app/services/modules/tripsinsights/tripsinsightssvc.js";
import PlatformSvc from "./app/services/platformsvc/platformsvc.js";
import UserSvc from "./app/services/usersvc/usersvc.js";
import GeocodeSvc from "./app/services/external/geocodesvc/geocodesvc.js";
import { Logger } from "./lib/nemo3-lib-observability/index.js";

// setup logger
const logger = new Logger({
  environment: process.env.APP_ENV || "LOCAL",
  service: process.env.SERVICE_NAME || "nemo3-api-fms-svc",
  instance: process.env.TASK_ARN || "localhost",
  ip: process.env.TASK_IP || "127.0.0.1",
  loglevel: "info",
  logToConsole: config.logToConsole || false,
  maxSizeBytes: 10 * 1024 * 1024, // 10MB
  maxBackups: 5,
  checkIntervalMs: 2 * 1000,
  autoInstrument: true,
  flushInterval: 60 * 1000,
});

// 0. Config Related...
let apiserverport = config.apiserver.port;

// 1. Services...
let servicelogger = logger;
let pgPoolI = new PgPool(config.pgdb, servicelogger);
let inMemCacheI = new NodeCache(config.inMemCache);
let redisSvc = new RedisSvc(config.redis, servicelogger);

// Make Redis available to services that only receive config
// This is needed for rating prompt Redis + PostgreSQL hybrid flow
config.redisClient = redisSvc;

// Optional alternate path for code that reads config.redis.client
if (!config.redis) {
  config.redis = {};
}
config.redis.client = redisSvc;

let healthSvcI = new HealthSvc();
let authSvcI = new AuthSvc(config, servicelogger);
let userSvcI = new UserSvc(pgPoolI, config, servicelogger);
let platformSvcI = new PlatformSvc(pgPoolI, servicelogger, config);
let fmsSvcI = new FmsSvc(pgPoolI, servicelogger);
let fmsAccountSvcI = new FmsAccountSvc(pgPoolI, servicelogger, config);
let historyDataSvcI = new HistoryDataSvc(pgPoolI, servicelogger, redisSvc);
let livetrackingSvcI = new LivetrackingSvc(pgPoolI, servicelogger, config);
let tripsInsightSvcI = new TripsInsightSvc(pgPoolI, servicelogger);
let chargeInsightSvcI = new ChargeInsightSvc(pgPoolI, servicelogger);
let fleetInsightSvcI = new FleetInsightSvc(pgPoolI, servicelogger);
let geocodeSvcI = new GeocodeSvc(config, servicelogger);
let emailSvcI = new EmailSvc(pgPoolI, config, servicelogger);
emailSvcI.Start();

// 2. Handlers...
let healthHdlrI = new HealthHdlr(healthSvcI);
let platformHdlrI = new PlatformHdlr(
  platformSvcI,
  userSvcI,
  authSvcI,
  fmsAccountSvcI,
  historyDataSvcI,
  inMemCacheI,
  redisSvc,
  servicelogger
);
let userHdlrI = new UserHdlr(
  userSvcI,
  authSvcI,
  fmsSvcI,
  platformSvcI,
  config,
  servicelogger
);
let fmsAccountHdlrI = new FmsAccountHdlr(
  fmsAccountSvcI,
  userSvcI,
  servicelogger,
  platformSvcI,
  inMemCacheI,
  redisSvc,
  config
);
let historyDataHdlrI = new HistoryDataHdlr(
  historyDataSvcI,
  fmsAccountSvcI,
  servicelogger,
  config
);
let livetrackingHdlrI = new LivetrackingHdlr(
  livetrackingSvcI,
  fmsAccountSvcI,
  userSvcI,
  geocodeSvcI,
  redisSvc,
  platformSvcI,
  servicelogger,
  config
);
let tripsInsightHdlrI = new TripsInsightHdlr(
  tripsInsightSvcI,
  fmsAccountSvcI,
  userSvcI,
  servicelogger,
  redisSvc,
  config
);
let chargeInsightHdlrI = new ChargeInsightHdlr(
  chargeInsightSvcI,
  fmsAccountSvcI,
  tripsInsightSvcI,
  userSvcI,
  servicelogger,
  redisSvc,
  config
);
let fleetInsightHdlrI = new FleetInsightHdlr(
  fleetInsightSvcI,
  fmsAccountSvcI,
  userSvcI,
  servicelogger,
  redisSvc,
  config
);

let publicHdlrI = new PublicHdlr(
  userSvcI,
  authSvcI,
  fmsSvcI,
  platformSvcI,
  inMemCacheI,
  config,
  servicelogger
);

// 3. Handler Map...
let publicRoutes = [
  ["/api/v1/fms/health/", healthHdlrI],
  ["/api/v1/fms/public/", publicHdlrI],
];

let apiRoutes = [
  ["/api/v1/platform/", platformHdlrI],
  ["/api/v1/fms/user/", userHdlrI],
  ["/api/v1/fms/account/", fmsAccountHdlrI],
  ["/api/v1/fms/historydata/", historyDataHdlrI],
  ["/api/v1/fms/livetracking/", livetrackingHdlrI],
  ["/api/v1/fms/tripinsights/", tripsInsightHdlrI],
  ["/api/v1/fms/chargeinsights/", chargeInsightHdlrI],
  ["/api/v1/fms/fleetinsights/", fleetInsightHdlrI],
];

// 4. API Server...
let apiserverlogger = logger;
let App = new APIServer(publicRoutes, apiRoutes, config, apiserverlogger);

if (!config.logToConsole) {
  App.app.use(logger.getMetrics().middleware());
  logger.start();
}

// 5. Initialize Swagger documentation
swaggerDocs(App.app, config);

App.Start(apiserverport);

const gracefulShutdown = async () => {
  try {
    redisSvc.disconnect();
    if (!config.logToConsole) {
      logger.info("Graceful shutdown initiated...");
      logger.stop();
      logger.flush();
    }
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", () => gracefulShutdown());
process.on("SIGTERM", () => gracefulShutdown());