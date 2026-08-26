import {
  CONSOLE_MODULE_CODE,
  ADMIN_PERMISSION,
} from "../../../utils/constant.js";
 
export default class ModuleSvcDB {
  /**
   *
   * @param {PgPool} pgPoolI
   */
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
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
      throw new Error("Failed to fetch user data");
    }
  }
 
  async createModule(module) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let checkQuery = `
        SELECT moduleid FROM module WHERE modulecode = $1
      `;
      let checkResult = await txclient.query(checkQuery, [module.modulecode]);
      if (checkResult.rowCount > 0) {
        const roleback = await this.pgPoolI.TxRollback(txclient);
        if (roleback) {
          throw new Error("Module code already exists");
        }
        const error = new Error("Module code already exists");
        error.errcode = "MODULE_CODE_ALREADY_EXISTS";
        error.errdata = {
          modulecode: module.modulecode,
        };
        throw error;
      }
      let currtime = new Date();
 
      let maxPriorityQuery = `SELECT COALESCE(MAX(priority), 0) as max_priority FROM module`;
      let maxPriorityResult = await txclient.query(maxPriorityQuery);
      let newPriority = maxPriorityResult.rows[0].max_priority + 1;
 
      let query = `
            INSERT INTO module (moduleid, modulename, moduletype, modulecode, moduleinfo, creditspervehicleday, isenabled, priority, createdat, createdby, updatedat, updatedby)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
      let result = await txclient.query(query, [
        module.moduleid,
        module.modulename,
        module.moduletype,
        module.modulecode,
        module.moduleinfo,
        module.creditspervehicleday,
        module.isenabled,
        newPriority,
        currtime,
        module.createdby,
        currtime,
        module.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create module");
      }
 
      // let createdbyname = await this.getUserName(module.createdby);
      // module.createdby = createdbyname;
      module.priority = newPriority;
      await this.logModuleHistory(module, module.createdby, currtime, 'CREATE', {}, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return module;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to create module");
    }
  }

  async logModuleHistory(module, updatedby, updatedat, action, previousstate, txclient) {
    try {
      const finalUpdatedBy = updatedby ?? module.updatedby;
      const finalUpdatedAt = updatedat ?? module.updatedat;
      const currentstate = action === 'DELETE' 
        ? {} 
        : {
            modulename: module.modulename,
            moduletype: module.moduletype,
            modulecode: module.modulecode,
            moduleinfo: module.moduleinfo,
            creditspervehicleday: module.creditspervehicleday,
            priority: module.priority,
            isenabled: module.isenabled,
          };
      let query = 
      `
            INSERT INTO module_history (moduleid, modulename, moduletype, modulecode, moduleinfo, creditspervehicleday, priority, isenabled, updatedat, updatedby, action, previousstate, currentstate) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `;
      result = await txclient.query(query, [
        module.moduleid,
        module.modulename,
        module.moduletype,
        module.modulecode,
        module.moduleinfo,
        module.creditspervehicleday,
        module.priority,
        module.isenabled,
        currtime,
        module.createdby,
        'CREATE',
        JSON.stringify(previousstate),
        JSON.stringify(currentstate),
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log module history");
      }
      // await this.logModuleHistory(module, module.createdby, currtime, 'CREATE', {}, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return module;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw error;
    }
  }

  async logModulePermHistory(moduleid, permid, action, updatedby, updateFields, txclient = null) {
    try{
      let currtime = new Date();
      
      // Get modperminfo - either from updateFields or query from database
      let modperminfo = updateFields?.modperminfo || {};
      
      if (!modperminfo) {
        let query = `SELECT modperminfo from module_perm where moduleid = $1 AND permid = $2`;
        if (txclient) {
          const {rows} = await txclient.query(query, [moduleid, permid]);
          modperminfo = rows[0]?.modperminfo || {};
        } else {
          const {rows} = await this.pgPoolI.Query(query, [moduleid, permid]);
          modperminfo = rows[0]?.modperminfo || {};
        }
      }

      let query = `
        INSERT INTO module_perm_history (
          moduleid,
          permid,
          isenabled,
          modperminfo,
          updatedat,
          updatedby,
          action
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `;
      
      const queryParams = [
        moduleid,
        permid,
        updateFields.isenabled,
        modperminfo,
        currtime,
        updatedby,
        action,
      ];
      
      if (txclient) {
        await txclient.query(query, queryParams);
      } else {
        await this.pgPoolI.Query(query, queryParams);
      }
    }
    catch(error){
      this.logger.error("module history insert failed", { moduleid, permid, err: error });
      throw error;
    }
  }

  async getModuleHistory(starttime, endtime){
    try{
      let query = `
        SELECT mh.moduleid, mh.modulename, mh.moduletype, mh.modulecode, mh.moduleinfo, mh.creditspervehicleday, mh.priority, mh.isenabled, mh.updatedat, mh.action, u.displayname as updatedby, mh.previousstate, mh.currentstate FROM module_history as mh JOIN users as u ON mh.updatedby = u.userid
        WHERE mh.updatedat >= $1 AND mh.updatedat <= $2 ORDER BY mh.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch(error){
      throw new Error("Failed to retrieve module history");
    }
  }
 
  async getModulePermHistory(starttime, endtime){
    try{
      let query = `
        SELECT mph.moduleid, m.modulename, mph.permid, mph.isenabled, mph.modperminfo, mph.updatedat , u.displayname as updatedby, mph.action
        FROM module_perm_history as mph
        JOIN users as u ON mph.updatedby = u.userid
        JOIN module as m ON mph.moduleid = m.moduleid
        WHERE mph.updatedat >= $1 AND mph.updatedat <= $2 ORDER BY mph.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch(error){
      throw new Error("Failed to retrieve module perm history");
    }
  }
 
  
  async getAllModulesInfo() {
    try {
      let query = `
            SELECT m.moduleid, m.modulename, m.moduletype, m.modulecode, m.moduleinfo, m.creditspervehicleday, m.isenabled, m.priority, m.createdat, u1.displayname as createdby, m.updatedat, u2.displayname as updatedby
            FROM module m
            JOIN users u1 ON m.createdby = u1.userid
            JOIN users u2 ON m.updatedby = u2.userid
            ORDER BY m.priority
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
 
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve all modules info");
    }
  }
 
  async getModuleInfo(moduleid) {
    try {
      let query = `
            SELECT m.moduleid, m.modulename, m.moduletype, m.modulecode, m.moduleinfo, m.creditspervehicleday, m.isenabled, m.priority, m.createdat, u1.displayname as createdby, m.updatedat, u2.displayname as updatedby
            FROM module m
            JOIN users u1 ON m.createdby = u1.userid
            JOIN users u2 ON m.updatedby = u2.userid
            WHERE moduleid = $1
        `;
      let result = await this.pgPoolI.Query(query, [moduleid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to retrieve module info");
    }
  }
 
  async updateModule(moduleid, updateFields, updatedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let previousStateQuery = `
        SELECT moduleid, modulename, moduletype, modulecode, moduleinfo,
               creditspervehicleday, priority, isenabled, createdat, createdby,
               updatedat, updatedby
        FROM module
        WHERE moduleid = $1
      `;
      let previousStateResult = await txclient.query(previousStateQuery, [moduleid]);
      if (previousStateResult.rowCount === 0) {
        throw new Error("Module not found");
      }
      let previousState = previousStateResult.rows[0];
 
      let currtime = new Date();
      let fields = {
        ...updateFields,
        updatedat: currtime,
        updatedby,
      };
 
      let allowedKeys = [
        "modulename",
        "moduletype",
        "moduleinfo",
        "creditspervehicleday",
        "isenabled",
        "priority",
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
      values.push(moduleid);
 
      let query = `
        UPDATE module
        SET ${keys.join(", ")}
        WHERE moduleid = $${values.length}
      `;
 
      let result = await txclient.query(query, values);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update module");
      }
 
      let currentStateQuery = `
        SELECT moduleid, modulename, moduletype, modulecode, moduleinfo,
               creditspervehicleday, priority, isenabled, createdat, createdby,
               updatedat, updatedby
        FROM module
        WHERE moduleid = $1
      `;
      let currentStateResult = await txclient.query(currentStateQuery, [moduleid]);
      let currentState = currentStateResult.rows[0];
 
      let previousStateJson = {
        modulename: previousState.modulename,
        moduletype: previousState.moduletype,
        modulecode: previousState.modulecode,
        moduleinfo: previousState.moduleinfo,
        creditspervehicleday: previousState.creditspervehicleday,
        priority: previousState.priority,
        isenabled: previousState.isenabled,
      };

      let module = {
        moduleid: currentState.moduleid,
        modulename: currentState.modulename,
        moduletype: currentState.moduletype,
        modulecode: currentState.modulecode,
        moduleinfo: currentState.moduleinfo,
        creditspervehicleday: currentState.creditspervehicleday,
        priority: currentState.priority,
        isenabled: currentState.isenabled,
        updatedat: currentState.updatedat,
        updatedby: currentState.updatedby,
      };

      await this.logModuleHistory(module, updatedby, currtime, 'UPDATE', previousStateJson, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to update module info");
    }
  }
 
  async getModulePerms(moduleid) {
    try {
      let query = `
            SELECT permid, isenabled, modperminfo, createdat FROM module_perm WHERE moduleid = $1
            ORDER BY createdat DESC
        `;
      let result = await this.pgPoolI.Query(query, [moduleid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to fetch module permissions");
    }
  }
 
  async addModulePerm(moduleid, permid, isenabled, moduleperminfo, createdby) {
    let currtime = new Date();
 
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let query = `
                INSERT INTO perm (permid, createdat, createdby) VALUES ($1, $2, $3)
            `;
      let result = await txclient.query(query, [permid, currtime, createdby]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to insert permission");
      }
 
      query = `
                INSERT INTO module_perm (moduleid, permid, isenabled, modperminfo, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;
      result = await txclient.query(query, [
        moduleid,
        permid,
        isenabled,
        moduleperminfo,
        currtime,
        createdby,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add module permission");
      }

      await this.logModulePermHistory(
        moduleid,
        permid,
        'CREATED',
        createdby,
        { modperminfo: moduleperminfo },
        txclient
      );

      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
 
  async addModulePerms(moduleid, permids, createdby) {
    let currtime = new Date();
 
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      if (permids.length === 0) {
        return true;
      }
      let values = [];
      let placeholders = permids
        .map((permid, index) => {
          const startIndex = index * 3 + 1;
          values.push(permid, currtime, createdby);
          return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2})`;
        })
        .join(",");
 
      let query = `
                INSERT INTO perm (permid, createdat, createdby) VALUES ${placeholders} ON CONFLICT (permid) DO NOTHING
            `;
      let result = await txclient.query(query, values);
      if (result.rowCount !== permids.length) {
        this.logger.error("Failed to insert permissions", {
          moduleid: moduleid,
          permids: permids,
          createdby: createdby,
        });
      }
 
      values = [];
      placeholders = permids
        .map((permid, index) => {
          const startIndex = index * 8 + 1;
          values.push(
            moduleid,
            permid,
            true,
            {},
            currtime,
            createdby,
            currtime,
            createdby
          );
          return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2}, $${
            startIndex + 3
          }, $${startIndex + 4}, $${startIndex + 5}, $${startIndex + 6}, $${
            startIndex + 7
          })`;
        })
        .join(",");
 
      query = `
                INSERT INTO module_perm (moduleid, permid, isenabled, modperminfo, createdat, createdby, updatedat, updatedby) VALUES ${placeholders}
            `;
      result = await txclient.query(query, values);
      if (result.rowCount !== permids.length) {
        this.logger.error("Failed to add module permissions", {
          moduleid: moduleid,
          permids: permids,
          createdby: createdby,
        });
      }

      await this.logModulePermHistory(
        moduleid,
        permids,
        'CREATED',
        createdby,
        { isenabled: true }
      );

      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
 
  async updateModulePerm(moduleid, permid, updateFields, updatedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let currtime = new Date();
      // check if we are updating console module's all.all.all permission
      let query = `
        SELECT moduleid FROM module WHERE modulecode = $1 and moduleid = $2
      `;
      let result = await txclient.query(query, [
        CONSOLE_MODULE_CODE,
        moduleid,
      ]);
      if (result.rowCount !== 0) {
        if (permid === ADMIN_PERMISSION) {
          throw {
            errcode: "INPUT_ERROR",
            errdata: {
              moduleid: moduleid,
              permid: permid,
            },
            message: "Cannot update console module's all.all.all permission",
          };
        }
      }
 
      let fields = {
        ...updateFields,
        updatedat: currtime,
        updatedby,
      };
 
      let allowedKeys = ["isenabled", "modperminfo", "updatedat", "updatedby"];
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
      values.push(moduleid);
      values.push(permid);
 
      query = `
      UPDATE module_perm
      SET ${keys.join(", ")}
      WHERE moduleid = $${values.length - 1} AND permid = $${values.length}
    `;
 
      result = await txclient.query(query, values);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update module permission");
      }
 
      query = `
        SELECT isenabled, modperminfo FROM module_perm
        WHERE moduleid = $1 AND permid = $2
      `;
      result = await txclient.query(query, [moduleid, permid]);
      const currentState = result.rows[0];
      const isenabled = currentState.isenabled;

      await this.logModulePermHistory(
        moduleid,
        permid,
        isenabled,
        currentState.modperminfo,
        currtime,
        updatedby,
        { isenabled: isenabled,
          modperminfo: currentState.modperminfo 
        },
        txclient
      );
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      if (error.errcode) {
        throw error;
      }
      throw new Error("Failed to update module permission");
    }
  }
 
  async deleteModulePerm(moduleid, permid, updatedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let query = `
        SELECT COUNT(*) as count FROM role_perm WHERE permid = $1
      `;
      let result = await txclient.query(query, [permid]);
      if (parseInt(result.rows[0].count) > 0) {
        const error = new Error(
          "Permission is associated with one or more roles and cannot be deleted"
        );
        error.errcode = "PERMISSION_ASSOCIATED_WITH_ROLES";
        throw error;
      }
 
      query = `SELECT modulecode FROM module WHERE moduleid = $1`;
      result = await txclient.query(query, [moduleid]);
      if (result.rowCount === 0) {
        throw {
          errcode: "INPUT_ERROR",
          errdata: {
            moduleid: moduleid,
          },
          message: "Module not found",
        };
      }
      const module = result.rows[0];
      if (
        module.modulecode === CONSOLE_MODULE_CODE &&
        permid === ADMIN_PERMISSION
      ) {
        throw {
          errcode: "INPUT_ERROR",
          errdata: {
            moduleid: moduleid,
            permid: permid,
          },
          message: "Cannot delete console module's all.all.all permission",
        };
      }
 
      query = `SELECT COUNT(*) as count FROM module_perm WHERE permid = $1`;
      result = await txclient.query(query, [permid]);
      if (parseInt(result.rows[0].count) === 0) {
        const error = new Error("Permission not found");
        error.errcode = "PERMISSION_NOT_FOUND";
        throw error;
      }
      await this.logModulePermHistory(
        moduleid,
        permid,
        false,
        modperminfo,
        currtime,
        updatedby,
        {isenabled: false, modperminfo: {}},
        txclient
      );

      query = `
                DELETE FROM module_perm WHERE moduleid = $1 AND permid = $2
            `;
      result = await txclient.query(query, [moduleid, permid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete module permission");
      }
 
      query = `
                DELETE FROM perm WHERE permid = $1
            `;
      result = await txclient.query(query, [permid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete permission");
      }
 
 
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
 
  async isModuleAssignedToPackage(moduleid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM package_module WHERE moduleid = $1
      `;
      let result = await this.pgPoolI.Query(query, [moduleid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check module package assignment");
    }
  }
 
  async deleteModule(moduleid, deletedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // Fetch full module data before deletion for history logging
      let query = `
        SELECT moduleid, modulename, moduletype, modulecode, moduleinfo,
               creditspervehicleday, priority, isenabled, createdat, createdby,
               updatedat, updatedby
        FROM module WHERE moduleid = $1
      `;
      let result = await txclient.query(query, [moduleid]);
      if (result.rowCount === 0) {
        throw new Error("Module not found");
      }
 
      const module = result.rows[0];
 
      query = `
        SELECT COUNT(*) as count FROM package_module WHERE moduleid = $1
      `;
      result = await txclient.query(query, [moduleid]);
      if (parseInt(result.rows[0].count) > 0) {
        throw new Error(
          "Cannot delete module. It is assigned to one or more packages"
        );
      }
 
      query = `
        SELECT permid FROM module_perm WHERE moduleid = $1
      `;
      result = await txclient.query(query, [moduleid]);
      const permids = result.rows.map((row) => row.permid);
 
      let previousStateJson = {
        modulename: module.modulename,
        moduletype: module.moduletype,
        modulecode: module.modulecode,
        moduleinfo: module.moduleinfo,
        creditspervehicleday: module.creditspervehicleday,
        priority: module.priority,
        isenabled: module.isenabled,
      };
 
      let deletedat = new Date();
 
      if (permids.length > 0) {
        query = `
          DELETE FROM perm WHERE permid = ANY($1)
        `;
        await txclient.query(query, [permids]);
 
        query = `
          DELETE FROM module_perm WHERE moduleid = $1
        `;
        await txclient.query(query, [moduleid]);
      }
 
      query = `
        DELETE FROM module WHERE moduleid = $1
      `;
      result = await txclient.query(query, [moduleid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete module");
      }
      
      let moduleForHistory = {
        moduleid: module.moduleid,
        modulename: module.modulename,
        moduletype: module.moduletype,
        modulecode: module.modulecode,
        moduleinfo: module.moduleinfo,
        creditspervehicleday: module.creditspervehicleday,
        priority: module.priority,
        isenabled: module.isenabled,
        updatedat: deletedat,
        updatedby: deletedby,
      };

      
      await this.logModuleHistory(
        moduleForHistory,
        deletedby,
        deletedat,
        deletedby,
        'DELETE',
        previousStateJson,
        txclient
      );

      await this.pgPoolI.TxCommit(txclient);
      return {
        moduleid: moduleid,
        modulename: module.modulename,
        deletedat: deletedat,
        deletedby: deletedby,
      };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
  async isModuleCodeAvailable(modulecode) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM module WHERE LOWER(modulecode) = LOWER($1)
      `;
      let result = await this.pgPoolI.Query(query, [modulecode]);
      return parseInt(result.rows[0].count) === 0;
    } catch (error) {
      throw error;
    }
  }
}
 