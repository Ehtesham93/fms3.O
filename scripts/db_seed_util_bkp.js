// TODO: temporary, discuss
// Note: this user is disabled while creating
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";

export async function seedUser(pgPoolTx) {
  let userid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  let currtime = new Date();

  let stmt = `insert into users (userid, displayname, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning userid`;
  let res = await pgPoolTx.query(stmt, [
    userid,
    "Seed User",
    {},
    false,
    false,
    false,
    false,
    currtime,
    userid,
    currtime,
    userid,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert user");
  }
  return res.rows[0].userid;
}

export async function seedConsoleAccount(pgPoolTx, createdby) {
  let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  let currtime = new Date();

  let stmt = `insert into account (accountid, accountname, accounttype, accountinfo, isenabled, createdat, createdby, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning accountid`;
  let res = await pgPoolTx.query(stmt, [
    accountid,
    "Console Account",
    "platform",
    {},
    true,
    currtime,
    createdby,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert account");
  }

  // this needs to exist so that fleet_tree.pfleetid can exists
  let rootfleetparentid = "ffffffff-ffff-ffff-ffff-ffffffffffff"; // TODO: this also has to be uuid because every fleetid has to be unique
  stmt = `insert into account_fleet (accountid, fleetid, isroot, createdat, createdby) 
        values ($1, $2, $3, $4, $5) returning fleetid`;
  res = await pgPoolTx.query(stmt, [
    accountid,
    rootfleetparentid,
    false,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert account fleet");
  }

  let rootfleetid = uuidv4();
  stmt = `insert into account_fleet (accountid, fleetid, isroot, createdat, createdby) 
        values ($1, $2, $3, $4, $5) returning fleetid`;
  res = await pgPoolTx.query(stmt, [
    accountid,
    rootfleetid,
    true,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert account fleet");
  }

  // add this fleet to fleet tree
  stmt = `insert into fleet_tree (accountid, pfleetid, fleetid, name, isdeleted, fleetinfo, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8)`;
  res = await pgPoolTx.query(stmt, [
    accountid,
    rootfleetparentid,
    rootfleetid,
    "Home",
    false,
    {},
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert fleet tree");
  }

  return [accountid, rootfleetid];
}

export async function seedPerm(pgPoolTx, createdby) {
  let currtime = new Date();

  // Read permissions from CSV file and insert them
  const csvFilePath = path.join(
    process.cwd(),
    "scripts",
    "consolemgmt_permissions.csv"
  );

  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const permissions = lines[0].includes("permid") ? lines.slice(1) : lines;

    console.log(`Found ${permissions.length} permissions in CSV file`);

    // Insert each permission
    for (const permid of permissions) {
      if (permid.trim()) {
        let stmt = `insert into perm (permid, createdat, createdby) 
              values ($1, $2, $3) ON CONFLICT (permid) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          permid.trim(),
          currtime,
          createdby,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted permission: ${permid.trim()}`);
        } else {
          console.log(`Permission already exists: ${permid.trim()}`);
        }
      }
    }

    console.log(
      `Successfully processed ${permissions.length} permissions from CSV`
    );
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed permissions: ${error.message}`);
  }
}

export async function seedModule(pgPoolTx, createdby) {
  let moduleid = uuidv4();
  let stmt = `insert into module (moduleid, modulename, moduletype, modulecode, moduleinfo, creditspervehicleday, isenabled, createdat, createdby, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;
  let currtime = new Date();
  let moduleinfo = {
    moduleurl:
      "https://dev-nemo.intellicar.io/uimodules/console/remoteEntry.js",
  };
  let res = await pgPoolTx.query(stmt, [
    moduleid,
    "Console",
    "platform",
    "consolemgmt",
    moduleinfo,
    0,
    true,
    currtime,
    createdby,
    currtime,
    createdby,
  ]); // TODO: maybe modules.console? for modulecode
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert module");
  }

  stmt = `insert into module_perm (moduleid, permid, isenabled, modperminfo, createdat, createdby, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8)`;
  res = await pgPoolTx.query(stmt, [
    moduleid,
    "all.all.all",
    true,
    {},
    currtime,
    createdby,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert module perm");
  }

  return moduleid;
}

export async function seedRole(pgPoolTx, accountid, createdby) {
  let roleid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  let stmt = `insert into roles (accountid, roleid, rolename, roletype, isenabled, createdat, createdby, updatedat, updatedby) 
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  let currtime = new Date();
  let res = await pgPoolTx.query(stmt, [
    accountid,
    roleid,
    "Super Admin",
    "platform",
    true,
    currtime,
    createdby,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to insert role");
  }

  // insert into role_perm
  let superadminallpermid = "all.all.all";
  stmt = `
        INSERT INTO role_perm (accountid, roleid, permid, isenabled, createdat, createdby) VALUES ($1, $2, $3, $4, $5, $6)
    `;
  res = await pgPoolTx.query(stmt, [
    accountid,
    roleid,
    superadminallpermid,
    true,
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 1) {
    throw new Error("Failed to create superadmin");
  }
}

export async function seedPackageTypesAndCategories(pgPoolTx, createdby) {
  let currtime = new Date();
  let stmt = `insert into package_type (pkgtype, createdat, createdby) 
        values ($1, $2, $3), ($4, $5, $6)`;
  let res = await pgPoolTx.query(stmt, [
    "standard",
    currtime,
    createdby,
    "custom",
    currtime,
    createdby,
  ]);
  if (res.rowCount !== 2) {
    throw new Error("Failed to insert package types");
  }
}

export async function seedChargeDeviation(pgPoolTx) {
  const deviations = [
    { code: "OVERCHARGED_1", text: "Overcharge" },
    { code: "INCOMPLETECHARGED_1", text: "Incomplete Sessions" },
    { code: "CONST_FASTCHARGE_1", text: "Fastcharging voilation" },
    { code: "WEEKLY_DEVIATION_1", text: "Weekly charge voilation" },
  ];

  for (const deviation of deviations) {
    const stmt = `INSERT INTO charge_deviation (deviation_code, deviation_text) VALUES ($1, $2)`;
    const res = await pgPoolTx.query(stmt, [deviation.code, deviation.text]);
    if (res.rowCount !== 1) {
      throw new Error("Failed to insert charge deviation");
    }
  }
}