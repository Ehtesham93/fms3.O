import { v4 as uuidv4 } from "uuid";
import {
  ADMIN_ROLE_ID,
  ADMIN_USER_ID,
  EMAIL_PWD_SSO,
  FLEET_INVITE_STATUS,
  FLEET_INVITE_TYPE,
  MOBILE_SSO,
  PASSWORD_EXPIRE_TIME,
  VIEW_ROLE_ID,
  MAHINDRA_SSO,
} from "../../utils/constant.js";
import { markInviteAsExpired } from "../../utils/inviteUtil.js";
const { EncryptPassword } = await import("../../utils/eccutil.js");
import { addPaginationToQuery } from "../../utils/commonutil.js";

export default class UserSvcDB {
  /**
   *
   * @param {PgPool} pgPoolI
   */
  constructor(pgPoolI, config, logger) {
  this.pgPoolI = pgPoolI;
  this.config = config;
  this.logger = logger;
}

// ===========================
// Feedback / Rating Feature - DB Layer
// New Redis + PostgreSQL scheduling model
// ===========================


//this tries to find Redis client from config.
getRedisClient() {
  return (
    this.config?.redisClient ||
    this.config?.redis?.client ||
    this.pgPoolI?.redisClient ||
    null
  );
}


//This reads Radis value for user key ex-> if exists: popup hidden,  if key not exists: Redis Miss
async getRatingPromptCache(cacheKey) {
  try {
    const redisClient = this.getRedisClient();
    if (!redisClient) {
      return null;
    }

    if (typeof redisClient.get === "function") {
      return await redisClient.get(cacheKey);
    }

    return null;
  } catch (error) {
    if (this.logger) {
      this.logger.error("Failed to get rating prompt cache", error);
    }
    return null;
  }
}

 
async setRatingPromptCache(cacheKey, value, ttlSeconds) {
  try {
    //fetch redis client first -> if client is missing → function quietly return  (true) 
    const redisClient = this.getRedisClient();
    if (!redisClient) {
      return true;
    }

    //if ttlSeconds (time-to-live) missing or less than 0 then → no meaning to set cache  → return true.
    if (!ttlSeconds || ttlSeconds <= 0) {
      return true;
    }

    const normalizedValue =
      //if value is null/undefined  → "false"  .Otherwise value will be  string.
      value === null || value === undefined ? "false" : String(value);

    
    //if client has .set() method  (node-redis v4 style) → cache set with expiry (EX)--> means (redis set will node-redis v4 style)
    if (typeof redisClient.set === "function") {
      // node-redis v4 style
      await redisClient.set(cacheKey, normalizedValue, {
        EX: ttlSeconds,
      });
      return true;
    }


    //if client has .setEx() method  (older/alternative style) → cache set with expiry. --> means (redis set will alternative redis client style)
    if (typeof redisClient.setEx === "function") {
      // alternative redis client style
      await redisClient.setEx(cacheKey, ttlSeconds, normalizedValue);
      return true;
    }

    return true;
  } catch (error) { //if any error comes then → inside logger  error will print and return false return.
    if (this.logger) {
      this.logger.error("Failed to set rating prompt cache", error);
    }
    return false;
  }
}

//when want to delete suppression key manually --> if require 
async deleteRatingPromptCache(cacheKey) {
  try {
    const redisClient = this.getRedisClient();
    if (!redisClient) {
      return true;
    }

    if (typeof redisClient.del === "function") {
      await redisClient.del(cacheKey);
      return true;
    }

    return true;
  } catch (error) {
    if (this.logger) {
      this.logger.error("Failed to delete rating prompt cache", error);
    }
    return false;
  }
}

async getLatestRatingFeedback(userid, appName) {
  try {
    const query = `
      SELECT
        feedback_id,
        user_id,
        feedback_category,
        comments,
        rating,
        platform,
        app_name,
        app_version,
        build_number,
        status,
        rating_date,
        next_prompt_date
      FROM devfmscoresch.user_feedback
      WHERE user_id = $1
        AND app_name = $2
        AND feedback_category = 'ratings'
        AND status = true
      ORDER BY rating_date DESC
      LIMIT 1
    `;

    const result = await this.pgPoolI.Query(query, [userid, appName]);

    if (!result || result.rowCount === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    throw new Error("Failed to fetch latest rating feedback");
  }
}

//this query fetches latest row from db -> same user, same app name, feedback_catogery.....
async getLatestRatingFeedbackSchedule(userid, appName) {
  try {
    const query = `
      SELECT
        feedback_id,
        user_id,
        feedback_category,
        comments,
        rating,
        platform,
        app_name,
        app_version,
        build_number,
        status,
        rating_date,
        next_prompt_date
      FROM devfmscoresch.user_feedback
      WHERE user_id = $1
        AND app_name = $2
        AND feedback_category = 'ratings'
        AND status = true
      ORDER BY rating_date DESC
      LIMIT 1
    `;

    const result = await this.pgPoolI.Query(query, [userid, appName]);

    if (!result || result.rowCount === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    throw new Error("Failed to fetch latest rating feedback schedule");
  }
}

//this inserts new row , this is where our post actually stores data 
async addUserFeedback(data) {
  try {
    const query = `
      INSERT INTO devfmscoresch.user_feedback (
        user_id,
        feedback_category,
        comments,
        rating,
        platform,
        app_name,
        app_version,
        build_number,
        status,
        rating_date,
        next_prompt_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;

    const currtime = new Date();

    const result = await this.pgPoolI.Query(query, [
    data.user_id,
    data.feedback_category,
    data.comments || "",
    data.rating,
    data.platform,
    data.app_name || "Nemo3.0",
    data.app_version,
    data.build_number,
    data.status ?? true,
    data.rating_date || currtime,
    data.next_prompt_date || null,
  ]);

    return result.rowCount === 1;
  } catch (error) {
    this.logger?.error("addUserFeedback DB error:", error);
    throw new Error("Failed to add user feedback");
  }
}

  async isValidUser(userid) {
    try {
      let query = `
            SELECT userid FROM users WHERE userid = $1 AND isenabled = true AND isdeleted = false
        `;
      let result = await this.pgPoolI.Query(query, [userid]);
      return result.rowCount === 1;
    } catch (error) {
      throw new Error("Failed to validate user");
    }
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
      throw new Error("Failed to fetch user name");
    }
  }

  // users, emailpwdsso, usersso, user fleet , fleet user role mapping
  async createSuperAdmin(createdby, userid, email, password) {
    let currtime = new Date();
    let [txclient, txnerr] = await this.pgPoolI.StartTransaction();
    if (txnerr) {
      throw txnerr;
    }

    try {
      let query = `
                INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby, acceptedterms) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `;
      // TODO: should superadmin be email, mobile verified?
      let res = await txclient.query(query, [
        userid,
        "Super Admin",
        null,
        {},
        true,
        false,
        false,
        false,
        currtime,
        createdby,
        currtime,
        createdby,
        {},
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }
      let passwordExpireTime = new Date(
        currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
      );

      query = `
                INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
      res = await txclient.query(query, [
        email,
        password,
        userid,
        {},
        passwordExpireTime,
        currtime,
        currtime,
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }

      query = `
                INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
            `;
      res = await txclient.query(query, [
        userid,
        EMAIL_PWD_SSO,
        email,
        currtime,
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }

      let consoleaccountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      // let consoleaccountrootfleetid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      let superadminroleid = ADMIN_ROLE_ID;

      query = `
                SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
            `;
      res = await txclient.query(query, [consoleaccountid]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }

      let consoleaccountrootfleetid = res.rows[0].fleetid;

      // // account_fleet insertion
      // query = `
      //     INSERT INTO account_fleet (accountid, fleetid, isroot, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
      // `;
      // res = await txclient.query(query, [consoleaccountid, consoleaccountrootfleetid, true, currtime, userid]);
      // if (res.rowCount !== 1) {
      //     throw new Error("Failed to create superadmin");
      // }

      query = `
                INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
            `;
      res = await txclient.query(query, [
        consoleaccountid,
        consoleaccountrootfleetid,
        userid,
        superadminroleid,
        currtime,
        createdby,
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      res = await txclient.query(query, [
        consoleaccountid,
        consoleaccountrootfleetid,
        userid,
        superadminroleid,
        true,
        "ADD",
        currtime,
        createdby,
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to log superadmin in history");
      }

      query = `
                INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
            `;
      res = await txclient.query(query, [
        userid,
        consoleaccountid,
        consoleaccountrootfleetid,
      ]);
      if (res.rowCount !== 1) {
        throw new Error("Failed to create superadmin");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
    } catch (err) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw err;
    }
    return true;
  }

  async getUserIdByEmail(email) {
    try {
      let query = `
            SELECT userid FROM email_pwd_sso WHERE ssoid = $1
        `;
      let result = await this.pgPoolI.Query(query, [email]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0].userid;
    } catch (error) {
      throw new Error("Failed to fetch user by email");
    }
  }

  async getUserIdPassByEmail(email) {
    try {
      let query = `
            SELECT e.userid, e.password, e.passwordexpireat, u.usertype FROM email_pwd_sso e JOIN users u ON e.userid = u.userid WHERE e.ssoid = $1
        `;
      let result = await this.pgPoolI.Query(query, [email]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to fetch userId");
    }
  }

async getUserDetails(userid) {
  try {
    let query = `
      SELECT
        u.userid,
        u.displayname,
        u.usertype,
        u.userinfo,
        u.isenabled,
        u.isdeleted,
        u.isemailverified,
        u.ismobileverified,
        u.createdat,
        u1.displayname as createdby,
        u.updatedat,
        u2.displayname as updatedby
      FROM users u
      LEFT JOIN users u1 ON u.createdby = u1.userid
      LEFT JOIN users u2 ON u.updatedby = u2.userid
      WHERE u.userid = $1 AND u.isdeleted = false
    `;
    let result = await this.pgPoolI.Query(query, [userid]);
    if (result.rowCount === 0) {
      return null;
    }
    let user = result.rows[0];

    query = `
      SELECT ssoid, ssotype FROM user_sso WHERE userid = $1
    `;
    result = await this.pgPoolI.Query(query, [userid]);

    for (let row of result.rows) {
      if (row.ssotype === EMAIL_PWD_SSO) {
        user.email = row.ssoid;
      } else if (row.ssotype === MOBILE_SSO) {
        user.mobile = row.ssoid;
      } else if (row.ssotype === MAHINDRA_SSO) {
        user.email = row.ssoid;
      }
    }
    return user;
  } catch (error) {
    throw new Error("Failed to fetch user details");
  }
}

  async getRolePermsForAcc(accountid, userid) {
    try {
      let query = `
            SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      let rootfleetid = result.rows[0].fleetid;

      query = `
            SELECT permid FROM role_perm rp JOIN fleet_user_role fur ON rp.accountid = fur.accountid AND rp.roleid = fur.roleid 
            WHERE rp.accountid = $1 AND fur.accountid = $2 AND fur.fleetid = $3 AND fur.userid = $4 AND rp.isenabled = true
        `;
      result = await this.pgPoolI.Query(query, [
        accountid,
        accountid,
        rootfleetid,
        userid,
      ]);
      let perms = [];
      for (let row of result.rows) {
        perms.push(row.permid);
      }

      query = `
            SELECT mp.permid FROM module m 
            JOIN module_perm mp ON m.moduleid = mp.moduleid 
            WHERE m.modulecode = 'consolemgmt' AND m.isenabled = true AND mp.isenabled = true
        `;
      result = await this.pgPoolI.Query(query);
      let consolemgmtPerms = [];
      for (let row of result.rows) {
        consolemgmtPerms.push(row.permid);
      }

      let filteredPerms = perms.filter((perm) =>
        consolemgmtPerms.includes(perm)
      );

      return filteredPerms;
    } catch (error) {
      throw new Error("Could not retrieve permissions");
    }
  }

  async getRolePermsForAccFleet(accountid, fleetid, userid) {
    try {
      // First check if the current fleet is a root fleet
      let query = `
    SELECT isroot FROM account_fleet WHERE accountid = $1 AND fleetid = $2
    `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        return [];
      }

      const isRoot = result.rows[0].isroot;

      // If it's a root fleet, just check permissions directly
      if (isRoot) {
        query = `
        SELECT permid FROM role_perm rp JOIN fleet_user_role fur ON rp.accountid = fur.accountid AND rp.roleid = fur.roleid 
        WHERE rp.accountid = $1 AND fur.accountid = $2 AND fur.fleetid = $3 AND fur.userid = $4
    `;
        result = await this.pgPoolI.Query(query, [
          accountid,
          accountid,
          fleetid,
          userid,
        ]);
      } else {
        // If it's not a root fleet, check permissions in the current fleet and all parent fleets
        // First, we need to get all parent fleets in the hierarchy
        query = `
        WITH RECURSIVE parent_fleets AS (
            -- Start with the current fleet
            SELECT ft.accountid, ft.pfleetid, ft.fleetid FROM fleet_tree ft
            WHERE ft.accountid = $1 AND ft.fleetid = $2
            
            UNION ALL
            
            -- Recursively get all parent fleets
            SELECT ft.accountid, ft.pfleetid, ft.fleetid FROM fleet_tree ft
            JOIN parent_fleets pf ON ft.fleetid = pf.pfleetid AND ft.accountid = pf.accountid
        )
        -- Now get all permissions for this user in any of these fleets
        SELECT DISTINCT rp.permid 
        FROM parent_fleets pf
        JOIN fleet_user_role fur ON pf.accountid = fur.accountid AND pf.fleetid = fur.fleetid
        JOIN role_perm rp ON fur.accountid = rp.accountid AND fur.roleid = rp.roleid
        WHERE fur.userid = $3
    `;
        result = await this.pgPoolI.Query(query, [accountid, fleetid, userid]);
      }

      let perms = [];
      for (let row of result.rows) {
        perms.push(row.permid);
      }
      return perms;
    } catch (error) {
      throw new Error("Failed to fetch fleet permissions");
    }
  }

  async getPlatformUserRoles(accountid, userid) {
    try {
      let query = `
            SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      let rootfleetid = result.rows[0].fleetid;

      query = `
            SELECT roleid FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3
        `;
      result = await this.pgPoolI.Query(query, [
        accountid,
        rootfleetid,
        userid,
      ]);
      if (result.rowCount === 0) {
        return null;
      }
      let roles = [];
      for (let row of result.rows) {
        roles.push(row.roleid);
      }
      return roles;
    } catch (error) {
      throw new Error("Failed to fetch user roles");
    }
  }

  async getUserRoles(accountid, fleetid, userid) {
    try {
      let query = `
            SELECT roleid FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3
        `;
      let result = await this.pgPoolI.Query(query, [
        accountid,
        fleetid,
        userid,
      ]);
      if (result.rowCount === 0) {
        return null;
      }
      let roles = [];
      for (let row of result.rows) {
        roles.push(row.roleid);
      }
      return roles;
    } catch (error) {
      throw new Error("Failed to fetch user roles");
    }
  }

  // Note: this is not being used anywhere
  async createUser(user, userssoinfo, createdby) {
    let currtime = new Date();
    let [txclient, txnerr] = await this.pgPoolI.StartTransaction();
    if (txnerr) {
      throw txnerr;
    }

    try {
      let query = `
                INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
      let result = await txclient.query(query, [
        user.userid,
        user.displayname,
        user.usertype,
        user.userinfo,
        user.isenabled,
        user.isdeleted,
        user.isemailverified,
        user.ismobileverified,
        currtime,
        createdby,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user");
      }

      if (userssoinfo.email) {
        query = `
                    INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
                `;

        result = await txclient.query(query, [
          user.userid,
          EMAIL_PWD_SSO,
          userssoinfo.email,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create sso info for user");
        }

        let passwordExpireTime = new Date(
          currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
        );

        query = `
                    INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6, $7)
                `;
        result = await txclient.query(query, [
          userssoinfo.email,
          userssoinfo.password,
          user.userid,
          {},
          passwordExpireTime,
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create email password sso info for user");
        }
      }

      if (userssoinfo.mobile) {
        query = `
                    INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
                `;
        result = await txclient.query(query, [
          user.userid,
          MOBILE_SSO,
          userssoinfo.mobile,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create sso info for user");
        }

        query = `
                    INSERT INTO mobile_sso (ssoid, userid, ssoinfo, createdat, updatedat) VALUES ($1, $2, $3, $4, $5)
                `;
        result = await txclient.query(query, [
          userssoinfo.mobile,
          user.userid,
          {},
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create mobile sso info for user");
        }
      }

      let consoleaccountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      let consoleaccountrootfleetid = "ffffffff-ffff-ffff-ffff-ffffffffffff";

      // incase of fresh mobile signup, we need to take the accountid and fleetid from the req
      if (userssoinfo.mobile) {
        if (user.useraccountid) {
          consoleaccountid = user.useraccountid;
        }
        if (user.userfleetid) {
          consoleaccountrootfleetid = user.userfleetid;
        }
      }

      query = `
                INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
            `;
      result = await txclient.query(query, [
        user.userid,
        consoleaccountid,
        consoleaccountrootfleetid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user fleet");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
    } catch (err) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw err;
    }
    return true;
  }

  async createFmsUser(user, userssoinfo, createdby, accountid = null) {
    let currtime = new Date();
    let [txclient, txnerr] = await this.pgPoolI.StartTransaction();
    if (txnerr) {
      throw txnerr;
    }

    try {
      let query = `
                  INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) 
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              `;
      let result = await txclient.query(query, [
        user.userid,
        user.displayname,
        user.usertype,
        user.userinfo,
        user.isenabled,
        user.isdeleted,
        user.isemailverified,
        user.ismobileverified,
        currtime,
        createdby,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user");
      }

      if (userssoinfo.email) {
        query = `
                      INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
                  `;

        result = await txclient.query(query, [
          user.userid,
          EMAIL_PWD_SSO,
          userssoinfo.email,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create sso info for user");
        }

        let passwordExpireTime = new Date(
          currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
        );

        query = `
                      INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6, $7)
                  `;
        result = await txclient.query(query, [
          userssoinfo.email,
          userssoinfo.password,
          user.userid,
          {},
          passwordExpireTime,
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create email password sso info for user");
        }
      }

      if (userssoinfo.mobile) {
        query = `
                      INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
                  `;
        result = await txclient.query(query, [
          user.userid,
          MOBILE_SSO,
          userssoinfo.mobile,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create sso info for user");
        }

        query = `
                      INSERT INTO mobile_sso (ssoid, userid, ssoinfo, createdat, updatedat) VALUES ($1, $2, $3, $4, $5)
                  `;
        result = await txclient.query(query, [
          userssoinfo.mobile,
          user.userid,
          {},
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create mobile sso info for user");
        }
      }
      if (accountid) {
        await this.addUserToAccountWithRole(
          user.userid,
          accountid,
          "admin",
          createdby
        );
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
    } catch (err) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw err;
    }
    return true;
  }

  async addUserToAccountWithRole(userid, accountid, role, createdbyuserid) {
    let currtime = new Date();
    let [txclient, txnerr] = await this.pgPoolI.StartTransaction();
    if (txnerr) {
      throw txnerr;
    }
    try {
      let query = `SELECT * FROM user_fleet WHERE userid = $1 AND accountid = $2`;
      let userfleetresult = await txclient.query(query, [userid, accountid]);
      if (userfleetresult.rowCount > 0) {
        let commiterr = await this.pgPoolI.TxCommit(txclient);
        if (commiterr) {
          throw commiterr;
        }
        return true;
      }

      let rootfleetquery = `
        SELECT fleetid FROM account_fleet 
        WHERE accountid = $1 AND isroot = true
      `;
      let rootfleetresult = await txclient.query(rootfleetquery, [accountid]);
      if (rootfleetresult.rowCount !== 1) {
        throw new Error("Root fleet not found for account");
      }

      let rootfleetid = rootfleetresult.rows[0].fleetid;
      query = `
                INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
            `;
      let result = await txclient.query(query, [
        userid,
        accountid,
        rootfleetid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user fleet");
      }
      let roleid = null;
      if (role === "admin") {
        roleid = ADMIN_ROLE_ID;
      } else if (role === "viewer") {
        roleid = VIEW_ROLE_ID;
      } else {
        throw new Error("Invalid role");
      }

      // before INSERT INTO fleet_user_role …
      const roleCheck = await txclient.query(
        `SELECT roleid FROM roles WHERE accountid = $1 AND roleid = $2`,
        [accountid, roleid]
      );
      if (roleCheck.rowCount !== 1) {
        throw new Error(`Role ${roleid} not found for account ${accountid}`);
      }

      // Add user to fleet_user_role table with roleid
      query = `
        INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      result = await txclient.query(query, [
        accountid,
        rootfleetid,
        userid,
        roleid,
        currtime,
        createdbyuserid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to fleet role");
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        accountid,
        rootfleetid,
        userid,
        roleid,
        true,
        "ADD",
        currtime,
        createdbyuserid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log user to fleet role in history");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return true;
    } catch (error) {
      if (txclient) {
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          throw rollbackerr;
        }
      }
      throw error;
    }
  }

  async getAllUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    try {
      let orderbyclause = `ORDER BY uli.createdat DESC NULLS LAST`;
      if (orderbyfield && orderbydirection) {
        if (orderbyfield === "lastloginat") {
          orderbyfield = "uli.createdat";
        } else if (orderbyfield === "loginvia") {
          orderbyfield = "uli.ssotype";
        } else if (orderbyfield === "email") {
          orderbyfield = "COALESCE(mss.ssoid, eps.ssoid)";
        } else if (orderbyfield === "mobile") {
          orderbyfield = "mps.ssoid";
        } else {
          orderbyfield = `u.${orderbyfield}`;
        }
        orderbyclause = `ORDER BY ${orderbyfield} ${orderbydirection} NULLS LAST`;
      }
      let baseQuery = `
        SELECT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, u.isemailverified, u.ismobileverified, u.createdat, u.createdby, u.updatedat, u.updatedby, COALESCE(mss.ssoid, eps.ssoid) AS email, mps.ssoid as mobile, 
        CASE 
          WHEN uli.ssotype = 'mobile' THEN 'MOBILE_OTP'
          WHEN uli.ssotype = 'mpin' THEN 'MOBILE_MPIN'
          WHEN uli.ssotype = 'email' THEN 'WEB_EMAIL'
          WHEN uli.ssotype = 'superadmin' THEN 'API_TOKEN'
          WHEN uli.ssotype = 'mahindrasso' THEN 'MAHINDRA_SSO'
          ELSE ''
        END as loginvia, 
        COALESCE(uli.createdat::text, '') as lastloginat,
        uli.createdat as lastloginat_raw
        FROM users u
        LEFT JOIN LATERAL (
          SELECT DISTINCT ON (userid) userid, createdat, ssotype
          FROM user_login_audit
          WHERE userid = u.userid
          ORDER BY userid, createdat DESC
        ) uli ON true
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
        WHERE u.isdeleted = false AND (
          UPPER(u.displayname) LIKE '%' || UPPER($1) || '%' OR
          UPPER(eps.ssoid) LIKE '%' || UPPER($1) || '%' OR
          UPPER(mps.ssoid) LIKE '%' || UPPER($1) || '%' OR
          UPPER(mss.ssoid) LIKE '%' || UPPER($1) || '%'
        )
        ${orderbyclause}
      `;
      let result;
      let totalcount;

      if (download) {
        // When downloading, get all data without pagination
        result = await this.pgPoolI.Query(baseQuery, [searchtext]);
        totalcount = result.rowCount;
      } else {
        // Normal pagination flow
        let { query, params } = addPaginationToQuery(baseQuery, offset, limit, [
          searchtext,
        ]);
        result = await this.pgPoolI.Query(query, params);

        const countcquery = `SELECT COUNT(*) FROM users u
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
        WHERE u.isdeleted = false AND (
          UPPER(u.displayname) LIKE '%' || UPPER($1) || '%' OR
          UPPER(eps.ssoid) LIKE '%' || UPPER($1) || '%' OR
          UPPER(mps.ssoid) LIKE '%' || UPPER($1) || '%' OR
          UPPER(mss.ssoid) LIKE '%' || UPPER($1) || '%'
        )`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }

      if (result.rowCount === 0) {
        return {
          users: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: download ? totalcount : limit,
          hasmore: false,
          totalcount: 0,
          totalpages: 0,
        };
      }

      if (download) {
        // Return all data for download
        return {
          users: result.rows,
          previousoffset: 0,
          nextoffset: 0,
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: 1,
        };
      }
      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;
      return {
        users: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw new Error("Failed to fetch users");
    }
  }

  async getUserAccounts(userid) {
    try {
      let query = `
            SELECT uf.accountid, uf.fleetid, a.accountname, ft.name as fleetname FROM user_fleet uf
            JOIN account a ON uf.accountid = a.accountid
            JOIN fleet_tree ft ON uf.fleetid = ft.fleetid
            WHERE uf.userid = $1 ORDER BY a.accountname
        `;
      let result = await this.pgPoolI.Query(query, [userid]);
      let accounts = [];
      for (let row of result.rows) {
        accounts.push({
          accountid: row.accountid,
          fleetid: row.fleetid,
          accountname: row.accountname,
          fleetname: row.fleetname,
        });
      }
      return accounts;
    } catch (error) {
      throw new Error("Faild to fetch user account");
    }
  }

  async getAccountFleetUsers(
    accountid,
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    try {
      let orderbyclause = `ORDER BY u.updatedat DESC NULLS LAST`;
      if (orderbyfield && orderbydirection) {
        if (orderbyfield === "lastloginat") {
          orderbyfield = "u.updatedat";
        } else if (orderbyfield === "email") {
          orderbyfield = "COALESCE(mss.ssoid, eps.ssoid)";
        } else if (orderbyfield === "mobile") {
          orderbyfield = "mps.ssoid";
        } else {
          orderbyfield = `u.${orderbyfield}`;
        }
        orderbyclause = `ORDER BY ${orderbyfield} ${orderbydirection} NULLS LAST`;
      }
      let baseQuery = `
        SELECT DISTINCT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, 
        u.isemailverified, u.ismobileverified, u.createdat, u1.displayname as createdby, u.updatedat, u2.displayname as updatedby,
        COALESCE(mss.ssoid, eps.ssoid) AS email, mps.ssoid as mobile FROM users u
        JOIN fleet_user_role fur ON u.userid = fur.userid
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
        LEFT JOIN users u1 ON u.createdby = u1.userid
        LEFT JOIN users u2 ON u.updatedby = u2.userid
        WHERE fur.accountid = $1 AND u.isdeleted = false AND (
          UPPER(u.displayname) LIKE '%' || UPPER($2) || '%' OR
          UPPER(eps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mss.ssoid) LIKE '%' || UPPER($2) || '%'
        )
        ${orderbyclause}
    `;
      let result;
      let totalcount;
      if (download) {
        // When downloading, get all data without pagination
        result = await this.pgPoolI.Query(baseQuery, [accountid, searchtext]);
        totalcount = result.rowCount;
      } else {
        // Normal pagination flow
        let { query, params } = addPaginationToQuery(baseQuery, offset, limit, [
          accountid,
          searchtext,
        ]);
        result = await this.pgPoolI.Query(query, params);

        const countcquery = `SELECT COUNT(*) FROM users u
      JOIN fleet_user_role fur ON u.userid = fur.userid
      LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
      LEFT JOIN mobile_sso mps ON u.userid = mps.userid
      LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
      WHERE fur.accountid = $1 AND u.isdeleted = false AND (
        UPPER(u.displayname) LIKE '%' || UPPER($2) || '%' OR
        UPPER(eps.ssoid) LIKE '%' || UPPER($2) || '%' OR
        UPPER(mps.ssoid) LIKE '%' || UPPER($2) || '%' OR
        UPPER(mss.ssoid) LIKE '%' || UPPER($2) || '%'
      )`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          accountid,
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }

      if (result.rowCount === 0) {
        return {
          users: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: download ? totalcount : limit,
          hasmore: false,
          totalcount: 0,
          totalpages: 0,
        };
      }

      if (download) {
        // Return all data for download
        return {
          users: result.rows,
          previousoffset: 0,
          nextoffset: 0,
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: 1,
        };
      }
      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;

      return {
        users: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw new Error("Failed to fetch account fleet users");
    }
  }

  async getNonPlatformUsers(
    platformaccountid,
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    try {
      let orderbyclause = `ORDER BY uli.createdat DESC NULLS LAST`;
      if (orderbyfield && orderbydirection) {
        if (orderbyfield === "lastloginat") {
          orderbyfield = "uli.createdat";
        } else if (orderbyfield === "loginvia") {
          orderbyfield = "uli.ssotype";
        } else if (orderbyfield === "email") {
          orderbyfield = "COALESCE(mss.ssoid, eps.ssoid)";
        } else if (orderbyfield === "mobile") {
          orderbyfield = "mps.ssoid";
        } else {
          orderbyfield = `u.${orderbyfield}`;
        }
        orderbyclause = `ORDER BY ${orderbyfield} ${orderbydirection} NULLS LAST`;
      }
      let baseQuery = `
        SELECT DISTINCT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, u.isemailverified, 
        u.ismobileverified, u.createdat, u2.displayname as createdby, u.updatedat, u3.displayname as updatedby, 
        CASE 
          WHEN uli.ssotype = 'mobile' THEN 'MOBILE_OTP'
          WHEN uli.ssotype = 'mpin' THEN 'MOBILE_MPIN'
          WHEN uli.ssotype = 'email' THEN 'WEB_EMAIL'
          WHEN uli.ssotype = 'superadmin' THEN 'API_TOKEN'
          WHEN uli.ssotype = 'mahindrasso' THEN 'MAHINDRA_SSO'
          ELSE ''
        END as loginvia, 
        COALESCE(uli.createdat::text, '') as lastloginat,
        uli.createdat as lastloginat_raw,
        uli.ssotype as loginvia_raw,
        COALESCE(mss.ssoid, eps.ssoid) AS email, mps.ssoid as mobile
        FROM users u
        LEFT JOIN LATERAL (
          SELECT DISTINCT ON (userid) userid, createdat, ssotype
          FROM user_login_audit
          WHERE userid = u.userid
          ORDER BY userid, createdat DESC
        ) uli ON true
        LEFT JOIN fleet_user_role fur ON u.userid = fur.userid
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
        LEFT JOIN users u2 ON u.createdby = u2.userid
        LEFT JOIN users u3 ON u.updatedby = u3.userid
        WHERE fur.accountid != $1 AND u.isdeleted = false AND (
          UPPER(u.displayname) LIKE '%' || UPPER($2) || '%' OR
          UPPER(eps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mss.ssoid) LIKE '%' || UPPER($2) || '%'
        )
        ${orderbyclause}
      `;
      let result;
      let totalcount;
      if (download) {
        // When downloading, get all data without pagination
        result = await this.pgPoolI.Query(baseQuery, [
          platformaccountid,
          searchtext,
        ]);
        totalcount = result.rowCount;
      } else {
        // Normal pagination flow
        let { query, params } = addPaginationToQuery(baseQuery, offset, limit, [
          platformaccountid,
          searchtext,
        ]);
        result = await this.pgPoolI.Query(query, params);

        const countcquery = `SELECT COUNT(*) FROM users u
        LEFT JOIN fleet_user_role fur ON u.userid = fur.userid
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN mahindra_sso mss ON u.userid = mss.userid
        WHERE fur.accountid != $1 AND u.isdeleted = false AND (
          UPPER(u.displayname) LIKE '%' || UPPER($2) || '%' OR
          UPPER(eps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mps.ssoid) LIKE '%' || UPPER($2) || '%' OR
          UPPER(mss.ssoid) LIKE '%' || UPPER($2) || '%'
        )`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          platformaccountid,
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }

      if (result.rowCount === 0) {
        return {
          users: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: download ? totalcount : limit,
          hasmore: false,
          totalcount: 0,
          totalpages: 0,
        };
      }

      if (download) {
        // Return all data for download
        return {
          users: result.rows,
          previousoffset: 0,
          nextoffset: 0,
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: 1,
        };
      }

      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;

      return {
        users: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw new Error("Failed to fetch non-platform users");
    }
  }

  async enableUser(userid, updatedby) {
    try {
      let currtime = new Date();
      let query = `
            UPDATE users SET isenabled = true, updatedat = $1, updatedby = $2 WHERE userid = $3
        `;
      let result = await this.pgPoolI.Query(query, [
        currtime,
        updatedby,
        userid,
      ]);
      return result.rowCount === 1;
    } catch (error) {
      throw new Error("Failed to enable user");
    }
  }

  async disableUser(userid, updatedby) {
    try {
      let currtime = new Date();
      let query = `
            UPDATE users SET isenabled = false, updatedat = $1, updatedby = $2 WHERE userid = $3
        `;
      let result = await this.pgPoolI.Query(query, [
        currtime,
        updatedby,
        userid,
      ]);
      return result.rowCount === 1;
    } catch (error) {
      throw new Error("Failed to disable user");
    }
  }

  async signupWithInvite(inviteid, displayname, encryptedpassword) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      let result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        throw new Error("Invalid invite id");
      }

      let invite = result.rows[0];

      if (invite.invitestatus !== FLEET_INVITE_STATUS.PENDING) {
        throw new Error("Invite is not in sent state");
      }

      // TODO: temporary condition
      if (invite.invitetype !== FLEET_INVITE_TYPE.EMAIL) {
        throw new Error("Invite is not an email invite");
      }

      const inviteemail = invite.contact;
      const inviteexpiresat = invite.expiresat;

      if (new Date(inviteexpiresat) < currtime) {
        this.logger.info(
          `usersvc_db.signupWithInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );

        throw new Error("Invite has expired");
      }

      // check if email already exists
      query = `
                SELECT userid FROM email_pwd_sso WHERE ssoid = $1
            `;
      result = await txclient.query(query, [inviteemail]);
      if (result.rowCount !== 0) {
        throw new Error("Email already exists");
      }

      // move invite to done table
      query = `
          INSERT INTO fleet_invite_done (
              inviteid, accountid, fleetid, contact, roleid, invitetype, 
              invitestatus, createdat, createdby, updatedat, updatedby, inviteduserid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;

      // We'll set the inviteduserid after creating the user
      const userid = uuidv4();

      result = await txclient.query(query, [
        inviteid,
        invite.accountid,
        invite.fleetid,
        invite.contact,
        invite.roleid,
        invite.invitetype,
        FLEET_INVITE_STATUS.ACCEPTED,
        invite.createdat,
        invite.createdby,
        currtime,
        ADMIN_USER_ID,
        userid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to move invite to done table");
      }

      // Then delete from fleet_invite_pending
      query = `
            DELETE FROM fleet_invite_pending 
            WHERE inviteid = $1
        `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete from pending table");
      }

      // create user
      // TODO: deal with ismobileverified
      query = `
                INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
      result = await txclient.query(query, [
        userid,
        displayname,
        null,
        {},
        true,
        false,
        true,
        true,
        currtime,
        ADMIN_USER_ID,
        currtime,
        ADMIN_USER_ID,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user");
      }

      // create email_pwd_sso
      let passwordExpireTime = new Date(
        currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
      );
      query = `
                INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
      result = await txclient.query(query, [
        inviteemail,
        encryptedpassword,
        userid,
        {},
        passwordExpireTime,
        currtime,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create email_pwd_sso");
      }

      query = `
                INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
            `;
      result = await txclient.query(query, [
        userid,
        EMAIL_PWD_SSO,
        inviteemail,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user_sso");
      }

      let fleetid = invite.fleetid;

      if (fleetid == "" || fleetid == null || fleetid == undefined) {
        query = `
                SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
            `;
        result = await txclient.query(query, [invite.accountid]);
        if (result.rowCount !== 1) {
          throw new Error("Root fleet not found");
        }
        fleetid = result.rows[0].fleetid;
      }

      const role = invite.roleid;

      query = `
                    INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
                `;
      result = await txclient.query(query, [userid, invite.accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to fleet");
      }

      query = `
                    INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
                `;
      result = await txclient.query(query, [
        invite.accountid,
        fleetid,
        userid,
        role,
        currtime,
        invite.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to fleet role");
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        invite.accountid,
        fleetid,
        userid,
        role,
        true,
        "ADD",
        currtime,
        invite.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log user to fleet role in history");
      }

      // get userinfo
      query = `
                SELECT userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby FROM users WHERE userid = $1 AND isdeleted = false
            `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount !== 1) {
        throw new Error("Unexpected error while getting userinfo");
      }
      const userinfo = result.rows[0];
      userinfo.email = inviteemail;

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        userinfo: userinfo,
        invitedby: invite.createdby,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async deleteUserRecords(userid, accountid, fleetid, inviteid) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // 1. Insert back into fleet_invite_pending with sent status
      let query = `
        INSERT INTO fleet_invite_pending (
          inviteid, accountid, fleetid, contact, roleid, invitetype, 
          invitestatus, expiresat, createdat, createdby, updatedat, updatedby
        ) 
        SELECT 
          inviteid, accountid, fleetid, contact, roleid, invitetype,
          'sent', CURRENT_TIMESTAMP + INTERVAL '7 days', createdat, createdby, $1, updatedby
        FROM fleet_invite_done 
        WHERE inviteid = $2
      `;
      let result = await txclient.query(query, [currtime, inviteid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }

      query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        throw new Error("Invalid invite id");
      }

      let invite = result.rows[0];

      // 2. Delete from fleet_invite_done
      query = `
       DELETE FROM fleet_invite_done 
       WHERE inviteid = $1
     `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }

      // Now handle user record deletion in reverse order of creation
      // 3. Delete from fleet_user_role (depends on user_fleet)
      query = `
        SELECT roleid FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      result = await txclient.query(query, [accountid, fleetid, userid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to get roleid");
      }
      const roleids = result.rows.map((row) => row.roleid); // array of roleids

      query = `
        DELETE FROM fleet_user_role 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      result = await txclient.query(query, [accountid, fleetid, userid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }
      for (const roleid of roleids) {
        query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          userid,
          roleid,
          false,
          "REMOVE",
          currtime,
          ADMIN_USER_ID,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to log user to fleet role in history");
        }
      }

      // 4. Delete from user_fleet (depends on users)
      query = `
        DELETE FROM user_fleet 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      result = await txclient.query(query, [accountid, fleetid, userid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }

      // 5. Delete from user_sso (depends on users)
      query = `
        DELETE FROM user_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }

      // 6. Delete from email_pwd_sso (depends on users)
      query = `
        DELETE FROM email_pwd_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
      }

      // 7. Finally delete from users table
      query = `
        DELETE FROM users 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        // Not failing here, just logging
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

  async acceptInvite(inviteid, userid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      let result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        let error = new Error("Invalid invite id");
        error.errcode = "INVALID_INVITE_ID";
        throw error;
      }

      let invite = result.rows[0];
      let fleetid = invite.fleetid;

      if (invite.invitestatus !== FLEET_INVITE_STATUS.PENDING) {
        let error = new Error("Invalid invite status");
        error.errcode = "INVITE_NOT_IN_SENT_STATE";
        throw error;
      }

      // TODO: temporary condition
      if (invite.invitetype !== FLEET_INVITE_TYPE.EMAIL) {
        let error = new Error("Invalid invite type");
        error.errcode = "INVITE_NOT_AN_EMAIL_INVITE";
        throw error;
      }

      const inviteemail = invite.contact;
      const inviteexpiresat = invite.expiresat;

      if (new Date(inviteexpiresat) < currtime) {
        this.logger.info(
          `usersvc_db.acceptInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );

        let error = new Error("Invite has expired");
        error.errcode = "INVITE_HAS_EXPIRED";
        throw error;
      }

      const mahindraemail = inviteemail.includes("@mahindra.com");

      if (mahindraemail) {
        query = `
          SELECT userid FROM mahindra_sso WHERE ssoid = $1 or secondaryssoid = $1
        `;
        result = await txclient.query(query, [inviteemail]);
        if (result.rowCount !== 1) {
          let error = new Error("User not found");
          error.errcode = "USER_NOT_FOUND";
          throw error;
        }
      } else {
        query = `
                  SELECT userid FROM email_pwd_sso WHERE ssoid = $1
              `;
        result = await txclient.query(query, [inviteemail]);
        if (result.rowCount !== 1) {
          let error = new Error("User not found");
          error.errcode = "USER_NOT_FOUND";
          throw error;
        }
      }
      const inviteuserid = result.rows[0].userid;

      if (inviteuserid !== userid) {
        let error = new Error("User id does not match");
        error.errcode = "USER_ID_DOES_NOT_MATCH";
        throw error;
      }

      query = `
          INSERT INTO fleet_invite_done (
              inviteid, accountid, fleetid, contact, roleid, invitetype, 
              invitestatus, createdat, createdby, updatedat, updatedby, inviteduserid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;
      result = await txclient.query(query, [
        inviteid,
        invite.accountid,
        invite.fleetid,
        invite.contact,
        invite.roleid,
        invite.invitetype,
        FLEET_INVITE_STATUS.ACCEPTED,
        invite.createdat,
        invite.createdby,
        currtime,
        userid,
        userid,
      ]);
      if (result.rowCount !== 1) {
        let error = new Error("Failed to move invite to done table");
        error.errcode = "FAILED_TO_MOVE_INVITE_TO_DONE";
        throw error;
      }

      query = `
            DELETE FROM fleet_invite_pending 
            WHERE inviteid = $1
        `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        let error = new Error("Failed to delete from pending table");
        error.errcode = "FAILED_TO_DELETE_FROM_PENDING";
        throw error;
      }

      const role = invite.roleid;

      query = `
        INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING
      `;
      result = await txclient.query(query, [userid, invite.accountid, fleetid]);
      if (result.rowCount !== 1) {
        this.logger.error(
          `usersvc_db.acceptInvite: duplicate user_fleet entry to add user to fleet: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, userid: ${userid}`
        );
      }

      query = `
          INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING
        `;
      result = await txclient.query(query, [
        invite.accountid,
        fleetid,
        userid,
        role,
        currtime,
        invite.createdby,
      ]);
      if (result.rowCount !== 1) {
        this.logger.error(
          `usersvc_db.acceptInvite: duplicate fleet_user_role entry to add user to fleet role: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, userid: ${userid}, roleid: ${role}`
        );
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        invite.accountid,
        fleetid,
        userid,
        role,
        true,
        "ADD",
        currtime,
        invite.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log user to fleet role in history");
      }

      // get account name and fleet name for invite text
      query = `
                SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false AND isenabled = true
            `;
      result = await txclient.query(query, [invite.accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found or not enabled");
      }
      const accountname = result.rows[0].accountname;

      query = `
                SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
            `;
      result = await txclient.query(query, [invite.accountid, invite.fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Fleet not found");
      }
      const fleetname = result.rows[0].name;

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        accountid: invite.accountid,
        fleetid: invite.fleetid,
        accountname: accountname,
        fleetname: fleetname,
        email: inviteemail,
        roles: [role], // Convert single role to array for backward compatibility
        invitedby: invite.createdby,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async rejectInvite(inviteid, userid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      let result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        let error = new Error("Invalid invite id");
        error.errcode = "INVALID_INVITE_ID";
        throw error;
      }

      let invite = result.rows[0];

      if (invite.invitestatus !== FLEET_INVITE_STATUS.PENDING) {
        let error = new Error("Invite is not in sent state");
        error.errcode = "INVITE_NOT_IN_SENT_STATE";
        throw error;
      }

      // TODO: temporary condition
      if (invite.invitetype !== FLEET_INVITE_TYPE.EMAIL) {
        let error = new Error("Invite is not an email invite");
        error.errcode = "INVITE_NOT_AN_EMAIL_INVITE";
        throw error;
      }

      const inviteemail = invite.contact;
      const inviteexpiresat = invite.expiresat;

      if (new Date(inviteexpiresat) < currtime) {
        this.logger.info(
          `usersvc_db.rejectInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );

        let error = new Error("Invite has expired");
        error.errcode = "INVITE_HAS_EXPIRED";
        throw error;
      }

      query = `
                UPDATE fleet_invite_pending SET invitestatus = $1, updatedat = $2, updatedby = $3 WHERE inviteid = $4
            `;
      result = await txclient.query(query, [
        FLEET_INVITE_STATUS.REJECTED,
        currtime,
        userid,
        inviteid,
      ]);
      if (result.rowCount !== 1) {
        let error = new Error("Failed to update invite status");
        error.errcode = "FAILED_TO_UPDATE_INVITE_STATUS";
        throw error;
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        inviteid: inviteid,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async addUserToAccount(addedby, contact, accountid, fleetid, roleids = null) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      let contacttype = "";
      let userid = null;

      if (emailRegex.test(contact)) {
        contacttype = "email";
        // Get userid by email
        let query = `
          SELECT userid FROM email_pwd_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount === 0) {
          throw new Error("User with this email not found");
        }
        userid = result.rows[0].userid;
      } else if (indianMobileRegex.test(contact)) {
        contacttype = "mobile";
        // Get userid by mobile
        let query = `
          SELECT userid FROM mobile_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount === 0) {
          throw new Error("User with this mobile number not found");
        }
        userid = result.rows[0].userid;
      } else {
        throw new Error(
          "Invalid contact format. Please provide a valid email or mobile number."
        );
      }

      // Validate that the user exists and is enabled
      let query = `
        SELECT userid FROM users WHERE userid = $1 AND isenabled = true AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount !== 1) {
        throw new Error("User not found or not enabled");
      }

      // Validate that the account exists
      query = `
        SELECT accountid FROM account WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found or not enabled");
      }

      // Get the root fleet for this account
      query = `
        SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Root fleet not found for account");
      }
      let rootfleetid = result.rows[0].fleetid;

      if (fleetid && fleetid !== rootfleetid) {
        rootfleetid = fleetid;
      }

      // Check if user is already added to this account
      query = `
        SELECT userid FROM user_fleet WHERE userid = $1 AND accountid = $2 AND fleetid = $3
      `;
      result = await txclient.query(query, [userid, accountid, fleetid]);
      if (result.rowCount > 0) {
        throw new Error("User is already added to this account and fleet");
      }

      // Add user to user_fleet table
      query = `
        INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
      `;
      result = await txclient.query(query, [userid, accountid, rootfleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to fleet");
      }

      let roleid = ADMIN_ROLE_ID;
      if (roleids && roleids.length > 0) {
        roleid = roleids[0];
      }

      // Add user to fleet_user_role table with roleid
      query = `
        INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      result = await txclient.query(query, [
        accountid,
        rootfleetid,
        userid,
        roleid,
        currtime,
        addedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to fleet role");
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        accountid,
        rootfleetid,
        userid,
        roleid,
        true,
        "ADD",
        currtime,
        addedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log user to fleet role in history");
      }

      // Add record to fleet_invite_done table to track this direct user addition
      const inviteid = uuidv4();

      query = `
              INSERT INTO fleet_invite_done (
                inviteid, accountid, fleetid, contact, roleid, invitetype, 
                invitestatus, createdat, createdby, updatedat, updatedby, inviteduserid
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
      result = await txclient.query(query, [
        inviteid,
        accountid,
        rootfleetid,
        contact,
        ADMIN_ROLE_ID,
        contacttype,
        FLEET_INVITE_STATUS.ACCEPTED,
        currtime,
        addedby,
        currtime,
        addedby,
        userid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create invite done record");
      }

      //Extract the count safely
      const countResult = await txclient.query(
        `
        SELECT COUNT(DISTINCT u.userid) AS user_count
        FROM fleet_user_role fur 
        JOIN users u ON fur.userid = u.userid 
        LEFT JOIN roles r 
          ON fur.accountid = r.accountid 
          AND fur.roleid = r.roleid 
          AND r.isenabled = true
        WHERE fur.accountid = $1 
          AND u.isdeleted = false;
        `,
        [accountid]
      );

      const userCount = countResult.rows[0]?.user_count || 0;

      //Update the 'users' column in account_summary
      await txclient.query(
        `
        UPDATE account_summary 
        SET users = $1 
        WHERE accountid = $2
        `,
        [userCount, accountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        accountid: accountid,
        fleetid: rootfleetid,
        contact: contact,
        contacttype: contacttype,
        addedby: addedby,
        addedat: currtime,
        inviteid: inviteid,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async removeUserFromAccount(removedby, contact, accountid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      let contacttype = "";
      let userid = null;

      if (emailRegex.test(contact)) {
        contacttype = "email";
        // Get userid by email
        let query = `
          SELECT userid FROM email_pwd_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount === 0) {
          throw new Error("User with this email not found");
        }
        userid = result.rows[0].userid;
      } else if (indianMobileRegex.test(contact)) {
        contacttype = "mobile";
        // Get userid by mobile
        let query = `
          SELECT userid FROM mobile_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount === 0) {
          throw new Error("User with this mobile number not found");
        }
        userid = result.rows[0].userid;
      } else {
        throw new Error(
          "Invalid contact format. Please provide a valid email or mobile number."
        );
      }

      if (removedby === userid) {
        throw new Error("Cannot remove yourself from the account");
      }

      // Validate that the user exists
      let query = `
        SELECT userid FROM users WHERE userid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount !== 1) {
        throw new Error("User not found");
      }

      // Validate that the account exists
      query = `
        SELECT accountid FROM account WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found or not enabled");
      }

      // Get the root fleet for this account
      query = `
        SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Root fleet not found for account");
      }
      const rootfleetid = result.rows[0].fleetid;

      // Check if user is actually added to this account
      query = `
        SELECT userid FROM user_fleet WHERE userid = $1 AND accountid = $2
      `;
      result = await txclient.query(query, [userid, accountid]);
      if (result.rowCount === 0) {
        throw new Error("User is not added to this account");
      }

      // Check if user is the last admin in the account (prevent removing the last admin)
      // query = `
      //   SELECT COUNT(*) as admin_count
      //   FROM fleet_user_role
      //   WHERE accountid = $1 AND fleetid = $2 AND roleid = $3
      // `;
      // result = await txclient.query(query, [
      //   accountid,
      //   rootfleetid,
      //   ADMIN_ROLE_ID,
      // ]);
      // const adminCount = parseInt(result.rows[0].admin_count);

      // // Check if the user being removed is an admin
      // query = `
      //   SELECT roleid FROM fleet_user_role
      //   WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      // `;
      // result = await txclient.query(query, [accountid, rootfleetid, userid]);
      // const userRoles = result.rows.map((row) => row.roleid);
      // const isUserAdmin = userRoles.includes(ADMIN_ROLE_ID);

      // // If user is admin and this is the last admin, prevent removal
      // if (isUserAdmin && adminCount <= 1) {
      //   throw new Error("Cannot remove the last admin from the account");
      // }
      // Capture current assignments before delete
      const assignmentsRes = await txclient.query(
        `
        SELECT roleid
        FROM fleet_user_role
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3 
        `,
        [accountid, rootfleetid, userid]
      );
      const roleids = assignmentsRes.rows.map((row) => row.roleid); // array of roleids

      // Remove user from fleet_user_role table
      query = `
        DELETE FROM fleet_user_role 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      result = await txclient.query(query, [accountid, rootfleetid, userid]);
      if (result.rowCount === 0) {
        throw new Error("Failed to remove user from fleet role");
      }

      for (const roleid of roleids) {
        query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        result = await txclient.query(query, [
          accountid,
          rootfleetid,
          userid,
          roleid,
          false,
          "REMOVE",
          currtime,
          removedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to log user to fleet role in history");
        }
      }

      // Remove user from user_fleet table
      query = `
        DELETE FROM user_fleet 
        WHERE userid = $1 AND accountid = $2
      `;
      result = await txclient.query(query, [userid, accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to remove user from fleet");
      }

      //Extract the count safely
      const countResult = await txclient.query(
        `
        SELECT COUNT(DISTINCT u.userid) AS user_count
        FROM fleet_user_role fur 
        JOIN users u ON fur.userid = u.userid 
        LEFT JOIN roles r 
          ON fur.accountid = r.accountid 
          AND fur.roleid = r.roleid 
          AND r.isenabled = true
        WHERE fur.accountid = $1 
          AND u.isdeleted = false;
        `,
        [accountid]
      );

      const userCount = countResult.rows[0]?.user_count || 0;

      //Update the 'users' column in account_summary
      await txclient.query(
        `
        UPDATE account_summary 
        SET users = $1 
        WHERE accountid = $2
        `,
        [userCount, accountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        accountid: accountid,
        fleetid: rootfleetid,
        contact: contact,
        contacttype: contacttype,
        removedby: removedby,
        removedat: currtime,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  // Note: this is not being used anywhere
  async createUserByPlatformAdmin(
    useridtype,
    forceuseridtypeverified,
    contact,
    displayname,
    userinfo,
    createdby
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      if (useridtype !== "email" && useridtype !== "mobile") {
        throw new Error("Invalid useridtype. Must be 'email' or 'mobile'");
      }

      // Validate contact format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      if (useridtype === "email" && !emailRegex.test(contact)) {
        throw new Error("Invalid email format");
      }

      if (useridtype === "mobile" && !indianMobileRegex.test(contact)) {
        throw new Error(
          "Invalid mobile format. Must be a valid Indian mobile number"
        );
      }

      // Check if contact already exists
      if (useridtype === "email") {
        let query = `
          SELECT userid FROM email_pwd_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount > 0) {
          throw new Error("User with this email already exists");
        }
      } else {
        let query = `
          SELECT userid FROM mobile_sso WHERE ssoid = $1
        `;
        let result = await txclient.query(query, [contact]);
        if (result.rowCount > 0) {
          throw new Error("User with this mobile number already exists");
        }
      }

      const userid = uuidv4();
      const isemailverified =
        useridtype === "email" ? forceuseridtypeverified : false;
      const ismobileverified =
        useridtype === "mobile" ? forceuseridtypeverified : false;

      // Create user in users table
      let query = `
        INSERT INTO users (
          userid, displayname, usertype, userinfo, isenabled, isdeleted, 
          isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;
      let result = await txclient.query(query, [
        userid,
        displayname,
        null,
        userinfo,
        true,
        false,
        isemailverified,
        ismobileverified,
        currtime,
        createdby,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user");
      }

      // Create user_sso entry
      query = `
        INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
      `;
      const ssotype = useridtype === "email" ? EMAIL_PWD_SSO : MOBILE_SSO;
      result = await txclient.query(query, [
        userid,
        ssotype,
        contact,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user_sso entry");
      }

      // Create specific SSO entry based on useridtype
      if (useridtype === "email") {
        let passwordExpireTime = new Date(
          currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
        );
        // For email users, we need to create email_pwd_sso entry with a default password
        query = `
          INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) 
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        result = await txclient.query(query, [
          contact,
          this.config.defaultuser.password,
          userid,
          {},
          passwordExpireTime,
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create email_pwd_sso entry");
        }
      } else {
        // For mobile users, create mobile_sso entry
        query = `
          INSERT INTO mobile_sso (ssoid, userid, ssoinfo, createdat, updatedat) 
          VALUES ($1, $2, $3, $4, $5)
        `;
        result = await txclient.query(query, [
          contact,
          userid,
          {},
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create mobile_sso entry");
        }
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        contact: contact,
        useridtype: useridtype,
        displayname: displayname,
        isemailverified: isemailverified,
        ismobileverified: ismobileverified,
        createdby: createdby,
        createdat: currtime,
        needsPasswordChange: useridtype === "email",
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async deleteUserRecordsByUserid(userid, deletedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Capture current assignments before delete
      const assignmentsRes = await txclient.query(
        `
        SELECT accountid, fleetid, roleid
        FROM fleet_user_role
        WHERE userid = $1
        `,
        [userid]
      );
      const assignments = assignmentsRes.rows; // array of assignments

      // 1. Delete from fleet_user_role (if any)
      let query = `
        DELETE FROM fleet_user_role 
        WHERE userid = $1
      `;
      let result = await txclient.query(query, [userid]);

      for (const { accountid, fleetid, roleid } of assignments) {
        query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          userid,
          roleid,
          false,
          "REMOVE",
          currtime,
          deletedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to log user to fleet role in history");
        }
      }

      // 2. Delete from user_fleet (if any)
      query = `
        DELETE FROM user_fleet 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);

      // 3. Delete from user_sso
      query = `
        DELETE FROM user_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);

      // 4. Delete from email_pwd_sso
      query = `
        DELETE FROM email_pwd_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);

      // 5. Delete from mobile_sso
      query = `
        DELETE FROM mobile_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);

      // 6. Finally delete from users table
      query = `
        DELETE FROM users 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("No user record found to delete");
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

  // mobile
  async getUserIdByMobile(mobile) {
    try {
      let query = `
        SELECT ms.userid, um.isenabled as mpin_enabled
        FROM mobile_sso ms
        LEFT JOIN user_mpin um ON ms.userid = um.userid
        WHERE ms.ssoid = $1
      `;
      let result = await this.pgPoolI.Query(query, [mobile]);
      if (result.rowCount === 0) {
        return null;
      }

      return {
        userid: result.rows[0].userid,
        has_mpin: result.rows[0].mpin_enabled !== null,
        mpin_enabled: result.rows[0].mpin_enabled || false,
      };
    } catch (error) {
      throw new Error("Failed to fetch user by mobile");
    }
  }

  async createMobileVerify(verifyid, userid, otp, expiresat, info) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // First, mark any existing unused OTPs for this user and mobile as used
      let query = `
      UPDATE mobile_verify 
      SET isused = true 
      WHERE userid = $1 
        AND operationtype = 'CHANGE'
        AND info->>'mobile' = $2
        AND isused = false
    `;
      await txclient.query(query, [userid, info.mobile]);

      // Now create the new OTP record
      query = `
      INSERT INTO mobile_verify (verifyid, userid, otp, expiresat, info, isused, operationtype)
      VALUES ($1, $2, $3, $4, $5, false, $6)
    `;
      let result = await txclient.query(query, [
        verifyid,
        userid,
        otp,
        expiresat,
        info,
        info.operationtype,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to create mobile verification");
      }

      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to create mobile verification");
    }
  }

  async verifyMobileOtp(userid, otp) {
    if (!userid || !otp) {
      return { success: false, error: "User ID and OTP are required" };
    }

    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Check if user exists and get verification status
      let query = `
        SELECT ismobileverified 
        FROM users 
        WHERE userid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);

      if (result.rowCount === 0) {
        await this.pgPoolI.TxRollback(txclient);
        return { success: false, error: "User not found" };
      }

      // Validate OTP - this determines success/failure
      query = `
        UPDATE mobile_verify 
        SET isused = true 
        WHERE userid = $1 
          AND otp = $2 
          AND isused = false
          AND expiresat >= $3
          AND operationtype = 'VERIFY'
        RETURNING verifyid
      `;
      result = await txclient.query(query, [userid, otp, currtime]);

      if (result.rowCount === 0) {
        await this.pgPoolI.TxRollback(txclient);
        return { success: false, error: "Invalid or expired OTP" };
      }

      // If mobile is not verified, verify it now
      query = `
        UPDATE users 
        SET ismobileverified = true,
            updatedat = $1,
            updatedby = $2
        WHERE userid = $3 AND ismobileverified = false
      `;
      await txclient.query(query, [currtime, userid, userid]);

      await this.pgPoolI.TxCommit(txclient);
      return { success: true };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async setUserDefaults(userid, accountid, recursive, lat, lng, mapzoom) {
    try {
      let currtime = new Date();

      let query = `
        SELECT userinfo FROM users WHERE userid = $1 AND isdeleted = false
      `;
      let result = await this.pgPoolI.Query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      let currentUserinfo = result.rows[0].userinfo || {};

      let newDefaults = {
        accountid: accountid,
        recursive: recursive,
        mapzoom: mapzoom,
        mapcenter: {
          lat: lat,
          lng: lng,
        },
      };

      let updatedUserinfo = {
        ...currentUserinfo,
        default: newDefaults,
      };

      query = `
        UPDATE users 
        SET userinfo = $1, updatedat = $2, updatedby = $3 
        WHERE userid = $4
      `;
      result = await this.pgPoolI.Query(query, [
        updatedUserinfo,
        currtime,
        userid,
        userid,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update user defaults");
      }

      return true;
    } catch (error) {
      throw new Error("Failed to set user defaults: " + error.message);
    }
  }

  async getUserInfo(userid) {
    try {
      let query = `
        SELECT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, u.isemailverified, u.ismobileverified, u1.createdat, u1.displayname as createdby, u1.updatedat, u2.displayname as updatedby 
        FROM users u 
        LEFT JOIN users u1 ON u.createdby = u1.userid
        LEFT JOIN users u2 ON u.updatedby = u2.userid
        WHERE u.userid = $1 AND u.isdeleted = false
      `;
      let result = await this.pgPoolI.Query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      let user = result.rows[0];

      // get email, mobile number
      query = `
            SELECT ssoid, ssotype FROM user_sso WHERE userid = $1
        `;
      result = await this.pgPoolI.Query(query, [userid]);

      for (let row of result.rows) {
        if (row.ssotype === EMAIL_PWD_SSO) {
          user.email = row.ssoid;
        } else if (row.ssotype === MOBILE_SSO) {
          user.mobile = row.ssoid;
        }
      }

      return user;
    } catch (error) {
      throw new Error("Failed to get user info: " + error.message);
    }
  }

  async createPasswordResetToken(userid, resetToken, expiresAt, email) {
    try {
      let currtime = new Date();
      let query = `
        INSERT INTO email_verify (verifyid, userid, expiresat, info, isused, operationtype)
        VALUES ($1, $2, $3, $4, false, 'FP')
      `;
      let result = await this.pgPoolI.Query(query, [
        resetToken,
        userid,
        expiresAt,
        { createdat: currtime, email: email },
      ]);
      return result.rowCount === 1;
    } catch (error) {
      throw new Error(
        "Failed to create password reset token: " + error.message
      );
    }
  }

  async validatePasswordResetToken(resetToken) {
    try {
      let query = `
        SELECT ev.verifyid, ev.userid, ev.expiresat, ev.isused, ev.info,
               u.isenabled, u.isdeleted
        FROM email_verify ev
        JOIN users u ON ev.userid = u.userid
        WHERE ev.verifyid = $1 AND ev.operationtype = 'FP'
      `;
      let result = await this.pgPoolI.Query(query, [resetToken]);
      if (result.rowCount === 0) {
        return null;
      }

      const tokenData = result.rows[0];

      if (tokenData.isdeleted) {
        return {
          ...tokenData,
          userstatus: "deleted",
        };
      }

      if (!tokenData.isenabled) {
        return {
          ...tokenData,
          userstatus: "disabled",
        };
      }

      return {
        ...tokenData,
        userstatus: "active",
      };
    } catch (error) {
      throw new Error(
        "Failed to validate password reset token: " + error.message
      );
    }
  }

  async resetPasswordWithToken(resetToken, newPassword) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT userid, isused FROM email_verify 
        WHERE verifyid = $1 AND operationtype = 'FP'
      `;
      let result = await txclient.query(query, [resetToken]);
      if (result.rowCount === 0) {
        throw new Error("Invalid reset token");
      }

      const resetInfo = result.rows[0];
      if (resetInfo.isused) {
        throw new Error("Reset token has already been used");
      }

      const encryptedPassword = await EncryptPassword(newPassword);

      query = `
        UPDATE email_pwd_sso 
        SET password = $1, updatedat = $2 
        WHERE userid = $3
      `;
      result = await txclient.query(query, [
        encryptedPassword,
        currtime,
        resetInfo.userid,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update password");
      }

      query = `
        UPDATE email_verify 
        SET isused = true 
        WHERE verifyid = $1
      `;
      result = await txclient.query(query, [resetToken]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to mark token as used");
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

  async addPendingEmail(emailTemplate, nextAttempt, nRetriesPending) {
    try {
      let query = `
        INSERT INTO pending_email (email, nextattempt, nretriespending) 
        VALUES ($1, $2, $3)
      `;
      let result = await this.pgPoolI.Query(query, [
        emailTemplate,
        nextAttempt,
        nRetriesPending,
      ]);
      return result.rowCount === 1;
    } catch (error) {
      throw new Error("Failed to add pending email: " + error.message);
    }
  }

  async deleteUser(userid, deletedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // 1. Fetch original user data
      let query = `
        SELECT userid, displayname, usertype, userinfo, isenabled, isdeleted, 
               isemailverified, ismobileverified, acceptedterms, createdat, createdby, updatedat, updatedby
        FROM users WHERE userid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      const originalUserData = result.rows[0];

      // 2. Fetch original SSO data
      query = `
        SELECT us.ssotype, us.ssoid, us.updatedat,
               eps.password, eps.ssoinfo as email_ssoinfo, eps.passwordexpireat, eps.createdat as email_createdat, eps.updatedat as email_updatedat,
               ms.ssoinfo as mobile_ssoinfo, ms.createdat as mobile_createdat, ms.updatedat as mobile_updatedat,
               mms.ssoinfo as mahindra_ssoinfo, mms.createdat as mahindra_createdat, mms.updatedat as mahindra_updatedat
        FROM user_sso us
        LEFT JOIN email_pwd_sso eps ON us.ssoid = eps.ssoid AND us.ssotype = $2
        LEFT JOIN mobile_sso ms ON us.ssoid = ms.ssoid AND us.ssotype = $3
        LEFT JOIN mahindra_sso mms ON us.ssoid = mms.ssoid AND us.ssotype = $4
        WHERE us.userid = $1
      `;
      result = await txclient.query(query, [
        userid,
        EMAIL_PWD_SSO,
        MOBILE_SSO,
        MAHINDRA_SSO,
      ]);
      const originalSsoData = result.rows;

      // Extract email and mobile for fleet invite updates
      let userEmail = null;
      let userMobile = null;
      let userMahindra = null;
      for (const ssoRecord of originalSsoData) {
        if (ssoRecord.ssotype === EMAIL_PWD_SSO) {
          userEmail = ssoRecord.ssoid;
        } else if (ssoRecord.ssotype === MOBILE_SSO) {
          userMobile = ssoRecord.ssoid;
        } else if (ssoRecord.ssotype === MAHINDRA_SSO) {
          userMahindra = ssoRecord.ssoid;
        }
      }

      // 3. Generate timestamp-based placeholder userid
      const timestamp = Date.now();
      const deletedUserId = `Deleted_User_${timestamp}`;

      // 4. Store original data in deleteduser table (using actual userid, not placeholder)
      query = `
        INSERT INTO deleteduser (original_userid, deleteduser_id, original_user_data, original_sso_data, deletedat, deletedby)
        VALUES ($1, $2, $3, $4, $5, $6)
      `;
      result = await txclient.query(query, [
        userid,
        deletedUserId,
        JSON.stringify(originalUserData),
        JSON.stringify(originalSsoData),
        currtime,
        deletedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create deleteduser record");
      }

      // 5. Update user record with placeholder data
      query = `
        UPDATE users 
        SET isdeleted = true, 
            displayname = $1, 
            userinfo = '{}',
            updatedat = $2, 
            updatedby = $3 
        WHERE userid = $4
      `;
      result = await txclient.query(query, [
        deletedUserId,
        currtime,
        deletedby,
        userid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update user record");
      }

      // 6. Update SSO records with placeholder data
      for (const ssoRecord of originalSsoData) {
        const newSsoId = deletedUserId;

        query = `
          UPDATE user_sso 
          SET ssoid = $1, updatedat = $2 
          WHERE userid = $3 AND ssotype = $4
        `;
        await txclient.query(query, [
          newSsoId,
          currtime,
          userid,
          ssoRecord.ssotype,
        ]);

        if (ssoRecord.ssotype === EMAIL_PWD_SSO) {
          query = `
            UPDATE email_pwd_sso 
            SET ssoid = $1, updatedat = $2 
            WHERE userid = $3
          `;
          await txclient.query(query, [newSsoId, currtime, userid]);
        } else if (ssoRecord.ssotype === MOBILE_SSO) {
          query = `
            UPDATE mobile_sso 
            SET ssoid = $1, updatedat = $2 
            WHERE userid = $3
          `;
          await txclient.query(query, [newSsoId, currtime, userid]);
        } else if (ssoRecord.ssotype === MAHINDRA_SSO) {
          query = `
            UPDATE mahindra_sso 
            SET ssoid = $1, secondaryssoid = $1, updatedat = $2 
            WHERE userid = $3
          `;
          await txclient.query(query, [newSsoId, currtime, userid]);
        }
      }

      // 7. Update fleet invite tables with placeholder contact data
      let fleetInviteUpdates = 0;

      // Update fleet_invite_pending table
      if (userEmail) {
        query = `
          UPDATE fleet_invite_pending 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userEmail,
        ]);
        fleetInviteUpdates += result.rowCount;
      }

      if (userMobile) {
        query = `
          UPDATE fleet_invite_pending 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userMobile,
        ]);
        fleetInviteUpdates += result.rowCount;
      }

      if (userMahindra) {
        query = `
          UPDATE fleet_invite_pending 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userMahindra,
        ]);
        fleetInviteUpdates += result.rowCount;
      }
      // Update fleet_invite_done table
      if (userEmail) {
        query = `
          UPDATE fleet_invite_done 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userEmail,
        ]);
        fleetInviteUpdates += result.rowCount;
      }

      if (userMahindra) {
        query = `
          UPDATE fleet_invite_done 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userMahindra,
        ]);
        fleetInviteUpdates += result.rowCount;
      }

      if (userMobile) {
        query = `
          UPDATE fleet_invite_done 
          SET contact = $1, updatedat = $2, updatedby = $3 
          WHERE contact = $4
        `;
        result = await txclient.query(query, [
          deletedUserId,
          currtime,
          deletedby,
          userMobile,
        ]);
        fleetInviteUpdates += result.rowCount;
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        original_displayname: originalUserData.displayname,
        placeholder_userid: deletedUserId,
        deletedat: currtime,
        deletedby: deletedby,
        sso_records_updated: originalSsoData.length,
        fleet_invite_records_updated: fleetInviteUpdates,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async recoverUser(userid, recoveredby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // 1. Check if user is deleted
      let query = `
        SELECT userid, displayname, isdeleted FROM users WHERE userid = $1 AND isdeleted = true
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found or not deleted");
      }

      const user = result.rows[0];

      if (!user.isdeleted) {
        throw new Error("User is not deleted, cannot recover");
      }

      // 2. Fetch original data from deleteduser table using actual userid
      query = `
        SELECT deleteduser_id, original_user_data, original_sso_data 
        FROM deleteduser WHERE original_userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("No deleted user record found for recovery");
      }

      const deletedUserRecord = result.rows[0];
      const originalUserData = JSON.parse(deletedUserRecord.original_user_data);
      const originalSsoData = JSON.parse(deletedUserRecord.original_sso_data);

      // 3. Check for conflicts with existing users/SSO records
      for (const ssoRecord of originalSsoData) {
        let conflictQuery = `
          SELECT userid FROM user_sso 
          WHERE ssoid = $1 AND ssotype = $2 AND userid != $3
        `;
        let conflictResult = await txclient.query(conflictQuery, [
          ssoRecord.ssoid,
          ssoRecord.ssotype,
          userid,
        ]);

        if (conflictResult.rowCount > 0) {
          const error = new Error(
            `SSO conflict: ${ssoRecord.ssoid} already exists for another user`
          );
          error.errcode = "SSO_CONFLICT_EXISTS";
          throw error;
        }
      }

      // 4. Restore original user data
      query = `
        UPDATE users 
        SET isdeleted = false, 
            displayname = $1, 
            usertype = $2,
            userinfo = $3,
            isenabled = $4,
            isemailverified = $5,
            ismobileverified = $6,
            acceptedterms = $7,
            updatedat = $8, 
            updatedby = $9 
        WHERE userid = $10
      `;
      result = await txclient.query(query, [
        originalUserData.displayname,
        originalUserData.usertype,
        originalUserData.userinfo,
        originalUserData.isenabled,
        originalUserData.isemailverified,
        originalUserData.ismobileverified,
        originalUserData.acceptedterms,
        currtime,
        recoveredby,
        userid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to restore user record");
      }

      // 5. Restore original SSO data
      for (const ssoRecord of originalSsoData) {
        query = `
          UPDATE user_sso 
          SET ssoid = $1, updatedat = $2 
          WHERE userid = $3 AND ssotype = $4
        `;
        await txclient.query(query, [
          ssoRecord.ssoid,
          currtime,
          userid,
          ssoRecord.ssotype,
        ]);

        if (ssoRecord.ssotype === EMAIL_PWD_SSO && ssoRecord.password) {
          query = `
            UPDATE email_pwd_sso 
            SET ssoid = $1, 
                password = $2,
                ssoinfo = $3,
                passwordexpireat = $4,
                updatedat = $5 
            WHERE userid = $6
          `;
          await txclient.query(query, [
            ssoRecord.ssoid,
            ssoRecord.password,
            ssoRecord.email_ssoinfo,
            ssoRecord.passwordexpireat,
            currtime,
            userid,
          ]);
        } else if (
          ssoRecord.ssotype === MOBILE_SSO &&
          ssoRecord.mobile_ssoinfo
        ) {
          query = `
            UPDATE mobile_sso 
            SET ssoid = $1,
                ssoinfo = $2,
                updatedat = $3 
            WHERE userid = $4
          `;
          await txclient.query(query, [
            ssoRecord.ssoid,
            ssoRecord.mobile_ssoinfo,
            currtime,
            userid,
          ]);
        }
      }

      // 6. Remove the deleteduser record
      query = `
        DELETE FROM deleteduser WHERE original_userid = $1
      `;
      await txclient.query(query, [userid]);

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        restored_displayname: originalUserData.displayname,
        placeholder_userid: deletedUserRecord.deleteduser_id,
        recoveredat: currtime,
        recoveredby: recoveredby,
        sso_records_restored: originalSsoData.length,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async checkMobileExists(mobile) {
    try {
      let query = `SELECT u.userid FROM mobile_sso ms JOIN users u ON ms.userid = u.userid WHERE u.isdeleted = false AND u.isenabled = true AND ms.ssoid = $1`;
      let result = await this.pgPoolI.Query(query, [mobile]);
      return result.rowCount > 0 ? result.rows[0].userid : null;
    } catch (error) {
      throw new Error("Failed to check if mobile exists");
    }
  }

  async checkUserHasMobile(userid) {
    try {
      let query = `SELECT ssoid FROM user_sso WHERE userid = $1 AND ssotype = $2`;
      let result = await this.pgPoolI.Query(query, [userid, MOBILE_SSO]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error("Failed to check if user has mobile");
    }
  }

  async verifyAndAddMobile(userid, otp, mobile) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `SELECT userid FROM mobile_sso WHERE ssoid = $1`;
      let result = await txclient.query(query, [mobile]);
      if (result.rowCount > 0) {
        await this.pgPoolI.TxRollback(txclient);
        const error = new Error("Mobile number is already in use");
        error.errcode = "MOBILE_ALREADY_EXISTS";
        throw error;
      }

      query = `
        INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) 
        VALUES ($1, $2, $3, $4)
      `;
      result = await txclient.query(query, [
        userid,
        MOBILE_SSO,
        mobile,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user_sso entry");
      }

      query = `
        INSERT INTO mobile_sso (ssoid, userid, ssoinfo, createdat, updatedat) 
        VALUES ($1, $2, $3, $4, $5)
      `;
      result = await txclient.query(query, [
        mobile,
        userid,
        {},
        currtime,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create mobile_sso entry");
      }

      query = `
        UPDATE users 
        SET ismobileverified = true, updatedat = $1, updatedby = $2
        WHERE userid = $3
      `;
      await txclient.query(query, [currtime, userid, userid]);

      await this.pgPoolI.TxCommit(txclient);
      return { success: true };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async checkEmailExists(email) {
    try {
      let query = `SELECT u.userid FROM email_pwd_sso ep JOIN users u ON ep.userid = u.userid WHERE u.isdeleted = false AND u.isenabled = true AND ep.ssoid = $1`;
      let result = await this.pgPoolI.Query(query, [email]);
      return result.rowCount > 0 ? result.rows[0].userid : null;
    } catch (error) {
      throw new Error("Failed to check if email exists");
    }
  }

  async checkUserHasEmail(userid) {
    try {
      let query = `SELECT ssoid FROM user_sso WHERE userid = $1 AND ssotype = 'EMAIL_PWD'`;
      let result = await this.pgPoolI.Query(query, [userid]);
      return result.rowCount > 0 ? result.rows[0].ssoid : null;
    } catch (error) {
      throw new Error("Failed to check if user has email");
    }
  }

  async createEmailVerify(verifyid, userid, email, expiresat) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        UPDATE email_verify 
        SET isused = true 
        WHERE userid = $1 
          AND operationtype = 'CHANGE'
          AND info->>'email' = $2
          AND isused = false
      `;
      await txclient.query(query, [userid, email]);

      query = `
        INSERT INTO email_verify (verifyid, userid, expiresat, info, isused, operationtype)
        VALUES ($1, $2, $3, $4, false, 'CHANGE')
      `;
      let info = {
        email: email,
        operationtype: "CHANGE",
      };
      let result = await txclient.query(query, [
        verifyid,
        userid,
        expiresat,
        info,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to create email verification");
      }

      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to create email verification");
    }
  }

  async verifyAndAddEmail(userid, verifyid, password) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT info 
        FROM email_verify 
        WHERE verifyid = $1 
          AND userid = $2 
          AND isused = false
          AND expiresat >= $3
          AND operationtype = 'CHANGE'
      `;
      let result = await txclient.query(query, [verifyid, userid, currtime]);

      if (result.rowCount === 0) {
        await this.pgPoolI.TxRollback(txclient);
        const error = new Error("Invalid or expired verification ID");
        error.errcode = "INVALID_VERIFICATION";
        throw error;
      }

      const email = result.rows[0].info.email;

      query = `SELECT userid FROM email_pwd_sso WHERE ssoid = $1`;
      result = await txclient.query(query, [email]);
      if (result.rowCount > 0) {
        await this.pgPoolI.TxRollback(txclient);
        const error = new Error("Email is already in use");
        error.errcode = "EMAIL_ALREADY_EXISTS";
        throw error;
      }

      const encryptedPassword = await EncryptPassword(password);

      query = `
        UPDATE email_verify 
        SET isused = true 
        WHERE verifyid = $1
      `;
      await txclient.query(query, [verifyid]);

      query = `
        INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) 
        VALUES ($1, $2, $3, $4)
      `;
      result = await txclient.query(query, [
        userid,
        "EMAIL_PWD",
        email,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create user_sso entry");
      }

      let passwordExpireTime = new Date(
        currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
      );
      query = `
        INSERT INTO email_pwd_sso (ssoid, password, userid, ssoinfo, passwordexpireat, createdat, updatedat) 
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      result = await txclient.query(query, [
        email,
        encryptedPassword,
        userid,
        {},
        passwordExpireTime,
        currtime,
        currtime,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create email_pwd_sso entry");
      }

      query = `
        UPDATE users 
        SET isemailverified = true, updatedat = $1, updatedby = $2
        WHERE userid = $3
      `;
      await txclient.query(query, [currtime, userid, userid]);

      await this.pgPoolI.TxCommit(txclient);
      return { success: true, email: email };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async updateDisplayName(userid, displayname) {
    try {
      let currtime = new Date();
      let query = `
      UPDATE users 
      SET displayname = $1, updatedat = $2, updatedby = $3
      WHERE userid = $4
    `;
      let result = await this.pgPoolI.Query(query, [
        displayname,
        currtime,
        userid,
        userid,
      ]);
      return {
        success: true,
        displayname: displayname,
      };
    } catch (error) {
      throw new Error("Failed to update display name");
    }
  }

  async validateEmailVerification(userid, verifyid) {
    try {
      let currtime = new Date();

      let query = `
        SELECT verifyid, userid, expiresat, isused, info, operationtype 
        FROM email_verify 
        WHERE verifyid = $1 
        AND operationtype = 'CHANGE'
      `;
      let result = await this.pgPoolI.Query(query, [verifyid]);

      if (result.rowCount === 0) {
        return {
          isvalid: false,
          isdifferentuser: false,
          status: "INVALID_VERIFYID",
          message: "Invalid verification ID",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      if (result.rowCount > 1) {
        return {
          isvalid: false,
          isdifferentuser: false,
          status: "DUPLICATE_VERIFYID",
          message: "Duplicate verification ID",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      const verifyidinfo = result.rows[0];
      const email = verifyidinfo.info.email;
      const isused = verifyidinfo.isused;
      const expiresat = verifyidinfo.expiresat;

      if (isused) {
        return {
          isvalid: false,
          isdifferentuser: false,
          status: "COMPLETED_VERIFYID",
          message: "This email verification has already been completed",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      if (expiresat < currtime) {
        return {
          isvalid: false,
          isdifferentuser: false,
          status: "EXPIRED_VERIFYID",
          message:
            "Email verification link has expired. Please request a new verification email",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      if (verifyidinfo.userid !== userid) {
        return {
          isvalid: false,
          isdifferentuser: true,
          status: "INVALID_VERIFYID_USERID",
          message: "Invalid verification ID for this user",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      const existingUserId = await this.checkEmailExists(email);
      if (existingUserId && existingUserId !== userid) {
        return {
          isvalid: false,
          isdifferentuser: false,
          status: "EMAIL_ALREADY_EXISTS",
          message: "This email address is already associated with another user",
          email: null,
          mobile: null,
          expiresat: null,
        };
      }

      let mobile = null;
      try {
        const ssoQuery = `SELECT ssoid FROM user_sso WHERE userid = $1 AND ssotype = $2`;
        const ssoResult = await this.pgPoolI.Query(ssoQuery, [
          verifyidinfo.userid,
          MOBILE_SSO,
        ]);
        if (ssoResult.rowCount > 0) {
          mobile = ssoResult.rows[0].ssoid;
        }
      } catch (error) {
        mobile = null;
      }

      return {
        isvalid: true,
        isdifferentuser: false,
        status: "VALID_VERIFYID",
        message: "Email verification is valid and ready for password setup",
        email: email,
        mobile: mobile,
        expiresat: expiresat,
      };
    } catch (error) {
      return {
        isvalid: false,
        isdifferentuser: false,
        status: "UNKNOWN_ERROR",
        message: "Failed to validate email verification: " + error.message,
        email: null,
        mobile: null,
        expiresat: null,
      };
    }
  }

  async getAcceptedTerms(userid) {
    try {
      let query = `SELECT acceptedterms FROM users WHERE userid = $1`;
      let result = await this.pgPoolI.Query(query, [userid]);
      if (result.rowCount > 0 && result.rows[0].acceptedterms) {
        return result.rows[0].acceptedterms;
      }
      return null;
    } catch (error) {
      throw new Error("Failed to get accepted terms");
    }
  }

  async putAcceptedTerms(userid, acceptedterms) {
    try {
      let query = `UPDATE users SET acceptedterms = $1 WHERE userid = $2`;
      let result = await this.pgPoolI.Query(query, [acceptedterms, userid]);
      return acceptedterms;
    } catch (error) {
      throw new Error("Failed to put accepted terms");
    }
  }

  async getSosContacts() {
    try {
      let query = `
        SELECT 
          contactid,
          contactname,
          contactmobile,
          contactemail,
          priority,
          isactive
        FROM sos_contacts 
        WHERE isactive = true
        ORDER BY priority ASC, contactname ASC
      `;

      let result = await this.pgPoolI.Query(query);

      return result.rows.map((row) => ({
        contactid: row.contactid,
        contactname: row.contactname,
        contactmobile: row.contactmobile,
        contactemail: row.contactemail,
        priority: row.priority,
        isactive: row.isactive,
      }));
    } catch (error) {
      throw new Error("Failed to fetch SOS contacts: " + error.message);
    }
  }

  async setMpin(userid, encryptedMpin, isenabled) {
    let currtime = new Date();

    try {
      let query = `
        INSERT INTO user_mpin (userid, mpin, isenabled, createdat, updatedat)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (userid) 
        DO UPDATE SET 
          mpin = EXCLUDED.mpin,
          isenabled = EXCLUDED.isenabled,
          updatedat = EXCLUDED.updatedat
      `;

      let result = await this.pgPoolI.Query(query, [
        userid,
        encryptedMpin,
        isenabled,
        currtime,
        currtime,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to set MPIN");
      }

      return { success: true };
    } catch (error) {
      throw new Error("Failed to set MPIN: " + error.message);
    }
  }

  async getUserMpin(userid) {
    try {
      let query = `
        SELECT mpin FROM user_mpin 
        WHERE userid = $1 AND isenabled = true
      `;
      let result = await this.pgPoolI.Query(query, [userid]);

      if (result.rowCount === 0) {
        return null;
      }

      return result.rows[0].mpin;
    } catch (error) {
      throw new Error("Failed to get user MPIN: " + error.message);
    }
  }

  async getDocuments() {
    try {
      let query = `
        SELECT 
          id,
          url,
          priority,
          isenabled,
          createdat,
          updatedat
        FROM documents 
        WHERE isenabled = true
        ORDER BY priority ASC, id ASC
      `;

      let result = await this.pgPoolI.Query(query);

      return result.rows.map((row) => ({
        id: row.id,
        url: row.url,
        priority: row.priority,
        isenabled: row.isenabled,
        createdat: row.createdat,
        updatedat: row.updatedat,
      }));
    } catch (error) {
      throw new Error("Failed to fetch documents: " + error.message);
    }
  }

  async getBanners(category) {
    try {
      let query = `
        SELECT 
          id,
          url,
          priority,
          isenabled,
          createdat,
          updatedat
        FROM banners 
        WHERE isenabled = true
        AND category = $1
        ORDER BY priority ASC, id ASC
      `;

      let result = await this.pgPoolI.Query(query, [category]);

      return result.rows.map((row) => ({
        id: row.id,
        url: row.url,
        priority: row.priority,
        isenabled: row.isenabled,
        createdat: row.createdat,
        updatedat: row.updatedat,
      }));
    } catch (error) {
      throw new Error("Failed to fetch banners: " + error.message);
    }
  }

  async updatePasswordWithExpiry(userid, newPassword) {
    let currtime = new Date();
    let passwordExpireAt = new Date(
      currtime.getTime() + PASSWORD_EXPIRE_TIME * 24 * 60 * 60 * 1000
    );

    // if (userid === "3e086a85-e93a-4ed8-bee0-b33e6e8718ce") {
    //   passwordExpireAt = new Date(currtime.getTime() + 1000 * 60 * 2);
    // }

    try {
      let query = `
        UPDATE email_pwd_sso 
        SET password = $1, passwordexpireat = $2, updatedat = $3 
        WHERE userid = $4
      `;
      let result = await this.pgPoolI.Query(query, [
        newPassword,
        passwordExpireAt,
        currtime,
        userid,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update password");
      }

      return true;
    } catch (error) {
      throw new Error("Failed to update password: " + error.message);
    }
  }

  async checkUserLoginSecurity(userid) {
    try {
      const query = `
        SELECT userid, lastvalidlogin, lastinvalidlogin, 
               consecutivefailedcount, islocked, lockeduntil
        FROM user_login_security 
        WHERE userid = $1
      `;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rowCount > 0 ? result.rows[0] : null;
    } catch (error) {
      throw new Error("Failed to check user login security");
    }
  }

  async updateLoginSuccess(userid) {
    try {
      const query = `
        INSERT INTO user_login_security (userid, lastvalidlogin, consecutivefailedcount, islocked, lockeduntil, updatedat)
        VALUES ($1, now(), 0, false, null, now())
        ON CONFLICT (userid) 
        DO UPDATE SET 
          lastvalidlogin = now(),
          consecutivefailedcount = 0,
          islocked = false,
          lockeduntil = null,
          updatedat = now()
        RETURNING *
      `;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to update login success");
    }
  }

  async updateLoginFailure(userid) {
    try {
      const query = `
        INSERT INTO user_login_security (userid, lastinvalidlogin, consecutivefailedcount, updatedat)
        VALUES ($1, now(), 1, now())
        ON CONFLICT (userid) 
        DO UPDATE SET 
          lastinvalidlogin = now(),
          consecutivefailedcount = user_login_security.consecutivefailedcount + 1,
          islocked = CASE 
            WHEN user_login_security.consecutivefailedcount + 1 >= 3 THEN true 
            ELSE false 
          END,
          lockeduntil = CASE 
            WHEN user_login_security.consecutivefailedcount + 1 >= 3 THEN now() + interval '5 minutes'
            ELSE null 
          END,
          updatedat = now()
        RETURNING *
      `;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to update login failure");
    }
  }

  async isUserLocked(userid) {
    try {
      const query = `
        SELECT islocked, lockeduntil, consecutivefailedcount
        FROM user_login_security 
        WHERE userid = $1
      `;
      const result = await this.pgPoolI.Query(query, [userid]);

      if (result.rowCount === 0) {
        return {
          islocked: false,
          lockeduntil: null,
          consecutivefailedcount: 0,
        };
      }

      const record = result.rows[0];

      if (
        record.islocked &&
        record.lockeduntil &&
        new Date() > new Date(record.lockeduntil)
      ) {
        await this.unlockUser(userid);
        return {
          islocked: false,
          lockeduntil: null,
          consecutivefailedcount: 0,
        };
      }

      return record;
    } catch (error) {
      throw new Error("Failed to check if user is locked");
    }
  }

  async unlockUser(userid) {
    try {
      const query = `
        UPDATE user_login_security 
        SET islocked = false, lockeduntil = null, consecutivefailedcount = 0, updatedat = now()
        WHERE userid = $1
        RETURNING *
      `;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to unlock user");
    }
  }

  async logLoginAttempt(
    userid,
    ssotype,
    loginattempt,
    failurereason = null,
    ipaddress = null,
    useragent = null,
    devicefingerprint = null
  ) {
    try {
      const query = `
        INSERT INTO user_login_audit (userid, ssotype, loginattempt, failurereason, ipaddress, useragent, devicefingerprint)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `;
      const result = await this.pgPoolI.Query(query, [
        userid,
        ssotype,
        loginattempt,
        failurereason,
        ipaddress,
        useragent,
        devicefingerprint,
      ]);
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to log login attempt");
    }
  }

  async getUserLoginAuditHistory(userid, limit = 50) {
    try {
      const query = `
        SELECT auditid, userid, ssotype, loginattempt, failurereason, 
               ipaddress, useragent, devicefingerprint, createdat
        FROM user_login_audit 
        WHERE userid = $1
        ORDER BY createdat DESC
        LIMIT $2
      `;
      const result = await this.pgPoolI.Query(query, [userid, limit]);
      return result.rows;
    } catch (error) {
      throw new Error("Failed to get user login audit history");
    }
  }

  async getFailedLoginsBySSO(ssotype, hoursBack = 24) {
    try {
      const query = `
        SELECT COUNT(*) as failed_count
        FROM user_login_audit 
        WHERE ssotype = $1 
          AND loginattempt = 'FAILURE'
          AND createdat >= now() - interval '${hoursBack} hours'
      `;
      const result = await this.pgPoolI.Query(query, [ssotype]);
      return result.rows[0].failed_count;
    } catch (error) {
      throw new Error("Failed to get failed logins by SSO");
    }
  }

  async updateUser(userid, updateFields, updatedby) {
    try {
      const currtime = new Date();

      // Build dynamic query based on fields to update
      const allowedFields = ["displayname", "isenabled", "isemailverified"];
      const fieldsToUpdate = {};

      for (const [key, value] of Object.entries(updateFields)) {
        if (allowedFields.includes(key)) {
          fieldsToUpdate[key] = value;
        }
      }

      if (Object.keys(fieldsToUpdate).length === 0) {
        throw new Error("No valid fields provided for update");
      }

      // Build SET clause dynamically
      const setClause = Object.keys(fieldsToUpdate)
        .map((field, index) => `${field} = $${index + 2}`)
        .join(", ");

      const query = `
        UPDATE users 
        SET ${setClause}, updatedat = $${
        Object.keys(fieldsToUpdate).length + 2
      }, updatedby = $${Object.keys(fieldsToUpdate).length + 3}
        WHERE userid = $1 AND isdeleted = false
        RETURNING userid, displayname, isenabled
      `;

      const values = [
        userid,
        ...Object.values(fieldsToUpdate),
        currtime,
        updatedby,
      ];

      const result = await this.pgPoolI.Query(query, values);

      if (result.rowCount === 0) {
        throw new Error("User not found or already deleted");
      }

      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in updateUser:", error);
      throw error;
    }
  }

  async getUserIdPassByMahindrassoEmail(email) {
    try {
      let query = `
            SELECT ms.userid, ms.ssoid, ms.secondaryssoid, u.usertype, u.displayname, u.isemailverified FROM mahindra_sso ms JOIN users u ON ms.userid = u.userid WHERE LOWER(ms.ssoid) = LOWER($1) or LOWER(ms.secondaryssoid) = LOWER($1)
        `;
      let result = await this.pgPoolI.Query(query, [email]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in getUserIdPassByMahindrassoEmail:", error);
      throw error;
    }
  }

  async getUserIdByMahindrassoEmail(email) {
    try {
      const query = `
        SELECT u.userid, u.isemailverified FROM users u JOIN mahindra_sso ms ON u.userid = ms.userid WHERE u.isdeleted = false AND u.isenabled = true AND (LOWER(ms.ssoid) = LOWER($1) or LOWER(ms.secondaryssoid) = LOWER($1))
      `;
      const result = await this.pgPoolI.Query(query, [email]);
      return result.rowCount > 0 ? result.rows[0] : null;
    } catch (error) {
      this.logger.error("Error in getUserIdByMahindrassoEmail:", error);
      throw error;
    }
  }

  async updateMahindrassoEmail(userid, email, column) {
    try {
      const query = `
        UPDATE mahindra_sso 
        SET ${column} = $1 
        WHERE userid = $2
      `;
      const result = await this.pgPoolI.Query(query, [email, userid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in updateMahindrassoEmail:", error);
      throw error;
    }
  }

  async checkForMahindraSsoUser(userid) {
    try {
      const query = `
        SELECT ms.userid FROM mahindra_sso ms JOIN users u ON ms.userid = u.userid WHERE u.isdeleted = false AND u.isenabled = true AND u.userid = $1
      `;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rowCount > 0;
    } catch (error) {
      this.logger.error("Error in checkForMahindraSsoUser:", error);
      throw error;
    }
  }

  async checkForPendingInvite(email, inviteid) {
    try {
      const query = `
        SELECT * FROM fleet_invite_pending WHERE contact = $1 AND inviteid = $2
      `;
      const result = await this.pgPoolI.Query(query, [email, inviteid]);
      return result.rowCount > 0 ? result.rows[0] : null;
    } catch (error) {
      this.logger.error("Error in checkForPendingInvite:", error);
      throw error;
    }
  }

  async acceptInviteForMahindraSsoFirstLogin(userid, inviteid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      this.logger.error("Failed to start transaction", err);
      throw err;
    }
    try {

      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      let result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
          throw rollbackerr;
        }
        let error = new Error("Invalid invite id");
        error.errcode = "INVALID_INVITE_ID";
        throw error;
      }

      let invite = result.rows[0];
      
      query = `
        INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
        ON CONFLICT (userid, accountid, fleetid) DO NOTHING
      `;
      result = await txclient.query(query, [userid, invite.accountid, invite.fleetid]);

      query = `
          INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (accountid, fleetid, userid, roleid) DO NOTHING
        `;
      result = await txclient.query(query, [
          invite.accountid,
          invite.fleetid,
          userid,
          invite.roleid,
          currtime,
          invite.createdby,
        ]);
      query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        invite.accountid,
        invite.fleetid,
        userid,
        invite.roleid,
        true,
        "ADD",
        currtime,
        invite.createdby,
      ]);
      query = `
          INSERT INTO fleet_invite_done (
              inviteid, accountid, fleetid, contact, roleid, invitetype, 
              invitestatus, createdat, createdby, updatedat, updatedby, inviteduserid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `;
      result = await txclient.query(query, [
        inviteid,
        invite.accountid,
        invite.fleetid,
        invite.contact,
        invite.roleid,
        invite.invitetype,
        FLEET_INVITE_STATUS.ACCEPTED,
        invite.createdat,
        invite.createdby,
        currtime,
        userid,
        userid,
      ]);
      if (result.rowCount !== 1) {
        let error = new Error("Failed to move invite to done table");
        error.errcode = "FAILED_TO_MOVE_INVITE_TO_DONE";
        throw error;
      }

      query = `
            DELETE FROM fleet_invite_pending 
            WHERE inviteid = $1
        `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        let error = new Error("Failed to delete from pending table");
        error.errcode = "FAILED_TO_DELETE_FROM_PENDING";
        throw error;
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return true;
    } catch (error) {
      this.logger.error("Error in acceptInviteForMahindraSsoFirstLogin:", error);
      throw error;
    }
  }
}
