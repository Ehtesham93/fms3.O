import PgPool from "../pgpool.js";
// 0. Utils...
console.log = (function () {
  let console_log = console.log;
  let timeStart = new Date().getTime();

  return function () {
    let currtime = new Date().getTime();
    let delta = currtime - timeStart;
    let args = [];
    args.push(currtime);
    args.push((delta / 1000).toFixed(3) + ":");
    for (let i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }
    console_log.apply(console, args);
  };
})();

async function sleep(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}
// 1. Start...
let pgcfg = {
  host: "127.0.0.1",
  port: 5432,
  user: "inventoryuser",
  password: "inventoryuserpwd@123",
  database: "inventory",
  schema: "inventoryschema",
};
let pgpoolI = new PgPool(pgcfg);

let ntxdone = 2;
let itemid = 4;

pgpoolI
  .RunTransaction(async (client) => {
    let threadid = "T1";
    console.log("Starting transaction :" + threadid + ": " + new Date());
    let ssoid = "ssoid" + itemid;
    let userid = "userid" + itemid;
    try {
      let insertres = await client.query(
        "insert into inventory.inventoryschema.gsso(ssoid, userid, ssometa) values ($1, $2, $3)",
        [ssoid, userid, { key1: "value1" }]
      );
    } catch (inserterr) {
      console.log(threadid + " inserterr:", inserterr.toString());
      return [null, inserterr];
    }
    // console.log(insertres);
    await sleep(1000);
    let commitres = await pgpoolI.TxCommit(client);
    console.log(threadid + " commitres:", commitres);
    if (commitres != null) {
      return [null, commitres];
    }
    return [{ status: "success", ssoid: ssoid, userid: userid }, null];
  })
  .then((txres) => {
    console.log("Callback at: T1:" + new Date());
    ntxdone -= 1;
    if (txres[1] !== null) {
      console.log("T1", txres[1].toString());
    } else {
      console.log("T1", txres[0]);
    }
  });

await sleep(100);

pgpoolI
  .RunTransaction(async (client) => {
    let threadid = "T2";
    console.log("Starting transaction :" + threadid + ": " + new Date());
    let ssoid = "ssoid" + itemid + 1;
    let userid = "userid" + itemid + 1;
    try {
      let insertres = await client.query(
        "insert into inventory.inventoryschema.gsso(ssoid, userid, ssometa) values ($1, $2, $3)",
        [ssoid, userid, { key1: "value1" }]
      );
    } catch (inserterr) {
      console.log(threadid + " inserterr:", inserterr.toString());
      return [null, inserterr];
    }
    // console.log(insertres);
    await sleep(1000);
    let commitres = await pgpoolI.TxCommit(client);
    console.log(threadid + " commitres:", commitres);
    if (commitres != null) {
      return [null, commitres];
    }
    return [{ status: "success", ssoid: ssoid, userid: userid }, null];
  })
  .then((txres) => {
    console.log("Callback at: T2:" + new Date());
    ntxdone -= 1;
    if (txres[1] !== null) {
      console.log("T2", txres[1].toString());
    } else {
      console.log("T2", txres[0]);
    }
  });

while (ntxdone > 0) {
  await sleep(1000);
}
pgpoolI.Pool.end();
