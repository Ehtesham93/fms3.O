import { DEFAULT_PACKAGE_INFO } from "../../../utils/constant.js";

export default class PackageSvcDB {
  /**
   *
   * @param {PgPool} pgPoolI
   */
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
  }

  async getUserName(userid) {
    try {
      let query = `
            SELECT displayname FROM users WHERE userid = $1 AND isdeleted = false
        `;
      let result = await this.pgPoolI.Query(query, [userid]);
      if (result.rowCount === 0) {
        return "Unknown User";
      }
      return result.rows[0].displayname;
    } catch (error) {
      throw new Error(`Failed to fetch username`);
    }
  }

  async createPackageType(pkgtype, createdby) {
    try {
      let currtime = new Date();
      let query = `
            INSERT INTO package_type (pkgtype, createdat, createdby) VALUES ($1, $2, $3)
        `;
      let result = await this.pgPoolI.Query(query, [
        pkgtype,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create package type");
      }
      return true;
    } catch (error) {
      throw new Error(`Failed to create package type`);
    }
  }

  async getAllPackageTypes() {
    try {
      let query = `
            SELECT pt.pkgtype, pt.createdat, u1.displayname as createdby 
            FROM package_type pt 
            JOIN users u1 ON pt.createdby = u1.userid
            ORDER BY pt.createdat DESC
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve package types`);
    }
  }

  async createPackage(pkg, createdby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let currtime = new Date();
      let pkginfo = { ...DEFAULT_PACKAGE_INFO };
      if (this.config?.packageDefaults) {
        pkginfo = {
          graceperiod:
            this.config.packageDefaults.graceperiod ||
            DEFAULT_PACKAGE_INFO.graceperiod,
          creditfactor:
            this.config.packageDefaults.creditfactor ||
            DEFAULT_PACKAGE_INFO.creditfactor,
          vehiclecount:
            this.config.packageDefaults.vehiclecount ||
            DEFAULT_PACKAGE_INFO.vehiclecount,
        };
      }

      // check if pkgname already exists
      let query = `
        SELECT pkgid FROM package WHERE pkgname = $1
      `;
      let result = await txclient.query(query, [pkg.pkgname]);
      if (result.rowCount !== 0) {
        const error = new Error("Package name already exists");
        error.errcode = "PACKAGE_NAME_ALREADY_EXISTS";
        throw error;
      }

      query = `
            INSERT INTO package (pkgid, pkgname, pkgtype, pkginfo, isenabled, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
      result = await txclient.query(query, [
        pkg.pkgid,
        pkg.pkgname,
        pkg.pkgtype,
        pkginfo,
        pkg.isenabled,
        currtime,
        createdby,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        throw new Error("Failed to create package");
      }

      query = `INSERT INTO package_history (pkgid, pkgname, pkgtype, pkginfo, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
      result = await txclient.query(query, [
        pkg.pkgid,
        pkg.pkgname,
        pkg.pkgtype,
        pkg.pkginfo,
        pkg.isenabled,
        currtime,
        createdby,
        'CREATED',
        JSON.stringify({}),
        JSON.stringify({
          pkgname: pkg.pkgname,
          pkgtype: pkg.pkgtype,
          pkginfo: pkg.pkginfo,
          isenabled: pkg.isenabled,
        }),
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log package history");
      }
      // await this.logPackageHistory(pkg, createdby, currtime, 'CREATED', {}, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw error;
    }
  }

  // async logPackageHistory(pkg, updatedby, updatedat, action, previousstate, txclient = null){
  //   try{
  //     const finalUpdatedBy = updatedby ?? pkg.updatedby;
  //     const finalUpdatedAt = updatedat ?? pkg.updatedat;
  //     const currentstate = action === 'DELETE' 
  //       ? {} 
  //       : {
  //           pkgname: pkg.pkgname,
  //           pkgtype: pkg.pkgtype,
  //           pkginfo: pkg.pkginfo,
  //           isenabled: pkg.isenabled,
  //         };
  //     let query = `
  //             INSERT INTO package_history (pkgid, pkgname, pkgtype, pkginfo, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  //         `;
  //     let result = await txclient.query(query, [
  //         pkg.pkgid,
  //         pkg.pkgname,
  //         pkg.pkgtype,
  //         pkg.pkginfo,
  //         pkg.isenabled,
  //         finalUpdatedAt,
  //         finalUpdatedBy,
  //         action,
  //         JSON.stringify(previousstate),
  //         JSON.stringify(currentstate),
  //       ]);
  //     if (result.rowCount !== 1) {
  //       throw new Error("Failed to log package history");
  //     }
  //     return true;
  //   }
  //   catch(error){
  //     this.logger.error("package history insert failed", { package: pkg.pkgid, err });
  //     await this.pgPoolI.TxRollback(txclient);
  //     throw error;
  //   }
  // }

  async getPackageHistory(starttime, endtime){
    try{
      let query = `
        SELECT ph.pkgid, ph.pkgname, ph.pkgtype, ph.pkginfo, ph.isenabled, ph.updatedat, ph.action, u.displayname as updatedby, ph.previousstate, ph.currentstate 
        FROM package_history as ph 
        JOIN users as u ON ph.updatedby = u.userid
        WHERE ph.updatedat >= $1 AND ph.updatedat <= $2 
        ORDER BY ph.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch(error){
      throw new Error("Failed to retrieve package history");
    }
  }

  // async logPackageModHistory(pkgid, moduleid, action, updatedby, updatedat, txclient = null){
  //   try{
  //     let query = `
  //             INSERT INTO package_module_history (pkgid, moduleid, updatedat, updatedby, action) VALUES ($1, $2, $3, $4, $5)
  //         `;
  //     let queryParams = [
  //       pkgid,
  //       moduleid,
  //       updatedat,
  //       updatedby,
  //       action,
  //     ];
      
  //     let result = await txclient.query(query, queryParams);
  //     if (result.rowCount !== 1) {
  //       throw new Error("Failed to log package module history");
  //     }
  //     return true;
  //   }
  //   catch(error){
  //     this.logger.error("package module history insert failed", { pkgid, moduleid, err:error });
  //     await this.pgPoolI.TxRollback(txclient);
  //     throw error;
  //   }
  // }

  async getPackageModHistory(starttime, endtime){
    try{
      let query = `
        SELECT ph.pkgid, p.pkgname, m.modulename, ph.updatedat, u.displayname as updatedby, ph.action 
        FROM package_module_history as ph 
        JOIN users as u ON ph.updatedby = u.userid
        JOIN module as m ON ph.moduleid = m.moduleid
        JOIN package as p ON ph.pkgid = p.pkgid
        WHERE ph.updatedat >= $1 AND ph.updatedat <= $2 ORDER BY ph.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch(error){
      throw new Error("Failed to retrieve package module history");
    }
  }

  async updatePackage(pkgid, updateFields, updatedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let previousStateQuery = `
        SELECT pkgid, pkgname, pkgtype, pkginfo, isenabled, createdat, createdby, 
               updatedat, updatedby
        FROM package
        WHERE pkgid = $1
      `;
      let previousStateResult = await txclient.query(previousStateQuery, [pkgid]);
      if (previousStateResult.rowCount === 0) {
        throw new Error("Package not found");
      }
      let previousState = previousStateResult.rows[0];

      let currtime = new Date();
      let fields = {
        ...updateFields,
        updatedat: currtime,
        updatedby,
      };
      let allowedKeys = [
        "pkgname",
        "pkgtype",
        "pkginfo",
        "isenabled",
        "updatedat",
        "updatedby",
      ];
      let keys = [];
      let values = [];

      for (const key of allowedKeys) {
        if (fields.hasOwnProperty(key)) {
          keys.push(`${key} = $${keys.length + 1}`);
          values.push(fields[key]);
        }
      }

      if (keys.length === 0) {
        throw new Error("No valid fields provided for update");
      }

      values.push(pkgid);
      let query = `
      UPDATE package
      SET ${keys.join(", ")}
      WHERE pkgid = $${values.length}
    `;

      let result = await txclient.query(query, values);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update package");
      }

      let currentStateQuery = `
        SELECT pkgid, pkgname, pkgtype, pkginfo, isenabled, createdat, createdby, 
               updatedat, updatedby
        FROM package
        WHERE pkgid = $1
      `;
      let currentStateResult = await txclient.query(currentStateQuery, [pkgid]);
      let currentState = currentStateResult.rows[0];

      let previousStateJson = {
        pkgname: previousState.pkgname,
        pkgtype: previousState.pkgtype,
        pkginfo: previousState.pkginfo,
        isenabled: previousState.isenabled,
      };

      let currentStateJson = {
        pkgname: currentState.pkgname,
        pkgtype: currentState.pkgtype,
        pkginfo: currentState.pkginfo,
        isenabled: currentState.isenabled,
      };

      let pkg = {
        pkgid: currentState.pkgid,
        pkgname: currentState.pkgname,
        pkgtype: currentState.pkgtype,
        pkginfo: currentState.pkginfo,
        isenabled: currentState.isenabled,
        updatedat: currentState.updatedat,
        updatedby: currentState.updatedby,
      };

      query = `
        INSERT INTO package_history (pkgid, pkgname, pkgtype, pkginfo, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      result = await txclient.query(query, [
        pkg.pkgid,
        pkg.pkgname,
        pkg.pkgtype,
        pkg.pkginfo,
        pkg.isenabled,
        currentState.updatedat,
        currentState.updatedby,
        'UPDATE',
        JSON.stringify(previousStateJson),
        JSON.stringify(currentStateJson),
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log package history");
      }

      // await this.logPackageHistory(pkg, updatedby, currtime, 'UPDATE', previousStateJson, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to update package");
    }
  }

  async getAllPackages() {
    try {
      let query = `
            SELECT p.pkgid, p.pkgname, p.pkgtype, p.pkginfo, p.isenabled, p.createdat, u1.displayname as createdby, p.updatedat, u2.displayname as updatedby 
            FROM package p 
            JOIN users u1 ON p.createdby = u1.userid 
            JOIN users u2 ON p.updatedby = u2.userid
            ORDER BY p.createdat DESC
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve all packages`);
    }
  }

  async getPkgInfo(pkgid) {
    try {
      let query = `
            SELECT p.pkgid, p.pkgname, p.pkgtype, p.pkginfo, p.isenabled, p.createdat, u1.displayname as createdby, p.updatedat, u2.displayname as updatedby 
            FROM package p 
            JOIN users u1 ON p.createdby = u1.userid 
            JOIN users u2 ON p.updatedby = u2.userid
            WHERE p.pkgid = $1
        `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error(`Failed to retrieve package info`);
    }
  }

  async getPkgModules(pkgid) {
    try {
      let query = `
            SELECT moduleid FROM package_module WHERE pkgid = $1
        `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows.map((row) => row.moduleid);
    } catch (error) {
      throw new Error(`Failed to retrieve package modules`);
    }
  }

  async getAllModulesInfo() {
    try {
      let query = `
            SELECT m.moduleid, m.modulename, m.moduletype, m.modulecode, m.moduleinfo, m.creditspervehicleday, m.isenabled, m.createdat, u1.displayname as createdby, m.updatedat, u2.displayname as updatedby 
            FROM module m 
            JOIN users u1 ON m.createdby = u1.userid 
            JOIN users u2 ON m.updatedby = u2.userid
            WHERE m.modulecode != 'consolemgmt' ORDER BY m.priority
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve all modules info`);
    }
  }

  async updatePkgModules(pkgid, selectedmodules, deselectedmodules, updatedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    const pkgExists = await txclient.query(
      `SELECT 1 FROM package WHERE pkgid = $1`,
      [pkgid]
    );
    if (pkgExists.rowCount === 0) {
      throw new Error("Package not found");
    }
    let stateQuery = `
      SELECT * FROM package_module WHERE pkgid = $1
    `;
    let stateResult = await txclient.query(stateQuery, [pkgid]);
    
    // If no rows, just start with empty previous state
    let previousState = stateResult.rows;          // [] when none
    let previousModuleIds = previousState.map(r => r.moduleid);

    try {
      if (selectedmodules.length > 0) {
        let values = [];
        const placeholders = selectedmodules
          .map((moduleid, index) => {
            const startIndex = index * 4 + 1;
            values.push(pkgid, moduleid, currtime, updatedby);
            return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2}, $${
              startIndex + 3
            })`;
          })
          .join(",");

      let query = `
        INSERT INTO package_module (pkgid, moduleid, createdat, createdby) VALUES ${placeholders}
        ON CONFLICT (pkgid, moduleid) DO NOTHING
      `;
        let result = await txclient.query(query, values);
        if (result.rowCount !== selectedmodules.length) {
          this.logger.error("Some modules were not added", {
            pkgid: pkgid,
            selectedmodules: selectedmodules,
            deselectedmodules: deselectedmodules,
            updatedby: updatedby,
          });
        }
      }

      if (deselectedmodules.length > 0) {
        
      let query = `
        DELETE FROM package_module WHERE pkgid = $1 AND moduleid = ANY($2)
      `;
        let result = await txclient.query(query, [pkgid, deselectedmodules]);
        if (result.rowCount !== deselectedmodules.length) {
          this.logger.error("Some modules were not deleted", {
            pkgid: pkgid,
            deselectedmodules: deselectedmodules,
            updatedby: updatedby,
          });
        }
      }

      let updateFields = {
        updatedby,
        updatedat: currtime,
      };
      const allowedKeys = ["pkginfo", "isenabled"];
      const keys = [];
      const values = [];

      for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(updateFields, key)) {
          keys.push(`${key} = $${values.length + 1}`);
          values.push(updateFields[key]);
        }
      }

      if (keys.length > 0) {
        values.push(pkgid);
        const updateQuery = `
        UPDATE package
        SET ${keys.join(", ")}
        WHERE pkgid = $${values.length}
      `;
        await txclient.query(updateQuery, values);
      }

      
      let stateResult = await txclient.query(stateQuery, [pkgid]);
      let currentState = stateResult.rows;
      let currentModuleIds = currentState.map(row => row.moduleid);
      let removedModules = previousModuleIds.filter(id => !currentModuleIds.includes(id));
      let addedModules = currentModuleIds.filter(id => !previousModuleIds.includes(id));
      // Log only changed modules

      
      for (const moduleid of removedModules) {
        let query = `INSERT INTO package_module_history (pkgid, moduleid, updatedat, updatedby, action) VALUES ($1, $2, $3, $4, $5)`;
        let result = await txclient.query(query, [
          pkgid,
          moduleid,
          currtime,
          updatedby,
          'REMOVE',
        ]);
      }
      for (const moduleid of addedModules) {
        let query = `INSERT INTO package_module_history (pkgid, moduleid, updatedat, updatedby, action) VALUES ($1, $2, $3, $4, $5)`;
        let result = await txclient.query(query, [
          pkgid,
          moduleid,
          currtime,
          updatedby,
          'ADD',
        ]);
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return true;
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async isPackageAssignedToAccount(pkgid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM account_package_subscription WHERE pkgid = $1
      `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check package account assignment");
    }
  }

  async doesPackageHaveModules(pkgid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM package_module WHERE pkgid = $1
      `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check package modules");
    }
  }

  async doesPackageHaveHistory(pkgid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM account_package_subscription_history WHERE pkgid = $1
      `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check package history");
    }
  }

  async deletePackage(pkgid, deletedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // Fetch full package data before deletion for history logging
      let query = `
        SELECT pkgid, pkgname, pkgtype, pkginfo, isenabled, createdat, createdby, 
               updatedat, updatedby
        FROM package WHERE pkgid = $1
      `;
      let result = await txclient.query(query, [pkgid]);
      if (result.rowCount === 0) {
        throw new Error("Package not found");
      }

      const pkg = result.rows[0];

      query = `
        SELECT COUNT(*) as count FROM account_package_subscription WHERE pkgid = $1
      `;
      result = await txclient.query(query, [pkgid]);
      if (parseInt(result.rows[0].count) > 0) {
        throw new Error("Package is assigned to one or more accounts");
      }

      query = `
        SELECT COUNT(*) as count FROM package_module WHERE pkgid = $1
      `;
      result = await txclient.query(query, [pkgid]);
      if (parseInt(result.rows[0].count) > 0) {
        throw new Error("Package has modules assigned");
      }

      // Create previousStateJson for history logging
      let previousStateJson = {
        pkgname: pkg.pkgname,
        pkgtype: pkg.pkgtype,
        pkginfo: pkg.pkginfo,
        isenabled: pkg.isenabled,
      };

      let deletedat = new Date();

      // Create package object for history logging
      let pkgForHistory = {
        pkgid: pkg.pkgid,
        pkgname: pkg.pkgname,
        pkgtype: pkg.pkgtype,
        pkginfo: pkg.pkginfo,
        isenabled: pkg.isenabled,
        updatedat: deletedat,
        updatedby: deletedby,
      };

      let currentStateJson = {};

      query = `
        DELETE FROM account_custom_package_options WHERE pkgid = $1
      `;
      await txclient.query(query, [pkgid]);

      query = `
        DELETE FROM package WHERE pkgid = $1
      `;
      result = await txclient.query(query, [pkgid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete package");
      }

      query = `INSERT INTO package_history (pkgid, pkgname, pkgtype, pkginfo, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
      result = await txclient.query(query, [
        pkgForHistory.pkgid,
        pkgForHistory.pkgname,
        pkgForHistory.pkgtype,
        pkgForHistory.pkginfo,
        pkgForHistory.isenabled,
        pkgForHistory.updatedat,
        pkgForHistory.updatedby,
        'DELETE',
        JSON.stringify(previousStateJson),
        JSON.stringify(currentStateJson),
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log package history");
      }

      // await this.logPackageHistory(
      //   pkgForHistory,
      //   deletedby,
      //   deletedat,
      //   'DELETE',
      //   previousStateJson,
      //   txclient
      // );

      await this.pgPoolI.TxCommit(txclient);
      return {
        pkgid: pkgid,
        pkgname: pkg.pkgname,
        deletedat: deletedat,
        deletedby: deletedby,
      };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
}
