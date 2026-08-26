// import config
import configdata from "../app/config/config.js";
import PgPool from "../app/utils/pgpool.js";
import {seedUser, seedConsoleAccount, seedPerm, seedModule, seedRole, seedPackageTypesAndCategories, seedChargeDeviation} from "./db_seed_util.js";

main();

async function main() {

  // if (process.env.SEED_DB !== "true") {
  //   console.log("SEED_DB is not true. Skipping seeding.");
  //   return;
  // }

    // pgpool config
    let pgDBCfg = configdata.pgdb;

    // create logger - for now, use console.log
    let logger = console;

    let pgPool = new PgPool(pgDBCfg, logger);

    // should we first clear the database?
    let clearDB = process.env.CLEAR_DB === "true";
    if (clearDB) {
      // TODO: implement clearDB
        // await pgPool.clearDB();
    }
    
    // do entire seeding in a transaction. also, we need transaction for deferred constraints
    let [tx, err] = await pgPool.StartTransaction();
    if (err) {
        throw err;
    }
    
    let userid = await seedUser(tx);
    let [accountid, rootfleetid] = await seedConsoleAccount(tx, userid);
    await seedPerm(tx, userid);
    await seedModule(tx, userid);
    await seedRole(tx, accountid, userid);
    await seedPackageTypesAndCategories(tx, userid);
    await seedChargeDeviation(tx);
    let commiterr = await pgPool.TxCommit(tx);
    if (commiterr) {
        throw commiterr;
    }

    await pgPool.End();

    console.log("Seeding completed successfully.");
}
