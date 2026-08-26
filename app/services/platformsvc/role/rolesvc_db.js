export default class RoleSvcDB {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
  }

  async createRole(role) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    } 
    try {
      let currtime = new Date();
      let checkQuery = `
        SELECT roleid FROM roles WHERE accountid = $1 AND rolename = $2
      `;
      let checkResult = await txclient.query(checkQuery, [
        role.accountid,
        role.rolename,
      ]);
      if (checkResult.rowCount > 0) {
        throw new Error("ROLE_NAME_ALREADY_EXISTS");
      }
      let query = `
            INSERT INTO roles (accountid, roleid, rolename, roletype, isenabled, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
      let result = await txclient.query(query, [
        role.accountid,
        role.roleid,
        role.rolename,
        role.roletype,
        role.isenabled,
        currtime,
        role.createdby,
        currtime,
        role.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create role");
      }

      query = `INSERT INTO role_history (accountid, roleid, rolename, roletype, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
      result = await txclient.query(query, [
        role.accountid,
        role.roleid,
        role.rolename,
        role.roletype,
        role.isenabled,
        currtime,
        role.createdby,
        'CREATE',
        JSON.stringify({}),
        JSON.stringify({
          accountid: role.accountid,
          roleid: role.roleid,
          rolename: role.rolename,
          roletype: role.roletype,
          isenabled: role.isenabled,
        })
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log role history");
      }
      // await this.logRoleHistory(role, role.createdby, currtime, 'CREATE', {}, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      if (error.message === "ROLE_NAME_ALREADY_EXISTS") {
        throw new Error("ROLE_NAME_ALREADY_EXISTS");
      }
      await this.pgPoolI.TxRollback(txclient);
      throw new Error(`Failed to create role: ${error.message}`);
    }
  }
  
  // async logRoleHistory(role, updatedby, updatedat, action, previousstate, txclient = null) {
  //   try {
  //     const finalUpdatedBy = updatedby ?? role.updatedby;
  //     const finalUpdatedAt = updatedat ?? role.updatedat;
  //     const currentstate = action === 'DELETE' 
  //       ? {} 
  //       : {
  //           rolename: role.rolename,
  //           roletype: role.roletype,
  //           isenabled: role.isenabled,
  //         };
  //     let query = `
  //       INSERT INTO role_history (accountid, roleid, rolename, roletype, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  //     `;
  //     let result = await txclient.query(query, [role.accountid, role.roleid, role.rolename, role.roletype, role.isenabled, finalUpdatedAt, finalUpdatedBy, action, previousstate, currentstate]);
  //     if (result.rowCount !== 1) {
  //       throw new Error("Failed to log role history");
  //     }
  //     return true;
  //   } catch (error) {
  //     await this.pgPoolI.TxRollback(txclient);
  //     throw new Error(`Failed to log role history: ${error.message}`);
  //   }
  // }

  async updateRole(roleid, accountid, updateFields, updatedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let currtime = new Date();
      let previousStateQuery = `
        SELECT accountid, roleid, rolename, roletype, isenabled FROM roles WHERE accountid = $1 AND roleid = $2
      `;
      let previousStateResult = await txclient.query(previousStateQuery, [accountid, roleid]);
      if (previousStateResult.rowCount === 0) {
        throw new Error("Role not found");
      }
      let previousState = previousStateResult.rows[0];
      let currentState = {
        accountid: accountid,
        roleid: roleid,
        rolename: updateFields.rolename,
        roletype: updateFields.roletype,
        isenabled: updateFields.isenabled,
      };
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      let keys = Object.keys(updateFields);
      let setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(", ");
      let values = Object.values(updateFields);

      let query = `
            UPDATE roles
            SET ${setClause}
            WHERE accountid = $${keys.length + 1} AND roleid = $${
        keys.length + 2
      }
            `;
      let params = [...values, accountid, roleid];
      let result = await txclient.query(query, params);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update role");
      }

      query = `INSERT INTO role_history (accountid, roleid, rolename, roletype, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
      result = await txclient.query(query, [
        currentState.accountid,
        currentState.roleid,
        currentState.rolename,
        currentState.roletype,
        currentState.isenabled,
        currtime,
        updatedby,
        'UPDATE',
        {
          accountid: previousState.accountid,
          roleid: previousState.roleid,
          rolename: previousState.rolename,
          roletype: previousState.roletype,
          isenabled: previousState.isenabled,
        },
        currentState,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to log role history");
      }
      // await this.logRoleHistory(role, updatedby, currtime, 'UPDATE', previousState, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error(`Failed to update role: ${error.message}`);
    }
  }

  async getAllRoles(accountid) {
    try {
      let query = `
            SELECT r.roleid, r.rolename, r.roletype, r.isenabled, r.createdat, u1.displayname as createdby, r.updatedat, u2.displayname as updatedby 
            FROM roles r 
            JOIN users u1 ON r.createdby = u1.userid 
            JOIN users u2 ON r.updatedby = u2.userid
            WHERE r.accountid = $1 
            ORDER BY r.createdat
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve roles");
    }
  }

  async getRoleInfo(accountid, roleid) {
    try {
      let query = `
            SELECT r.roleid, r.rolename, r.roletype, r.isenabled, r.createdat, u1.displayname as createdby, r.updatedat, u2.displayname as updatedby 
            FROM roles r 
            JOIN users u1 ON r.createdby = u1.userid 
            JOIN users u2 ON r.updatedby = u2.userid
            WHERE r.accountid = $1 AND r.roleid = $2
        `;
      let result = await this.pgPoolI.Query(query, [accountid, roleid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to retrieve role");
    }
  }

  // TODO: need to add indexes for this query
  async getAllPlatformModulePerms() {
    try {
      let query = `
            SELECT m.moduleid, m.modulename, mp.permid FROM module m JOIN module_perm mp ON m.moduleid = mp.moduleid
            WHERE m.moduletype = 'platform' AND m.isenabled = true AND mp.isenabled = true ORDER BY m.priority
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve platform module Perms");
    }
  }

  async getRolePermsForAcc(accountid, roleid) {
    try {
      let query = `
            SELECT permid FROM role_perm WHERE accountid = $1 AND roleid = $2
        `;
      let result = await this.pgPoolI.Query(query, [accountid, roleid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve permissions for role");
    }
  }

  async updateRolePerms(
    accountid,
    roleid,
    permsToAdd,
    permsToRemove,
    updatedby
  ) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // Get previous state before any changes
      let stateQuery = `
        SELECT * FROM role_perm WHERE accountid = $1 AND roleid = $2
      `;
      let stateResult = await txclient.query(stateQuery, [accountid, roleid]);
      let previousState = stateResult.rows;
      let previousPermIds = previousState.map(row => row.permid);

      if (permsToAdd.length > 0) {
        let values = [];
        const placeholders = permsToAdd
          .map((permid, index) => {
            // TODO: what if this is too long?
            const startIndex = index * 6 + 1;
            values.push(accountid, roleid, permid, true, currtime, updatedby);
            return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2}, $${
              startIndex + 3
            }, $${startIndex + 4}, $${startIndex + 5})`;
          })
          .join(",");
        let query = `
                    INSERT INTO role_perm (accountid, roleid, permid, isenabled, createdat, createdby) VALUES ${placeholders}
                    ON CONFLICT (accountid, roleid, permid) DO NOTHING
                `;
        let result = await txclient.query(query, values);
        if (result.rowCount !== permsToAdd.length) {
          this.logger.error("Some permissions were not added", {
            accountid: accountid,
            roleid: roleid,
            permsToAdd: permsToAdd,
            permsToRemove: permsToRemove,
            updatedby: updatedby,
          });
        }
      }
      if (permsToRemove.length > 0) {
        let query = `
                    DELETE FROM role_perm WHERE accountid = $1 AND roleid = $2 AND permid = ANY($3)
                `;
        let result = await txclient.query(query, [
          accountid,
          roleid,
          permsToRemove,
        ]);
        if (result.rowCount !== permsToRemove.length) {
          this.logger.error("Some permissions were not removed", {
            accountid: accountid,
            roleid: roleid,
            permsToAdd: permsToAdd,
            permsToRemove: permsToRemove,
            updatedby: updatedby,
          });
        }
      }

      stateResult = await txclient.query(stateQuery, [accountid, roleid]);
      let currentState = stateResult.rows;
      let currentPermIds = currentState.map(row => row.permid);

      let removedPerms = previousPermIds.filter(permid => !currentPermIds.includes(permid));
      let addedPerms = currentPermIds.filter(permid => !previousPermIds.includes(permid));

      for (const permid of removedPerms) {
        let query = `INSERT INTO role_perm_history (accountid, roleid, permid, updatedat, updatedby, isenabled, action) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        let result = await txclient.query(query, [
          accountid,
          roleid,
          permid,
          currtime,
          updatedby,
          false,
          'DISABLED',
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to log role perm history");
        }
      }

      for (const permid of addedPerms) {
        let query = `INSERT INTO role_perm_history (accountid, roleid, permid, updatedat, updatedby, isenabled, action) VALUES ($1, $2, $3, $4, $5, $6, $7)`;
        let result = await txclient.query(query, [
          accountid,
          roleid,
          permid,
          currtime,
          updatedby,
          true,
          'ENABLED',
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to log role perm history");
        }
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
  
  // async logRolePermHistory(accountid, roleid, permid, updatedby, updatedat, action, isenabled, txclient = null) {
  //   try {
  //     let query = `
  //       INSERT INTO role_perm_history (accountid, roleid, permid, updatedat, updatedby, isenabled, action) VALUES ($1, $2, $3, $4, $5, $6, $7)
  //     `;
  //     let result = await txclient.query(query, [accountid, roleid, permid, updatedat, updatedby, isenabled, action]);
  //     if (result.rowCount !== 1) {
  //       throw new Error("Failed to log role perm history");
  //     }
  //     return true;
  //   }
  //   catch (error) {
  //     this.logger.error("role perm history insert failed", { accountid, roleid, permid, err: error });
  //     await this.pgPoolI.TxRollback(txclient);
  //     throw new Error(`Failed to log role perm history: ${error.message}`);
  //   }
  // }

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
      throw new Error("Failed to retrieve username");
    }
  }

  async isRoleAssignedToUsers(roleid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM fleet_user_role WHERE roleid = $1
      `;
      let result = await this.pgPoolI.Query(query, [roleid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check role user assignment");
    }
  }

  async doesRoleHavePermissions(roleid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM role_perm WHERE roleid = $1
      `;
      let result = await this.pgPoolI.Query(query, [roleid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check role permissions");
    }
  }

  async deleteRole(roleid, deletedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let query = `
        SELECT accountid, roleid, rolename, roletype, isenabled FROM roles WHERE roleid = $1
      `;
      let result = await txclient.query(query, [roleid]);
      if (result.rowCount === 0) {
        throw new Error("Role not found");
      }
      let previousState = result.rows[0];
      const role = result.rows[0];

      query = `
        SELECT COUNT(*) as count FROM fleet_user_role WHERE roleid = $1
      `;
      result = await txclient.query(query, [roleid]);
      if (parseInt(result.rows[0].count) > 0) {
        throw new Error("Role is assigned to one or more users");
      }

      query = `
        DELETE FROM role_perm WHERE roleid = $1
      `;
      await txclient.query(query, [roleid]);

      query = `
        DELETE FROM roles WHERE roleid = $1
      `;
      result = await txclient.query(query, [roleid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete role");
      }

      query = `INSERT INTO role_history (accountid, roleid, rolename, roletype, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;
      result = await txclient.query(query, [
        previousState.accountid,
        previousState.roleid,
        previousState.rolename,
        previousState.roletype,
        previousState.isenabled,
        new Date(),
        deletedby,
        'DELETE',
        JSON.stringify(previousState),
        JSON.stringify({}),
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log role history");
      }

      // await this.logRoleHistory(role, deletedby, new Date(), 'DELETE', previousState, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return {
        roleid: roleid,
        rolename: role.rolename,
        deletedat: new Date(),
        deletedby: deletedby,
      };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }
  async getRoleHistory(starttime, endtime) {
    try {
      let query = `
        SELECT a.accountname, r.roleid, r.rolename, r.roletype, r.isenabled, r.updatedat, u.displayname as updatedby, r.action, r.previousstate, r.currentstate 
        FROM role_history r 
        JOIN account a ON r.accountid = a.accountid 
        JOIN users u ON r.updatedby = u.userid 
        WHERE r.updatedat >= $1 AND r.updatedat <= $2
        ORDER BY r.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;

    } catch (error) {
      throw new Error("Failed to retrieve role history");
    }
  }

  async getRolePermHistory(starttime, endtime) {
    try {
      let query = `
        SELECT a.accountname, r.roleid, r.permid, r.isenabled, r.updatedat, u.displayname as updatedby, r.action 
        FROM role_perm_history r 
        JOIN account a ON r.accountid = a.accountid 
        JOIN users u ON r.updatedby = u.userid 
        WHERE r.updatedat >= $1 AND r.updatedat <= $2
        ORDER BY r.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch (error) {
      throw new Error("Failed to retrieve role perm history");
    }
  }
}
