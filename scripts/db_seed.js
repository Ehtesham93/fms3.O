// import config
import NodeCache from "node-cache";
import config from "../app/config/config.js";
import PgPool from "../app/utils/pgpool.js";
import RedisSvc from "../app/utils/redissvc.js";
import {
  seedUser,
  seedSuperAdmin,
  seedAccountCategory,
  seedConsoleAccount,
  seedModule,
  seedVehicleModelFamily,
  // seedOldVehicleModel,
  seedVehicleModel,
  seedVehicleModelFamilyParam,
  seedPackageTypesAndCategories,
  seedChargeDeviation,
  seedDocuments,
  seedBanners,
  seedSOSContacts,
  seedAllPermId,
  seedPackages,
  seedPackageModule,
  seedParamFamily,
  seedParamFamilyParam,
  seedFleetUserRole,
  seedApiKeys,
  seedCity,
  seedDealer,
  seedFuelType,
  seedColour,
  seedTGUModel,
  seedTGUSwVersion,
} from "./db_seed_util.js";
import PlatformHdlr from "../app/handlers/platformhdlr/platformhdlr.js";
import AuthSvc from "../app/services/external/authsvc/authsvc.js";
import EmailSvc from "../app/services/external/emailsvc/emailsvc.js";
import FmsAccountSvc from "../app/services/modules/fmsaccount/fmsaccountsvc.js";
import HistoryDataSvc from "../app/services/modules/historydata/historydatasvc.js";
import PlatformSvc from "../app/services/platformsvc/platformsvc.js";
import UserSvc from "../app/services/usersvc/usersvc.js";
import { Logger } from "../lib/nemo3-lib-observability/index.js";

main();

async function main() {
  // if (process.env.SEED_DB !== "true") {
  //   console.log("SEED_DB is not true. Skipping seeding.");
  //   return;
  // }

  // setup logger
  const logger = new Logger({
    environment: process.env.APP_ENV || "LOCAL",
    service: "nemo3-api-fms-svc",
    instance: process.env.TASK_ARN || "localhost",
    ip: process.env.TASK_IP || "127.0.0.1",
    loglevel: "info",
    logToConsole: true,
    maxSizeBytes: 10 * 1024 * 1024, // 10MB
    maxBackups: 5,
    checkIntervalMs: 2 * 1000,
    autoInstrument: true,
    flushInterval: 5000,
  });

  // pgpool config
  let pgDBCfg = config.pgdb;

  if (process.env.TEST_SCHEMA) {
    pgDBCfg = { ...pgDBCfg, schema: process.env.TEST_SCHEMA };
    console.log(`Using test schema: ${process.env.TEST_SCHEMA}`);
  }

  // Initialize services like in index.js
  let servicelogger = logger;
  let pgPoolI = new PgPool(config.pgdb, servicelogger);
  let inMemCacheI = new NodeCache(config.inMemCache);
  let redisSvc = new RedisSvc(config.redis, servicelogger);

  let authSvcI = new AuthSvc(config, servicelogger);
  let userSvcI = new UserSvc(pgPoolI, config, servicelogger);
  let platformSvcI = new PlatformSvc(pgPoolI, servicelogger, config);
  let fmsAccountSvcI = new FmsAccountSvc(pgPoolI, servicelogger, config);
  let historyDataSvcI = new HistoryDataSvc(pgPoolI, servicelogger);
  let emailSvcI = new EmailSvc(pgPoolI, config, servicelogger);
  emailSvcI.Start();

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

  // should we first clear the database?
  let clearDB = process.env.CLEAR_DB === "true";
  if (clearDB) {
    // TODO: implement clearDB
    // await pgPool.clearDB();
  }

  // do entire seeding in a transaction. also, we need transaction for deferred constraints
  let [tx, err] = await pgPoolI.StartTransaction();
  if (err) {
    throw err;
  }

  try {
    let userid = await seedUser(tx);
    await seedAllPermId(tx, userid);
    let commiterr = await pgPoolI.TxCommit(tx);
    if (commiterr) {
      throw commiterr;
    }

    // Start a new transaction for the rest
    [tx, err] = await pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    // Now create superadmin and account
    await seedModule(platformHdlrI, userid);
    await seedPackageTypesAndCategories(platformHdlrI, userid);
    await seedPackages(platformHdlrI, userid);
    await seedPackageModule(platformHdlrI, tx, userid);
    await seedAccountCategory(tx, userid);
    await seedConsoleAccount(platformHdlrI, userid);
    await seedSuperAdmin(platformHdlrI, userid);
    await seedFleetUserRole(tx, userid);
    await seedVehicleModelFamily(platformHdlrI, userid);
    // await seedOldVehicleModel(platformHdlrI, userid);
    await seedVehicleModel(platformHdlrI, userid, tx);
    await seedParamFamily(tx, userid);
    await seedParamFamilyParam(tx, userid);
    await seedVehicleModelFamilyParam(tx, userid);
    await seedChargeDeviation(tx);
    await seedDocuments(tx);
    await seedSOSContacts(tx);
    await seedBanners(tx);
    await seedApiKeys(tx);
    await seedCity(tx);
    await seedDealer(tx);
    await seedFuelType(tx);
    await seedColour(tx);
    await seedTGUModel(tx);
    await seedTGUSwVersion(tx);
    commiterr = await pgPoolI.TxCommit(tx);
    if (commiterr) {
      throw commiterr;
    }

    console.log("Seeding completed successfully.");

    // Now you can use the initialized services to create super admin
    // Example: Create a super admin using the platform handler
    if (process.env.CREATE_SUPER_ADMIN === "true") {
      console.log("Creating super admin...");
      // You can access platformHdlrI.pUserHdlrImpl.CreateSuperAdminLogic here
      // or create a mock request object and call the handler method
    }
  } catch (error) {
    console.error("Error during seeding:", error);
    let rollbackerr = await pgPoolI.TxRollback(tx);
    if (rollbackerr) {
      console.error("Error rolling back transaction:", rollbackerr);
    }
    throw error;
  } finally {
    await pgPoolI.End();
  }
}
