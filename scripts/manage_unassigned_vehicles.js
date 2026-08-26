// import config
import NodeCache from "node-cache";
import config from "../app/config/config.js";
import PgPool from "../app/utils/pgpool.js";
import RedisSvc from "../app/utils/redissvc.js";
import PlatformHdlr from "../app/handlers/platformhdlr/platformhdlr.js";
import AuthSvc from "../app/services/external/authsvc/authsvc.js";
import EmailSvc from "../app/services/external/emailsvc/emailsvc.js";
import FmsAccountSvc from "../app/services/modules/fmsaccount/fmsaccountsvc.js";
import HistoryDataSvc from "../app/services/modules/historydata/historydatasvc.js";
import PlatformSvc from "../app/services/platformsvc/platformsvc.js";
import UserSvc from "../app/services/usersvc/usersvc.js";
import { Logger } from "../lib/nemo3-lib-observability/index.js";
import fs from "fs";

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

  // do entire seeding in a transaction. also, we need transaction for deferred constraints
  let [tx, err] = await pgPoolI.StartTransaction();
  if (err) {
    throw err;
  }

  const unassignedVehiclesQuery = `SELECT 
                                          t.taskid,
                                          t.accountid,
                                          t.accountname,
                                          t.vin,
                                          t.licenseplate,
                                          t.userid,
                                          t.original_input
                                      FROM (
                                          SELECT 
                                              rda.accountid as taskid,
                                              a.accountid,
                                              a.accountname,
                                              rda.original_input->>'vin' AS vin,
                                              rda.original_input->>'licenseplate' AS licenseplate,
                                              rda.original_input as original_input,
                                              rda.createdby AS userid,
                                              rda.original_status
                                          FROM reviewdoneaccount rda JOIN account a on rda.accountname = a.accountname
                                      ) t
                                      GROUP BY t.taskid, t.accountid, t.accountname, t.vin, t.licenseplate, t.userid, t.original_input
                                      HAVING 
                                          COUNT(*) FILTER (
                                              WHERE t.original_status = 'USER_ASSIGNMENT_SUCCESS'
                                          ) > 0
                                      AND COUNT(*) FILTER (
                                              WHERE t.original_status = 'VEHICLE_ASSIGNMENT_SUCCESS'
                                          ) = 0
                                      AND NOT EXISTS (
                                              SELECT 1
                                              FROM fleet_vehicle fv
                                              WHERE fv.vinno = t.vin
                                      )
                                  `;

  const unassignedVehicles = await tx.query(unassignedVehiclesQuery);

  console.log(unassignedVehicles.rows);

  let commiterr = await pgPoolI.TxCommit(tx);
    if (commiterr) {
      throw commiterr;
    }

    const logPath = "scripts/unassigned_vehicles.log";
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, "");
    }
    let file = fs.createWriteStream(logPath, { flags: "a" });
  
    for (const vehicle of unassignedVehicles.rows) {
        file.write(`Adding vehicle ${vehicle.vin} to account ${vehicle.accountid} for user ${vehicle.userid}\n`);
        const result = await platformHdlrI.accountHdlr.accountHdlrImpl.AddVehicleToAccountLogic(
            vehicle.accountid,
            {
                vinno: vehicle.vin,
                regno: vehicle.licenseplate,
                isowner: true,
                accvininfo: {},
            },
            vehicle.userid
        );
        if(result){
            await platformHdlrI.pUserHdlr.pUserHdlrImpl.AddAccountToReviewDone(
                vehicle.taskid,
                vehicle.accountname,
                result,
                vehicle.original_input,
                vehicle.userid,
                "Vehicle added successfully",
                {},
                "VEHICLE_ASSIGNMENT_SUCCESS"
              );
        }
        file.write(JSON.stringify(result) + '\n');
    }
  
    file.end();

process.exit(0);
}

main();