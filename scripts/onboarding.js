// import config
import NodeCache from "node-cache";
import configdata from "../app/config/config.js";
import PgPool from "../app/utils/pgpool.js";
import { testInternalOnboardVehicle, testInternalOnboardUserAccount, testOnboardUserAccount, testOnboardVehicle , updateVehicleModelVariant} from "./testOnboardingapis.js";
import HealthHdlr from "../app/handlers/healthhdlr/healthhdlr.js";
import ChargeInsightHdlr from "../app/handlers/modules/chargeinsights/chargeinsightshdlr.js";
import FleetInsightHdlr from "../app/handlers/modules/fleetinsights/fleetinsightshdlr.js";
import FmsAccountHdlr from "../app/handlers/modules/fmsaccount/fmsaccounthdlr.js";
import HistoryDataHdlr from "../app/handlers/modules/historydata/historydatahdlr.js";
import LivetrackingHdlr from "../app/handlers/modules/livetracking/livetrackinghdlr.js";
import TripsInsightHdlr from "../app/handlers/modules/tripsinsights/tripsinsightshdlr.js";
import PlatformHdlr from "../app/handlers/platformhdlr/platformhdlr.js";
import PublicHdlr from "../app/handlers/publichdlr/publichdlr.js";
import UserHdlr from "../app/handlers/userhdlr/userhdlr.js";
import AuthSvc from "../app/services/external/authsvc/authsvc.js";
import FmsSvc from "../app/services/fmssvc/fmssvc.js";
import HealthSvc from "../app/services/healthsvc/healthsvc.js";
import ChargeInsightSvc from "../app/services/modules/chargeinsights/chargeinsightssvc.js";
import FleetInsightSvc from "../app/services/modules/fleetinsights/fleetinsightssvc.js";
import FmsAccountSvc from "../app/services/modules/fmsaccount/fmsaccountsvc.js";
import HistoryDataSvc from "../app/services/modules/historydata/historydatasvc.js";
import LivetrackingSvc from "../app/services/modules/livetracking/livetrackingsvc.js";
import TripsInsightSvc from "../app/services/modules/tripsinsights/tripsinsightssvc.js";
import PlatformSvc from "../app/services/platformsvc/platformsvc.js";
import UserSvc from "../app/services/usersvc/usersvc.js";
import { Logger } from "../lib/nemo3-lib-observability/index.js";

main();

async function main() {
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
  let pgDBCfg = configdata.pgdb;

  // Initialize services like in index.js
  let servicelogger = logger;
  let pgPool = new PgPool(pgDBCfg, servicelogger);
  let inMemCacheI = new NodeCache(configdata.inMemCache);
  let authSvcI = new AuthSvc(configdata, servicelogger);
  let userSvcI = new UserSvc(pgPool, configdata, servicelogger);
  let platformSvcI = new PlatformSvc(pgPool, servicelogger);
  let fmsAccountSvcI = new FmsAccountSvc(pgPool, servicelogger);
  let historyDataSvcI = new HistoryDataSvc(pgPool, servicelogger);

  let platformHdlrI = new PlatformHdlr(
    platformSvcI,
    userSvcI,
    authSvcI,
    fmsAccountSvcI,
    historyDataSvcI,
    inMemCacheI,
    servicelogger
  );


  try {
    let userid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

    // ✅ FIX: Start transaction
    let [tx, err] = await pgPool.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // ✅ FIX: Execute operations within transaction
      await testOnboardVehicle(platformHdlrI, tx, userid);
      await testOnboardUserAccount(platformHdlrI, tx, userid);
      await testInternalOnboardVehicle(platformHdlrI, tx, userid);
      await testInternalOnboardUserAccount(platformHdlrI, tx, userid);
      await updateVehicleModelVariant(tx);

      // ✅ FIX: Commit transaction - don't destructure
      let commitResult = await pgPool.TxCommit(tx);
      if (commitResult && commitResult.error) {
        throw commitResult.error;
      }

      console.log("Seeding completed successfully.");

      // Now you can use the initialized services to create super admin
      if (process.env.CREATE_SUPER_ADMIN === "true") {
        console.log("Creating super admin...");
        // You can access platformHdlrI.pUserHdlrImpl.CreateSuperAdminLogic here
      }
    } catch (operationError) {
      // ✅ FIX: Rollback transaction if operations fail
      console.error("Error during operations:", operationError);

      try {
        // ✅ FIX: Rollback - don't destructure
        let rollbackResult = await pgPool.TxRollback(tx);
        if (rollbackResult && rollbackResult.error) {
          console.error(
            "Error rolling back transaction:",
            rollbackResult.error
          );
        }
      } catch (rollbackError) {
        console.error("Error during rollback:", rollbackError);
      }

      throw operationError;
    }
  } catch (error) {
    console.error("Error during seeding:", error);
    throw error;
  } finally {
    await pgPool.End();
  }
}
