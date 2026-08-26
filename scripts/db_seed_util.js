// TODO: temporary, discuss
// Note: this user is disabled while creating
import fs from "fs";
import path from "path";
import config from "../app/config/config.js";

function withCdnBase(url) {
  if (!url) return url;
  let pathOnly = url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const thirdSlashIndex = url.indexOf('/', url.indexOf('/', url.indexOf('/') + 1) + 1);
    if (thirdSlashIndex !== -1) {
      pathOnly = url.substring(thirdSlashIndex + 1);
    } else {
      pathOnly = '';
    }
  }
  
  pathOnly = pathOnly.replace(/^\//, '');
  
  const cdnBase = config.CDN_BASE_URL.replace(/\/$/, '');
  return pathOnly ? `${cdnBase}/${pathOnly}` : cdnBase;
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      // End of field
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  // Add the last field
  result.push(current);

  return result;
}

async function getPackageAndModuleId(pgPoolTx, pkgname, modulecode) {
  try {
    let stmt = `SELECT pkgid FROM package WHERE pkgname = $1`;
    let res = await pgPoolTx.query(stmt, [pkgname]);
    if (res.rowCount === 0) {
      throw new Error(`Package ${pkgname} not found`);
    }
    let pkgid = res.rows[0].pkgid;
    stmt = `SELECT moduleid FROM module WHERE modulecode = $1`;
    res = await pgPoolTx.query(stmt, [modulecode]);
    if (res.rowCount === 0) {
      throw new Error(`Module ${modulecode} not found`);
    }
    let moduleid = res.rows[0].moduleid;
    return { pkgid, moduleid };
  } catch (error) {
    console.error(`Error getting package and module id: ${error.message}`);
    throw new Error(`Failed to get package and module id: ${error.message}`);
  }
}

export async function seedUser(pgPoolTx) {
  let userid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  let currtime = new Date();

  // First check if user already exists
  let checkStmt = `SELECT userid FROM users WHERE userid = $1`;
  let checkRes = await pgPoolTx.query(checkStmt, [userid]);

  if (checkRes.rowCount === 0) {
    // User doesn't exist, create it
    let stmt = `insert into users (userid, displayname, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby, acceptedterms) 
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning userid`;
    let res = await pgPoolTx.query(stmt, [
      userid,
      "Seed User",
      {},
      true, // Enable the onboarding user
      false,
      true, // Mark email as verified
      false,
      currtime,
      userid,
      currtime,
      userid,
      {},
    ]);

    if (res.rowCount !== 1) {
      throw new Error("Failed to insert user");
    }

    console.log(`Created seed user with userid: ${res.rows[0].userid}`);
  } else {
    // User already exists
    userid = checkRes.rows[0].userid;
    console.log(`Seed user already exists with userid: ${userid}`);
  }

  return userid;
}

export async function seedSuperAdmin(platformHdlrI, userid) {
  try {
    const superadmin =
      await platformHdlrI.pUserHdlr.pUserHdlrImpl.CreateSuperAdminLogic(
        userid,
        "onboarding@nemo3.com",
        "69f9f7c745883a32502dc7d9d67b16aaa09ea9d0b19de202555cf8e1b42be693"
      );
    console.log("Superadmin created:", superadmin);
  } catch (error) {
    console.error(`Error creating superadmin: ${error.message}`);
    throw new Error(`Failed to seed superadmin: ${error.message}`);
  }
}

export async function seedFleetUserRole(pgPoolTx, createdby) {
  try {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let fleetid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let userid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let roleid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let currtime = new Date();
    let stmt = `INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (accountid, fleetid, userid, roleid) DO NOTHING`;
    let res = await pgPoolTx.query(stmt, [accountid, fleetid, userid, roleid, currtime, createdby]);
    if (res.rowCount === 1) {
      console.log(
        `Inserted fleet user role: ${accountid}, ${fleetid}, ${userid}, ${roleid}, ${currtime}, ${createdby}`
      );
    } else {
      console.log(
        `Fleet user role already exists: ${accountid}, ${fleetid}, ${userid}, ${roleid}, ${currtime}, ${createdby}`
      );
    }
  } catch (error) {
    console.error(`Error seeding fleet user role: ${error.message}`);
    throw new Error(`Failed to seed fleet user role: ${error.message}`);
  }
}

export async function seedPackages(platformHdlrI, createdby) {
  const csvFilePath = path.join(
    process.cwd(),
    // // "scripts",
    "seed_csv_files",
    "package.csv"
  );
  console.log(`Reading packages from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const dataLines = lines[0].includes("pkgid") ? lines.slice(1) : lines;

    for (const line of dataLines) {
      const columns = parseCSVLine(line);

      if (columns.length < 4) {
        console.log(`Skipping invalid line: ${line}`);
        continue;
      }

      const pkgname = columns[1].trim();
      const pkgtype = columns[2].trim();
      const pkginfoStr = columns[3].trim();
      const isenabled = columns[4].trim();

      // Parse the JSON info
      let pkginfo = {};
      if (pkginfoStr && pkginfoStr !== "[object Object]") {
        try {
          // Remove outer quotes if present and unescape double quotes
          let jsonStr = pkginfoStr;
          if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
            jsonStr = jsonStr.slice(1, -1);
          }
          // Unescape double quotes
          jsonStr = jsonStr.replace(/""/g, '"');

          pkginfo = JSON.parse(jsonStr);
        } catch (e) {
          console.log(`Failed to parse JSON for ${pkgname}: ${e.message}`);
          pkginfo = {};
        }
      }

      if (pkgname) {
        let result =
          await platformHdlrI.packageHdlr.packageHdlrImpl.CreatePkgLogic(
            pkgname,
            pkgtype,
            pkginfo,
            isenabled,
            createdby
          );
        console.log(`Package created:`, result);
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed packages: ${error.message}`);
  }
}

export async function seedPackageModule(platformHdlrI, pgPoolTx, createdby) {
  const csvFilePath = path.join(
    process.cwd(),
    // // "scripts",
    "seed_csv_files",
    "package_module_mapping.json"
  );
  console.log(`Reading package modules from ${csvFilePath}`);
  try {
    // Check if JSON file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`JSON file not found at ${csvFilePath}`);
    }
    const jsonContent = fs.readFileSync(csvFilePath, "utf8");
    const packageModules = JSON.parse(jsonContent);
    console.log(`Found ${packageModules.length} package modules in JSON file`);
    for (const packageModule of packageModules) {
      const pkgname = packageModule.pkgname;
      const modulecode = packageModule.modulecode;
      if (pkgname && modulecode) {
        for (const module of modulecode) {
          const { pkgid, moduleid } = await getPackageAndModuleId(
            pgPoolTx,
            pkgname,
            module
          );
          let result =
            await platformHdlrI.packageHdlr.packageHdlrImpl.UpdatePkgModulesLogic(
              pkgid,
              [moduleid],
              [],
              createdby
            );
          console.log(`Package module added:`, result);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed package modules: ${error.message}`);
  }
}

export async function seedAllPermId(pgPoolTx, createdby) {
  try {
    let currtime = new Date();
    let stmt = `insert into perm (permid, createdat, createdby) 
          values ($1, $2, $3) ON CONFLICT (permid) DO NOTHING`;
    let res = await pgPoolTx.query(stmt, ["all.all.all", currtime, createdby]);
    if (res.rowCount === 1) {
      console.log(`Inserted permission: all.all.all`);
    } else {
      console.log(`Permission already exists: all.all.all`);
    }
    stmt = `insert into perm (permid, createdat, createdby) 
          values ($1, $2, $3) ON CONFLICT (permid) DO NOTHING`;
    res = await pgPoolTx.query(stmt, ["all.all.view", currtime, createdby]);
    if (res.rowCount === 1) {
      console.log(`Inserted permission: all.all.view`);
    } else {
      console.log(`Permission already exists: all.all.view`);
    }
  } catch (error) {
    console.error(`Error creating permission: ${error.message}`);
    throw new Error(`Failed to seed permission: ${error.message}`);
  }
}

export async function seedAccountCategory(pgPoolTx, createdby) {
  try {
    let currtime = new Date();
    let accountcategories = [
      { categorycode: "individual", categoryname: "Individual", ischargeable: false },
      { categorycode: "corporate", categoryname: "Corporate", ischargeable: true },
      { categorycode: "aggregator", categoryname: "Aggregator", ischargeable: true },
      { categorycode: "financier", categoryname: "Financier", ischargeable: true },
      { categorycode: "console", categoryname: "Console", ischargeable: false },
    ];
    for (const accountcategory of accountcategories) {
      let stmt = `insert into accountcategory (categorycode, categoryname, ischargeable, updatedat, updatedby) values ($1, $2, $3, $4, $5) ON CONFLICT (categorycode) DO NOTHING`;
      let res = await pgPoolTx.query(stmt, [accountcategory.categorycode, accountcategory.categoryname, accountcategory.ischargeable, currtime, createdby]);
      if (res.rowCount === 1) {
        console.log(`Inserted account category: ${accountcategory.categorycode}`);
      }
    }
  } catch (error) {
    console.error(`Error creating account category: ${error.message}`);
    throw new Error(`Failed to seed account category: ${error.message}`);
  }
}

export async function seedConsoleAccount(platformHdlrI, createdby) {
  try {
    let existingAccount = null;
    try {
      existingAccount =
        await platformHdlrI.accountHdlr.accountHdlrImpl.GetAccountOverviewLogic(
          "ffffffff-ffff-ffff-ffff-ffffffffffff"
        );
      console.log("Console account already exists, skipping creation");
      return;
    } catch (error) {
      // Account doesn't exist, which is what we want
      console.log("Console account doesn't exist, creating new one...");
    }
    const account =
      await platformHdlrI.accountHdlr.accountHdlrImpl.CreateAccountLogic(
        "Platform Account",
        {},
        true,
        createdby,
        "0000000000",
        "ffffffff-ffff-ffff-ffff-ffffffffffff",
        "console"
      );
    console.log("Account created:", account);
  } catch (error) {
    console.error(`Error creating account: ${error.message}`);
    throw new Error(`Failed to seed account: ${error.message}`);
  }
}

export async function seedModule(platformHdlrI, createdby) {
  try {
    // Read modules from CSV file and insert them
    const jsonFilePath = path.join(
      process.cwd(),
      // "scripts",
      "seed_csv_files",
      "module_data_with_permissions.json"
    );
    console.log(`Reading modules from ${jsonFilePath}`);

    // Check if JSON file exists
    if (!fs.existsSync(jsonFilePath)) {
      throw new Error(`JSON file not found at ${jsonFilePath}`);
    }

    // Read JSON file
    const jsonContent = fs.readFileSync(jsonFilePath, "utf8");
    const replacedString = jsonContent
      .replace(/\{\{BASE_URL\}\}/g, config.seedConfig.BASE_URL)
      .replace(/\{\{PORT\}\}/g, config.seedConfig.PORT);
    const modules = JSON.parse(replacedString);

    console.log(`Found ${modules.length} modules in JSON file`);

    // Insert each module
    // Insert each module
    for (const module of modules) {
      const modulename = module.modulename;
      const moduletype = module.moduletype;
      const modulecode = module.modulecode;
      const moduleinfo = module.moduleinfo;
      const isenabled = module.isenabled;
      const priority = module.priority;
      const permissions = module.perm || [];

      let result =
        await platformHdlrI.moduleHdlr.moduleHdlrImpl.CreateModuleLogic(
          modulename,
          moduletype,
          modulecode,
          0.5,
          createdby
        );
      let moduleid = result.moduleid;
      // Then update it with additional fields from CSV
      const updateFields = {};

      // Add moduleinfo if it exists
      if (moduleinfo && Object.keys(moduleinfo).length > 0) {
        updateFields.moduleinfo = moduleinfo;
      }

      // Add other fields
      if (isenabled !== undefined) {
        updateFields.isenabled = isenabled;
      }

      if (priority !== undefined) {
        updateFields.priority = priority;
      }

      // Update the module with additional fields
      if (Object.keys(updateFields).length > 0) {
        let updateResult =
          await platformHdlrI.moduleHdlr.moduleHdlrImpl.UpdateModuleLogic(
            moduleid,
            updateFields,
            createdby
          );
        console.log(`Module updated: ${updateResult.moduleid}`);
      }
      if (permissions && permissions.length > 0) {
        const permResult =
          await platformHdlrI.moduleHdlr.moduleHdlrImpl.AddModulePermsLogic(
            moduleid,
            permissions,
            createdby
          );
        console.log(
          `Module permissions added: ${permResult} for module: ${moduleid}`
        );
      }

      console.log(`Module created: ${moduleid}`);
    }
  } catch (error) {
    console.error(`Error creating module: ${error.message}`);
    throw new Error(`Failed to seed module: ${error.message}`);
  }
}

export async function seedVehicleModelFamily(platformHdlrI, createdby) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "vehicle_modelfamily.csv"
  );
  console.log(`Reading vehicle model families from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const dataLines = lines[0].includes("modelfamilycode")
      ? lines.slice(1)
      : lines;

    for (const line of dataLines) {
      const columns = parseCSVLine(line);

      if (columns.length < 4) {
        console.log(`Skipping invalid line: ${line}`);
        continue;
      }

      const modelfamilycode = columns[0].trim();
      const modelfamilyname = columns[1].trim();
      const modelfamilyinfoStr = columns[2].trim();
      const isenabled = columns[3].trim();

      // Parse the JSON info
      let modelfamilyinfo = {};
      if (modelfamilyinfoStr && modelfamilyinfoStr !== "[object Object]") {
        try {
          // Remove outer quotes if present and unescape double quotes
          let jsonStr = modelfamilyinfoStr;
          if (jsonStr.startsWith('"') && jsonStr.endsWith('"')) {
            jsonStr = jsonStr.slice(1, -1);
          }
          // Unescape double quotes
          jsonStr = jsonStr.replace(/""/g, '"');

          modelfamilyinfo = JSON.parse(jsonStr);
        } catch (e) {
          console.log(
            `Failed to parse JSON for ${modelfamilycode}: ${e.message}`
          );
          modelfamilyinfo = {};
        }
      }

      if (modelfamilycode) {
        let result =
          await platformHdlrI.modelHdlr.modelHdlrImpl.CreateModelFamilyLogic(
            modelfamilycode,
            modelfamilyname,
            modelfamilyinfo,
            isenabled,
            createdby
          );
        console.log(`Vehicle model family created:`, result);
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed vehicle model families: ${error.message}`);
  }
}

//seed vehicle model with old data
export async function seedOldVehicleModel(platformHdlrI, createdby) {
  try {
    const jsonFilePath = path.join(
      process.cwd(),
      // "scripts",
      "seed_csv_files",
      "vehicle_model_data.json"
    );

    console.log(`Reading vehicle models from ${jsonFilePath}`);

    // Check if JSON file exists
    if (!fs.existsSync(jsonFilePath)) {
      throw new Error(`JSON file not found at ${jsonFilePath}`);
    }
    // Read JSON file
    const jsonContent = fs.readFileSync(jsonFilePath, "utf8");
    const vehicleData = JSON.parse(jsonContent);

    if (!vehicleData || !vehicleData.vehicleModels) {
      throw new Error("Invalid JSON structure or missing vehicleModels array");
    }

    console.log(`Found ${vehicleData.vehicleModels.length} vehicle models`);

    // Process each vehicle model
    for (const vehicle of vehicleData.vehicleModels) {
      const {
        modelcode,
        modelname,
        modelvariant,
        modelfamilycode,
        modelinfo,
        isenabled,
        modeldisplayname,
      } = vehicle;

      const result =
        await platformHdlrI.modelHdlr.modelHdlrImpl.CreateVehicleModelLogic(
          modelcode,
          modelname,
          modelvariant,
          modelfamilycode,
          modeldisplayname,
          modelinfo || {},
          isenabled !== undefined ? isenabled : true,
          createdby
        );
      console.log(`Vehicle model created:`, result);
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed vehicle models: ${error.message}`);
  }
}

export async function seedVehicleModel(platformHdlrI, createdby, pgPoolTx) {
  try {
    const csvFilePath = path.join(
      process.cwd(),
      // "scripts",
      "seed_csv_files",
      "vehicle_models_updated.csv"
    );

    console.log(`Reading vehicle models from ${csvFilePath}`);

    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }
    // Read JSON file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");
    const vehicleModels = lines[0].includes("vehiclemodel")
      ? lines.slice(1)
      : lines;

    console.log(`Found ${vehicleModels.length} vehicle models`);

    // Process each vehicle model
    for (const line of vehicleModels) {
      const columns = parseCSVLine(line);
      const vehiclemodel = columns[0].trim();
      let vehiclecolour = columns[1].trim();
      const vehiclevariant = columns[2].trim();
      const displayname = columns[3].trim();
      let modelimage = columns[4].trim();
      let modelmanual = columns[5].trim();
      const range = columns[6].trim();
      const battery_capacity = columns[7].trim();
      const co2_emission_factor = columns[8].trim();
      const fuel_price_factor = columns[9].trim();
      let modelicon = columns[10].trim();

      if (vehiclecolour === "/") {
        vehiclecolour = "WHITE";
      }
      modelimage = withCdnBase(modelimage);
      modelmanual = withCdnBase(modelmanual);
      modelicon = withCdnBase(modelicon);


      if (vehiclecolour) {
        let stmt = `INSERT into color (colorcode, colorname) VALUES ($1, $2) ON CONFLICT (colorcode) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [vehiclecolour, vehiclecolour]);
        if (res.rowCount === 1) {
          console.log(`Inserted colour: ${vehiclecolour}`);
        } else {
          console.log(`Colour already exist: ${vehiclecolour}`);
        }
      }

      let modelfamilycode;
      if (
        vehiclemodel.toLowerCase().includes("treo") ||
        vehiclemodel.toLowerCase().includes("zor")
      ) {
        modelfamilycode = "treo";
      } else if (vehiclemodel.toLowerCase().includes("zeo")) {
        modelfamilycode = "zeo";
      } else {
        modelfamilycode = "a301";
      }

      const modelcode = `${vehiclemodel
        .toLowerCase()
        .replace(/\s+/g, "")}_${vehiclevariant
        .toLowerCase()
        .replace(/\s+/g, "")}`;

      try {
        const result =
          await platformHdlrI.modelHdlr.modelHdlrImpl.CreateVehicleModelLogic(
            modelcode,
            vehiclemodel,
            vehiclevariant,
            modelfamilycode,
            displayname,
            {
              modelicon: modelicon,
              modelimage: modelimage,
              modelmanual: modelmanual,
              brochurespecs: {
                range: range,
                battery_capacity: battery_capacity,
                co2_emission_factor: co2_emission_factor,
                fuel_price_factor: fuel_price_factor,
              },
            }, //modelinfo,
            false,
            createdby
          );
        console.log(`Vehicle model created:`, result);
      } catch (error) {
        console.error(`Error creating vehicle model: ${error.message}`);
        continue;
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed vehicle models: ${error.message}`);
  }
}

export async function seedParamFamily(pgPoolTx, createdby) {
  const currtime = new Date();
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "paramfamily.csv"
  );
  console.log(`Reading param families from ${csvFilePath}`);
  try {
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");
    const paramFamilies = lines[0].includes("paramfamilycode")
      ? lines.slice(1)
      : lines;

    console.log(`Found ${paramFamilies.length} param families in CSV file`);

    for (const line of paramFamilies) {
      const columns = parseCSVLine(line);
      const paramfamilycode = columns[0].trim();
      const paramfamilyname = columns[1].trim();
      const paramfamilyinfo = columns[2].trim();
      const isenabled = columns[3].trim();

      if (paramfamilycode) {
        let stmt = `INSERT INTO paramfamily (paramfamilycode, paramfamilyname, paramfamilyinfo, isenabled, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (paramfamilycode) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          paramfamilycode,
          paramfamilyname,
          paramfamilyinfo,
          isenabled,
          currtime,
          createdby,
          currtime,
          createdby,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted param family: ${paramfamilycode}`);
        } else {
          console.log(`Param family already exists: ${paramfamilycode}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed param families: ${error.message}`);
  }
}

export async function seedParamFamilyParam(pgPoolTx, createdby) {
  const currtime = new Date();
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "paramfamily_param.csv"
  );
  console.log(`Reading param family params from ${csvFilePath}`);
  try {
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");
    const paramFamilyParams = lines[0].includes("paramfamilycode")
      ? lines.slice(1)
      : lines;

    console.log(
      `Found ${paramFamilyParams.length} param family params in CSV file`
    );

    for (const line of paramFamilyParams) {
      const columns = parseCSVLine(line);
      const paramfamilycode = columns[0].trim();
      const paramcode = columns[1].trim();
      const paramname = columns[2].trim();
      const paraminfo = columns[3].trim();
      const isenabled = columns[4].trim();

      if (paramfamilycode && paramcode) {
        let stmt = `INSERT INTO paramfamily_param (paramfamilycode, paramcode, paramname, paraminfo, isenabled, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (paramfamilycode, paramcode) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          paramfamilycode,
          paramcode,
          paramname,
          paraminfo,
          isenabled,
          currtime,
          createdby,
          currtime,
          createdby,
        ]);
        if (res.rowCount === 1) {
          console.log(
            `Inserted param family param: ${paramfamilycode}.${paramcode}`
          );
        } else {
          console.log(
            `Param family param already exists: ${paramfamilycode}.${paramcode}`
          );
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed param family params: ${error.message}`);
  }
}

export async function seedVehicleModelFamilyParam(pgPoolTx, createdby) {
  const currtime = new Date();
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "vehicle_modelfamily_param.csv"
  );
  console.log(`Reading vehicle modelfamily params from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const vehicleModelfamilyParams = lines[0].includes("modelfamilycode")
      ? lines.slice(1)
      : lines;

    console.log(
      `Found ${vehicleModelfamilyParams.length} vehicle modelfamily params in CSV file`
    );

    // Insert each deviation
    for (const line of vehicleModelfamilyParams) {
      const columns = parseCSVLine(line);
      const modelfamilycode = columns[0].trim();
      const paramfamilycode = columns[1].trim();
      const paramcode = columns[2].trim();
      const paramvalue = columns[3].trim();
      const isenabled = columns[4].trim();
      const odozeroprocessing = true;
      if (modelfamilycode) {
        let stmt = `INSERT INTO vehicle_modelfamily_param (modelfamilycode, paramfamilycode, paramcode, paramvalue, isenabled, odozeroprocessing, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (modelfamilycode, paramfamilycode, paramcode) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          modelfamilycode,
          paramfamilycode,
          paramcode,
          paramvalue,
          isenabled,
          odozeroprocessing,
          currtime,
          createdby,
          currtime,
          createdby,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted vehicle modelfamily param: ${modelfamilycode}`);
        } else {
          console.log(
            `Vehicle modelfamily param already exists: ${modelfamilycode}`
          );
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(
      `Failed to seed vehicle modelfamily params: ${error.message}`
    );
  }
}

export async function seedPackageTypesAndCategories(platformHdlrI, createdby) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "package_type.csv"
  );
  console.log(`Reading package types from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const packageTypes = lines[0].includes("pkgtype") ? lines.slice(1) : lines;

    console.log(`Found ${packageTypes.length} package types in CSV file`);

    // Insert each deviation
    for (const line of packageTypes) {
      const columns = parseCSVLine(line);
      const pkgtype = columns[0].trim();
      let result =
        await platformHdlrI.packageHdlr.packageHdlrImpl.CreatePackageTypeLogic(
          pkgtype,
          createdby
        );
      console.log(`Package type created:`, result);
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed package types: ${error.message}`);
  }
}

export async function seedChargeDeviation(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "charge_deviation.csv"
  );
  console.log(`Reading charge deviations from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const deviations = lines[0].includes("deviation_code")
      ? lines.slice(1)
      : lines;

    console.log(`Found ${deviations.length} deviations in CSV file`);

    // Insert each deviation
    for (const line of deviations) {
      const columns = parseCSVLine(line);
      const deviationCode = columns[0].trim();
      const deviationText = columns[1].trim();
      if (deviationCode) {
        let stmt = `INSERT INTO charge_deviation (deviation_code, deviation_text) VALUES ($1, $2) ON CONFLICT (deviation_code) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [deviationCode, deviationText]);
        if (res.rowCount === 1) {
          console.log(`Inserted charge deviation: ${deviationCode}`);
        } else {
          console.log(`Charge deviation already exists: ${deviationCode}`);
        }
      }
    }

    console.log(
      `Successfully processed ${deviations.length} deviations from CSV`
    );
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed charge deviations: ${error.message}`);
  }
}

export async function seedDocuments(pgPoolTx) {
  const currtime = new Date();
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "documents.csv"
  );
  console.log(`Reading documents from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const documents = lines[0].includes("id") ? lines.slice(1) : lines;

    console.log(`Found ${documents.length} documents in CSV file`);

    // Insert each deviation
    for (const line of documents) {
      const columns = parseCSVLine(line);
      const id = columns[0].trim();
      let url = columns[1].trim();
      const priority = columns[2].trim();
      const isenabled = columns[3].trim();
      url = withCdnBase(url);
      if (id) {
        let stmt = `INSERT INTO documents (id, url, priority, isenabled, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          id,
          url,
          priority,
          isenabled,
          currtime,
          currtime,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted document: ${id}`);
        } else {
          console.log(`Document already exists: ${id}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed documents: ${error.message}`);
  }
}

export async function seedBanners(pgPoolTx) {
  const currtime = new Date();
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "banners.csv"
  );
  console.log(`Reading banners from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const banners = lines[0].includes("id") ? lines.slice(1) : lines;

    console.log(`Found ${banners.length} banners in CSV file`);

    // Insert each banner
    for (const line of banners) {
      const columns = parseCSVLine(line);
      const id = columns[0].trim();
      let url = columns[1].trim();
      const priority = columns[2].trim();
      const isenabled = columns[3].trim();
      url = withCdnBase(url);
      if (id) {
        let stmt = `INSERT INTO banners (id, url, priority, isenabled, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`;
        let res = await pgPoolTx.query(stmt, [
          id,
          url,
          priority,
          isenabled,
          currtime,
          currtime,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted banner: ${id}`);
        } else {
          console.log(`Banner already exists: ${id}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed banners: ${error.message}`);
  }
}

export async function seedSOSContacts(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "sos_contacts.csv"
  );
  console.log(`Reading SOS contacts from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const sosContacts = lines[0].includes("contactid") ? lines.slice(1) : lines;

    console.log(`Found ${sosContacts.length} SOS contacts in CSV file`);

    // Insert each deviation
    for (const line of sosContacts) {
      const columns = parseCSVLine(line);
      const contactid = columns[0].trim();
      const contactname = columns[1].trim();
      const contactmobile = columns[2].trim();
      let contactemail = columns[3].trim();
      const priority = columns[4].trim();
      const isactive = columns[5].trim();
      if (contactemail && contactemail !== "" && contactemail !== "null") {
        // Check if email matches the database constraint pattern
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(contactemail)) {
          console.log(
            `Skipping contact ${contactname} with invalid email: ${contactemail}`
          );
          contactemail = null; // Set to null if invalid
        }
      } else {
        contactemail = null; // Set to null if empty or "null"
      }
      if (contactid) {
        const stmt = `INSERT INTO sos_contacts (contactid, contactname, contactmobile, contactemail, priority, isactive) 
                  VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (contactid) DO NOTHING`;
        const res = await pgPoolTx.query(stmt, [
          contactid,
          contactname,
          contactmobile,
          contactemail,
          priority,
          isactive,
        ]);
        if (res.rowCount === 1) {
          console.log(`Inserted SOS contact: ${contactname}`);
        } else {
          console.log(`SOS contact already exists: ${contactname}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed SOS contacts: ${error.message}`);
  }
}

export async function seedApiKeys(pgPoolTx) {
  const currtime = new Date();

  // Define the API keys configuration
  const apiKeysConfig = [
    {
      keyname: "GOOGLE_MAPS_API_KEY_1",
      values: {
        web: "AIzaSyDUfJceaDeCg9sqoOkYuVhigcdiT-4XBKE",
        android: "AIzaSyDUfJceaDeCg9sqoOkYuVhigcdiT-4XBKE",
        ios: "AIzaSyDUfJceaDeCg9sqoOkYuVhigcdiT-4XBKE",
      },
      environments: ["staging", "development", "production", "local"],
    },
    {
      keyname: "GOOGLE_MAPS_MAP_ID_1",
      values: {
        web: "fda1c03122b5c0f0665b7678",
        android: "fda1c03122b5c0f0b725feac",
        ios: "fda1c03122b5c0f016891c4a",
      },
      environments: ["staging", "development", "production", "local"],
    },
  ];

  console.log("Seeding API keys...");

  try {
    for (const keyConfig of apiKeysConfig) {
      const { keyname, values, environments } = keyConfig;

      for (const platform of Object.keys(values)) {
        for (const environment of environments) {
          const value = values[platform];

          const stmt = `
            INSERT INTO api_keys (platform, environment, keyname, value, isenabled) 
            VALUES ($1, $2, $3, $4, $5) 
            ON CONFLICT (platform, environment, keyname) DO UPDATE SET 
              value = EXCLUDED.value
          `;

          const res = await pgPoolTx.query(stmt, [
            platform,
            environment,
            keyname,
            value,
            true, //isenabled
          ]);

          if (res.rowCount === 1) {
            console.log(
              `Inserted API key: ${platform}.${environment}.${keyname}`
            );
          } else {
            console.log(
              `Updated API key: ${platform}.${environment}.${keyname}`
            );
          }
        }
      }
    }

    console.log("Successfully seeded all API keys");
  } catch (error) {
    console.error(`Error seeding API keys: ${error.message}`);
    throw new Error(`Failed to seed API keys: ${error.message}`);
  }
}

export async function seedCity(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "city.csv"
  );
  console.log(`Reading city from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const cities = lines[0].includes("citycode") ? lines.slice(1) : lines;
    for (const line of cities) {
      const columns = parseCSVLine(line);
      const cityname = columns[0].trim();
      const citycode = columns[1].trim();
      if (citycode) {
        const stmt = `INSERT INTO city (citycode, cityname) VALUES ($1, $2) ON CONFLICT (citycode) DO NOTHING`;
        const res = await pgPoolTx.query(stmt, [citycode, cityname]);
        if (res.rowCount === 1) {
          console.log(`Inserted city: ${cityname}`);
        } else {
          console.log(`City already exists: ${cityname}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed city: ${error.message}`);
  }
}

export async function seedDealer(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "dealer.csv"
  );
  console.log(`Reading dealer from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const dealers = lines[0].includes("dealercode") ? lines.slice(1) : lines;
    for (const line of dealers) {
      const columns = parseCSVLine(line);
      const dealercode = columns[0].trim();
      const dealername = columns[1].trim();
      if (dealercode) {
        const stmt = `INSERT INTO dealer (dealercode, dealername) VALUES ($1, $2) ON CONFLICT (dealercode) DO NOTHING`;
        const res = await pgPoolTx.query(stmt, [dealercode, dealername]);
        if (res.rowCount === 1) {
          console.log(`Inserted dealer: ${dealername}`);
        } else {
          console.log(`Dealer already exists: ${dealername}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed dealer: ${error.message}`);
  }
}

export async function seedColour(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "colour.csv"
  );
  console.log(`Reading colour from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const colours = lines[0].includes("colorcode") ? lines.slice(1) : lines;
    for (const line of colours) {
      const columns = parseCSVLine(line);
      const colorcode = columns[0].trim();
      const colorname = columns[1].trim();
      if (colorcode) {
        const stmt = `INSERT into color (colorcode, colorname) VALUES ($1, $2) ON CONFLICT (colorcode) DO NOTHING`;
        const res = await pgPoolTx.query(stmt, [colorcode, colorname]);
        if (res.rowCount === 1) {
          console.log(`Inserted colour: ${colorname}`);
        } else {
          console.log(`Colour already exists: ${colorname}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed colour: ${error.message}`);
  }
}

export async function seedFuelType(pgPoolTx) {
  const csvFilePath = path.join(
    process.cwd(),
    // "scripts",
    "seed_csv_files",
    "fueltype.csv"
  );
  console.log(`Reading fuel type from ${csvFilePath}`);
  try {
    // Check if CSV file exists
    if (!fs.existsSync(csvFilePath)) {
      throw new Error(`CSV file not found at ${csvFilePath}`);
    }

    // Read CSV file
    const csvContent = fs.readFileSync(csvFilePath, "utf8");
    const lines = csvContent.split("\n").filter((line) => line.trim() !== "");

    // Skip header if present
    const fueltypes = lines[0].includes("fueltypecode")
      ? lines.slice(1)
      : lines;
    for (const line of fueltypes) {
      const columns = parseCSVLine(line);
      const fueltypecode = columns[0].trim();
      const fueltypename = columns[1].trim();
      if (fueltypecode) {
        const stmt = `INSERT INTO fueltype (fueltypecode, fueltypename) VALUES ($1, $2) ON CONFLICT (fueltypecode) DO NOTHING`;
        const res = await pgPoolTx.query(stmt, [fueltypecode, fueltypename]);
        if (res.rowCount === 1) {
          console.log(`Inserted fuel type: ${fueltypename}`);
        } else {
          console.log(`Fuel type already exists: ${fueltypename}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed fuel type: ${error.message}`);
  }
}

export async function seedTGUModel(pgPoolTx) {
  try {
    const tguModels = ['GEN2', 'INTG1', 'GEN3', 'Gen2', 'GEN2.1', 'GEN1'];
    
    for (const model of tguModels) {
      const insertQuery = `
        INSERT INTO tgu_model (tgu_model_code, tgu_model_name) 
        VALUES ($1, $2) 
        ON CONFLICT (tgu_model_code) DO NOTHING
      `;
      await pgPoolTx.query(insertQuery, [model, model]);
    }
    
    console.log(`Successfully seeded ${tguModels.length} TGU models`);
  } catch (error) {
    console.error(`Error reading CSV file: ${error.message}`);
    throw new Error(`Failed to seed TGU model: ${error.message}`);
  }
}

export async function seedTGUSwVersion(pgPoolTx) {
  try {
    const tguSwVersions = [
      'eAuto_2.8',
      'TreoSystem_WP7608_V2_0_0',
      'TreoSystem_WP7608_V2_2_0',
      'eVeritoSystem190200_WP7608_V1_0_0',
      'eAuto2_8',
      'eAutoSystem2v8',
      'TreoSystem_WP7608_V2_1_0',
      'eAutoAirtel2v8_9',
      'eAuto2v8.3_1v8.1',
      'eAutoSystem_3_1_3',
      'TreoSystem_WP7608_V2_0_1'
    ];
    
    for (const version of tguSwVersions) {
      const insertQuery = `
        INSERT INTO tgu_sw_version (tgu_sw_version_code, tgu_sw_version_name) 
        VALUES ($1, $2) 
        ON CONFLICT (tgu_sw_version_code) DO NOTHING
      `;
      await pgPoolTx.query(insertQuery, [version, version]);
    }
    
    console.log(`Successfully seeded ${tguSwVersions.length} TGU software versions`);
  } catch (error) {
    console.error(`Error seeding TGU software version: ${error.message}`);
    throw new Error(`Failed to seed TGU software version: ${error.message}`);
  }
}