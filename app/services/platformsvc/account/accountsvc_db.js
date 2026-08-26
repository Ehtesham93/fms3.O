import { v4 as uuidv4 } from "uuid";
import {
  ACCOUNT_CREATION_CREDITS,
  ACCOUNT_VEHICLE_SUBSCRIPTION_STATE,
  ADMIN_ROLE_ID,
  FLEET_INVITE_EXPIRY_TIME,
  FLEET_INVITE_STATUS,
  FLEET_INVITE_TYPE,
  VEHICLE_ACTION,
  VIEW_ROLE_ID,
  ADMIN_PERMISSION,
  VIEW_PERMISSION,
} from "../../../utils/constant.js";
import {
  getInviteEmailTemplate,
  isRedundantInvite,
  markInviteAsExpired,
  updateInviteExpiryAndSendEmail,
} from "../../../utils/inviteUtil.js";
import { addPaginationToQuery } from "../../../utils/commonutil.js";
export default class AccountSvcDB {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
  }

  async getLitePackageId(txclient) {
    try {
      let query = `
        SELECT pkgid FROM package 
        WHERE LOWER(pkgname) = 'lite' 
        AND pkgtype = 'standard' 
        AND isenabled = true
      `;
      let result = await txclient.query(query);
      if (result.rowCount !== 1) {
        throw new Error("Lite package not found or multiple packages found");
      }
      return result.rows[0].pkgid;
    } catch (error) {
      throw new Error(`Failed to get Lite package ID: ${error.message}`);
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
      throw new Error(`Unable to retrieve user name`);
    }
  }

  async createAccount(account) {
    let currtime = new Date();
    let accountCreationCredits = ACCOUNT_CREATION_CREDITS;
    if (this.config.credit.accountCreationCredits) {
      accountCreationCredits = this.config.credit.accountCreationCredits;
    }

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // check if account already exists
      let query = `
                SELECT accountid FROM account WHERE accountname = $1 AND isdeleted = false
            `;
      let result = await txclient.query(query, [account.accountname]);
      if (result.rowCount > 0) {
        const error = new Error(
          `Account already exists with accountid: ${result.rows[0].accountid}`
        );
        error.errcode = "ACCOUNT_ALREADY_EXISTS";
        error.errdata = result.rows[0];
        throw error;
      }

      query = `
                INSERT INTO account (accountid, accountname, accounttype, accountinfo, isenabled, createdat, createdby, updatedat, updatedby, accountcategory) 
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `;
      result = await txclient.query(query, [
        account.accountid,
        account.accountname,
        account.accounttype,
        account.accountinfo,
        account.isenabled,
        currtime,
        account.createdby,
        currtime,
        account.createdby,
        account.accountcategory,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to create account");
      }

      // to store rootfleetid and its parentfleetid, we need both those entries in account_fleet
      query = `
                INSERT INTO account_fleet (accountid, fleetid, isroot, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        account.accountid,
        account.rootFleetParentId,
        false,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create account fleet");
      }

      query = `
                INSERT INTO account_fleet (accountid, fleetid, isroot, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        account.accountid,
        account.rootfleetid,
        true,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create account fleet");
      }

      query = `
                INSERT INTO fleet_tree (accountid, pfleetid, fleetid, name, isdeleted, fleetinfo, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `;
      result = await txclient.query(query, [
        account.accountid,
        account.rootFleetParentId,
        account.rootfleetid,
        account.rootFleetName,
        false,
        {},
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create fleet tree");
      }

      // add admin to account root fleet
      let rootFleetAdminRoleId = ADMIN_ROLE_ID;
      let rootFleetViewRoleId = VIEW_ROLE_ID;
      let rootFleetAdminRoleName = "Admin";
      let rootFleetViewRoleName = "Viewer";
      query = `
                INSERT INTO roles (accountid, roleid, rolename, roletype, isenabled, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
      result = await txclient.query(query, [
        account.accountid,
        rootFleetAdminRoleId,
        rootFleetAdminRoleName,
        account.accounttype === "platform" ? "platform" : "account",
        true,
        currtime,
        account.createdby,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add admin to account root fleet");
      }

      // add view role to account root fleet
      result = await txclient.query(query, [
        account.accountid,
        rootFleetViewRoleId,
        rootFleetViewRoleName,
        account.accounttype === "platform" ? "platform" : "account",
        true,
        currtime,
        account.createdby,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add view role to account root fleet");
      }

      // add admin role perm and view role perm
      let adminPermId = ADMIN_PERMISSION;
      let viewPermId = VIEW_PERMISSION;
      query = `
                INSERT INTO role_perm (accountid, roleid, permid, isenabled, createdat, createdby) VALUES ($1, $2, $3, $4, $5, $6)
            `;
      result = await txclient.query(query, [
        account.accountid,
        rootFleetAdminRoleId,
        adminPermId,
        true,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add admin role perm");
      }

      result = await txclient.query(query, [
        account.accountid,
        rootFleetViewRoleId,
        viewPermId,
        true,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add view role perm");
      }

      // add 1000 credits to account
      query = `
                INSERT INTO account_credits (accountid, credits) VALUES ($1, $2) RETURNING credits
            `;
      result = await txclient.query(query, [
        account.accountid,
        accountCreationCredits,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add credits to account");
      }

      const qcredits = result.rows[0].credits;

      query = `
                INSERT INTO account_credits_history (accountid, targetdate, updatedat, deltacredits, closingcredits, pkginfo, txninfo, totalvehicles, subscribedvehicles, connectedvehicles, comment, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
      result = await txclient.query(query, [
        account.accountid,
        currtime,
        currtime,
        accountCreationCredits,
        qcredits,
        {},
        {},
        0,
        0,
        0,
        "Account Created",
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add credits history to account");
      }

      // Create subscription for lite package
      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 5);

      const liteSubscriptionInfo = {
        startdate: currtime.toISOString(),
        enddate: endDate.toISOString(),
      };

      const litePackageId = await this.getLitePackageId(txclient);

      query = `
                INSERT INTO account_package_subscription (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        account.accountid,
        litePackageId,
        liteSubscriptionInfo,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to assign lite package to account");
      }

      // Add subscription to history
      query = `
                INSERT INTO account_package_subscription_history (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        account.accountid,
        litePackageId,
        liteSubscriptionInfo,
        currtime,
        account.createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create lite package subscription history");
      }

      query = `
                INSERT INTO account_summary (accountid, users, vehicles, subscribed, packagename) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        account.accountid,
        0,
        0,
        0,
        "Lite",
      ]);

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

  async getAllAccounts(platformAccountId, offset, limit, searchtext) {
    try {
      // TODO: ideally we should not return platform account
      let baseQuery = `
            SELECT DISTINCT a.accountid, a.accountname, a.updatedat
            FROM account a
            LEFT JOIN account_credits ac ON a.accountid = ac.accountid
            LEFT JOIN account_package_subscription aps ON a.accountid = aps.accountid
            LEFT JOIN package p ON aps.pkgid = p.pkgid
            LEFT JOIN account_fleet af ON a.accountid = af.accountid
            LEFT JOIN fleet_vehicle fv ON af.accountid = fv.accountid AND af.fleetid = fv.fleetid
            LEFT JOIN fleet_user_role fur ON a.accountid = fur.accountid
            LEFT JOIN users u ON fur.userid = u.userid
            LEFT JOIN user_sso us ON u.userid = us.userid
            WHERE a.accounttype = 'customer' AND a.isdeleted = false AND (
            UPPER(a.accountname) LIKE '%' || $1 || '%' OR
            UPPER(p.pkgname) LIKE '%' || $1 || '%' OR
            UPPER(u.displayname) LIKE '%' || $1 || '%' OR
            UPPER(fv.vinno) LIKE '%' || $1 || '%' OR
            UPPER(us.ssoid) LIKE '%' || $1 || '%' OR
            CAST(ac.credits AS TEXT) LIKE '%' || $1 || '%')
            ORDER BY a.updatedat DESC
            OFFSET $2 LIMIT $3`;
      let params = [searchtext, offset, limit];
      let result = await this.pgPoolI.Query(baseQuery, params);
      if (result.rowCount === 0) {
        return {
          accounts: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: limit,
          hasmore: false,
          totalcount: 0,
          totalpages: 0,
        };
      }
      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;
      const countcquery = `SELECT COUNT(DISTINCT a.accountid)
            FROM account a
            LEFT JOIN account_credits ac ON a.accountid = ac.accountid
            LEFT JOIN account_package_subscription aps ON a.accountid = aps.accountid
            LEFT JOIN package p ON aps.pkgid = p.pkgid
            LEFT JOIN account_fleet af ON a.accountid = af.accountid
            LEFT JOIN fleet_vehicle fv ON af.accountid = fv.accountid AND af.fleetid = fv.fleetid
            LEFT JOIN fleet_user_role fur ON a.accountid = fur.accountid
            LEFT JOIN users u ON fur.userid = u.userid
            LEFT JOIN user_sso us ON u.userid = us.userid
            WHERE a.accounttype = 'customer' AND a.isdeleted = false AND (
            UPPER(a.accountname) LIKE '%' || $1 || '%' OR
            UPPER(p.pkgname) LIKE '%' || $1 || '%' OR
            UPPER(u.displayname) LIKE '%' || $1 || '%' OR
            UPPER(fv.vinno) LIKE '%' || $1 || '%' OR
            UPPER(us.ssoid) LIKE '%' || $1 || '%' OR
            CAST(ac.credits AS TEXT) LIKE '%' || $1 || '%')`;
      const countcresult = await this.pgPoolI.Query(countcquery, [searchtext]);
      const totalcount = parseInt(countcresult.rows[0].count);
      return {
        accounts: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  async getAccountOverview(accountid) {
    try {
      let query = `
            SELECT a.accountid, a.accountname, a.accounttype, a.accountinfo, a.accountcategory, a.isenabled, a.createdat, u1.displayname as createdby, a.updatedat, u2.displayname as updatedby 
            FROM account a 
            JOIN users u1 ON a.createdby = u1.userid 
            JOIN users u2 ON a.updatedby = u2.userid
            WHERE a.accountid = $1 AND a.isdeleted = false
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to load account overview");
    }
  }

  async updateAccount(accountid, updateFields, updatedby) {
    try {
      let currtime = new Date();
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      const setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 2}`)
        .join(", ");

      const query = `UPDATE account SET ${setClause} WHERE accountid = $1`;
      const params = [accountid, ...Object.values(updateFields)];

      let result = await this.pgPoolI.Query(query, params);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update account");
      }

      return true;
    } catch (error) {
      throw new Error(`Account update failed: ${error.message}`);
    }
  }

  async deleteAccount(accountid, deletedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT accountid, accountname, isdeleted FROM account WHERE accountid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found");
      }

      const account = result.rows[0];
      if (account.isdeleted) {
        throw new Error("Account is already deleted");
      }

      query = `
        SELECT COUNT(*) as vehicle_count FROM fleet_vehicle WHERE accountid = $1
      `;
      result = await txclient.query(query, [accountid]);
      const vehicleCount = parseInt(result.rows[0].vehicle_count);

      if (vehicleCount > 0) {
        throw new Error(
          `Cannot delete account. ${vehicleCount} vehicle(s) are still assigned to this account. Please remove all vehicles before deleting the account.`
        );
      }

      const timestamp = Date.now();
      const deletedaccountName = `Deleted_Account_${timestamp}`;

      query = `
        UPDATE account SET 
          isdeleted = true, 
          accountname = $1,
          updatedat = $2, 
          updatedby = $3 
        WHERE accountid = $4
      `;
      result = await txclient.query(query, [
        deletedaccountName,
        currtime,
        deletedby,
        accountid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to delete account");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid: accountid,
        accountname: account.accountname,
        deletedat: currtime,
        deletedby: deletedby,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async getAccountVehicleCount(accountid) {
    let query = `
      SELECT COUNT(*) as vehicle_count FROM fleet_vehicle WHERE accountid = $1
    `;
    let result = await this.pgPoolI.Query(query, [accountid]);
    return parseInt(result.rows[0].vehicle_count);
  }

  async getAccountInfo(accountid) {
    let query = `
        SELECT accountid, accountname, isdeleted FROM account WHERE accountid = $1 AND isdeleted = false
      `;
    let result = await this.pgPoolI.Query(query, [accountid]);
    if (result.rowCount !== 1) {
      return null;
    }
    return result.rows[0];
  }

  async triggerEmailInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // get root fleet id
      let query = `
                    SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
                `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account root fleet not found");
      }
      const fleetid = result.rows[0].fleetid;

      // check if email already exists in user sso table
      let redundantInvite = await isRedundantInvite(
        accountid,
        fleetid,
        email,
        roleids,
        txclient
      );
      if (redundantInvite) {
        this.logger.info(
          `accountsvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
        );
        throw new Error("Email already invited to fleet with same role");
      }

      // Check for existing pending invites for this email and role combinations
      query = `
                    SELECT inviteid, invitestatus, roleid, expiresat FROM fleet_invite_pending 
                    WHERE accountid = $1 AND fleetid = $2 AND contact = $3 AND invitetype = $4 AND invitestatus = $5 AND roleid = ANY($6)
                `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        email,
        FLEET_INVITE_TYPE.EMAIL,
        FLEET_INVITE_STATUS.PENDING,
        roleids,
      ]);

      if (result?.rows?.length > 0) {
        let inviteToUpdate = null;

        for (const row of result.rows) {
          // mark the invite as expired if it's expired
          if (new Date(row.expiresat) < currtime) {
            this.logger.info(
              `accountsvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
            );
            await markInviteAsExpired(
              accountid,
              fleetid,
              row.inviteid,
              currtime,
              FLEET_INVITE_STATUS.EXPIRED,
              txclient
            );
          } else {
            // if we find a matching role, we can update that invite
            if (roleids.includes(row.roleid) && !inviteToUpdate) {
              inviteToUpdate = row;
            }
          }
        }

        if (inviteToUpdate) {
          // update the expiry and trigger email again and exit
          this.logger.info(
            `accountsvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
          );
          let res = await updateInviteExpiryAndSendEmail(
            accountid,
            fleetid,
            inviteToUpdate.inviteid,
            { email: email, roleid: inviteToUpdate.roleid },
            currtime,
            headerReferer,
            email,
            txclient
          );

          let commiterr = await this.pgPoolI.TxCommit(txclient);
          if (commiterr) {
            throw commiterr;
          }
          return {
            accountid: accountid,
            fleetid: fleetid,
            inviteid: inviteToUpdate.inviteid,
            success: true,
            isUpdated: true,
          };
        }
      }

      this.logger.info(
        `accountsvc_db.triggerEmailInviteToRootFleet: Sending new invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
      );

      let expiresat = new Date(currtime.getTime() + FLEET_INVITE_EXPIRY_TIME);

      // Insert invites for each role (since new schema stores one role per row)
      for (const roleid of roleids) {
        query = `
                      INSERT INTO fleet_invite_pending (inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby) 
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                  `;
        result = await txclient.query(query, [
          inviteid,
          accountid,
          fleetid,
          email,
          roleid,
          FLEET_INVITE_TYPE.EMAIL,
          FLEET_INVITE_STATUS.PENDING,
          expiresat,
          currtime,
          invitedby,
          currtime,
          invitedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create invite pending record");
        }
      }

      query = `
                    SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false
                `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found");
      }
      const accountname = result.rows[0].accountname;

      query = `
                    SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
                `;
      result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Fleet not found");
      }
      const fleetname = result.rows[0].name;

      // get email invite template
      let emailTemplate = await getInviteEmailTemplate(
        accountid,
        fleetid,
        inviteid,
        accountname,
        fleetname,
        headerReferer,
        email
      );

      query = `
                    INSERT INTO pending_email (email, nextattempt, nretriespending) VALUES ($1, $2, $3)
                `;
      result = await txclient.query(query, [emailTemplate, currtime, 5]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create pending email");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return {
        accountid: accountid,
        fleetid: fleetid,
        inviteid: inviteid,
        success: true,
        isUpdated: false,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  // for now this api is checking if the mahindrasso id already exists in the user sso table and creating a new user if it doesn't exist and finally adding the user to the fleet with admin role
  // TODO: later we need to change this api flow
  async triggerMahindrassoInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
                    SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
                `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account root fleet not found");
      }
      let fleetid = result.rows[0].fleetid;

      // check if email already exists in user sso table
      let redundantInvite = await isRedundantInvite(
        accountid,
        fleetid,
        email,
        roleids,
        txclient
      );
      if (redundantInvite) {
        this.logger.info(
          `accountsvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
        );
        throw new Error("Email already invited to fleet with same role");
      }

      // Check if mahindrasso id already exists in user sso table
      query = `
        SELECT userid FROM mahindra_sso WHERE ssoid = $1 or secondaryssoid = $1
      `;
      result = await txclient.query(query, [email]);
      let existingUser = null;

      if (result.rowCount > 0) {
        // User already exists, get user details
        existingUser = result.rows[0].userid;
      } else {
        // Create new user with mobile number
        const userid = uuidv4();

        // Create user record
        query = `
          INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        result = await txclient.query(query, [
          userid,
          email,
          null,
          {},
          true,
          false,
          false,
          false,
          currtime,
          invitedby,
          currtime,
          invitedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create user");
        }

        // Create mobile_sso record
        query = `
          INSERT INTO mahindra_sso (ssoid, userid, ssoinfo, secondaryssoid, createdat, updatedat) VALUES ($1, $2, $3, $4, $5, $6)
        `;
        result = await txclient.query(query, [
          email,
          userid,
          {},
          email,
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create mobile sso");
        }

        // Create user_sso record
        query = `
          INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
        `;
        result = await txclient.query(query, [
          userid,
          "MAHINDRA_SSO",
          email,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create user sso");
        }

        existingUser = userid;
      }

      // Check for existing pending invites for this email and role combinations
      query = `
                    SELECT inviteid, invitestatus, roleid, expiresat FROM fleet_invite_pending 
                    WHERE accountid = $1 AND fleetid = $2 AND contact = $3 AND invitetype = $4 AND invitestatus = $5 AND roleid = ANY($6)
                `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        email,
        FLEET_INVITE_TYPE.EMAIL,
        FLEET_INVITE_STATUS.PENDING,
        roleids,
      ]);

      if (result?.rows?.length > 0) {
        let inviteToUpdate = null;

        for (const row of result.rows) {
          // mark the invite as expired if it's expired
          if (new Date(row.expiresat) < currtime) {
            this.logger.info(
              `accountsvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
            );
            await markInviteAsExpired(
              accountid,
              fleetid,
              row.inviteid,
              currtime,
              FLEET_INVITE_STATUS.EXPIRED,
              txclient
            );
          } else {
            // if we find a matching role, we can update that invite
            if (roleids.includes(row.roleid) && !inviteToUpdate) {
              inviteToUpdate = row;
            }
          }
        }

        if (inviteToUpdate) {
          // update the expiry and trigger email again and exit
          this.logger.info(
            `accountsvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
          );
          let res = await updateInviteExpiryAndSendEmail(
            accountid,
            fleetid,
            inviteToUpdate.inviteid,
            { email: email, roleid: inviteToUpdate.roleid },
            currtime,
            headerReferer,
            email,
            txclient
          );

          let commiterr = await this.pgPoolI.TxCommit(txclient);
          if (commiterr) {
            throw commiterr;
          }
          return {
            accountid: accountid,
            fleetid: fleetid,
            inviteid: inviteToUpdate.inviteid,
            success: true,
            isUpdated: true,
          };
        }
      }

      this.logger.info(
        `accountsvc_db.triggerEmailInviteToRootFleet: Sending new invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
      );

      let expiresat = new Date(currtime.getTime() + FLEET_INVITE_EXPIRY_TIME);

      // Insert invites for each role (since new schema stores one role per row)
      for (const roleid of roleids) {
        query = `
                      INSERT INTO fleet_invite_pending (inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby) 
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                  `;
        result = await txclient.query(query, [
          inviteid,
          accountid,
          fleetid,
          email,
          roleid,
          FLEET_INVITE_TYPE.EMAIL,
          FLEET_INVITE_STATUS.PENDING,
          expiresat,
          currtime,
          invitedby,
          currtime,
          invitedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create invite pending record");
        }
      }

      query = `
                    SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false
                `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found");
      }
      const accountname = result.rows[0].accountname;

      query = `
                    SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
                `;
      result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Fleet not found");
      }
      const fleetname = result.rows[0].name;

      // get email invite template
      let emailTemplate = await getInviteEmailTemplate(
        accountid,
        fleetid,
        inviteid,
        accountname,
        fleetname,
        headerReferer,
        email
      );

      query = `
                    INSERT INTO pending_email (email, nextattempt, nretriespending) VALUES ($1, $2, $3)
                `;
      result = await txclient.query(query, [emailTemplate, currtime, 5]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create pending email");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid: accountid,
        fleetid: fleetid,
        email: email,
        inviteid: inviteid,
        success: true,
        isUpdated: false,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  // for now this api is checking if the mobile number already exists in the user sso table and creating a new user if it doesn't exist and finally adding the user to the fleet with admin role
  // TODO: later we need to change this api flow
  async triggerMobileInviteToRootFleet(
    accountid,
    inviteid,
    mobile,
    invitedby,
    roleids,
    headerReferer
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Check if mobile number already exists in user sso table
      let query = `
        SELECT userid FROM mobile_sso WHERE ssoid = $1
      `;
      let result = await txclient.query(query, [mobile]);
      let existingUser = null;

      if (result.rowCount > 0) {
        // User already exists, get user details
        existingUser = result.rows[0].userid;
      } else {
        // Create new user with mobile number
        const userid = uuidv4();

        // Create user record
        query = `
          INSERT INTO users (userid, displayname, usertype, userinfo, isenabled, isdeleted, isemailverified, ismobileverified, createdat, createdby, updatedat, updatedby) 
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        result = await txclient.query(query, [
          userid,
          mobile,
          null,
          {},
          true,
          false,
          false,
          false,
          currtime,
          invitedby,
          currtime,
          invitedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create user");
        }

        // Create mobile_sso record
        query = `
          INSERT INTO mobile_sso (ssoid, userid, ssoinfo, createdat, updatedat) VALUES ($1, $2, $3, $4, $5)
        `;
        result = await txclient.query(query, [
          mobile,
          userid,
          {},
          currtime,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create mobile sso");
        }

        // Create user_sso record
        query = `
          INSERT INTO user_sso (userid, ssotype, ssoid, updatedat) VALUES ($1, $2, $3, $4)
        `;
        result = await txclient.query(query, [
          userid,
          "MOBILE",
          mobile,
          currtime,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create user sso");
        }

        existingUser = userid;
      }

      // Get root fleet id
      query = `
        SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account root fleet not found");
      }
      const fleetid = result.rows[0].fleetid;

      // Add user to account root fleet with the specified roles
      // First, add user to user_fleet
      query = `
        INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
        ON CONFLICT (userid, accountid, fleetid) DO NOTHING
      `;
      result = await txclient.query(query, [existingUser, accountid, fleetid]);

      // Add user roles for each role in roleids
      for (const roleid of roleids) {
        query = `
          INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (accountid, fleetid, userid, roleid) DO NOTHING
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          existingUser,
          roleid,
          currtime,
          invitedby,
        ]);
      }

      // Add record to fleet_invite_done table since we directly added the user
      for (const roleid of roleids) {
        query = `
          INSERT INTO fleet_invite_done (
            inviteid, accountid, fleetid, contact, roleid, invitetype, 
            invitestatus, createdat, createdby, updatedat, updatedby, inviteduserid
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        result = await txclient.query(query, [
          inviteid,
          accountid,
          fleetid,
          mobile,
          roleid,
          FLEET_INVITE_TYPE.MOBILE,
          FLEET_INVITE_STATUS.ACCEPTED,
          currtime,
          invitedby,
          currtime,
          invitedby,
          existingUser,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create invite done record");
        }
        query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          existingUser,
          roleid,
          true,
          "ADD",
          currtime,
          invitedby,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to create fleet user role history record");
        }
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid: accountid,
        fleetid: fleetid,
        mobile: mobile,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async resendInvite(accountid, inviteid, invitedby, headerReferer) {
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
        const error = new Error("Invalid invite id");
        error.errcode = "INVALID_INVITE_ID";
        throw error;
      }

      let invite = result.rows[0];

      if (invite.invitestatus !== FLEET_INVITE_STATUS.PENDING) {
        const error = new Error("Invite is not in sent state");
        error.errcode = "INVITE_NOT_IN_SENT_STATE";
        throw error;
      }

      // TODO: temporary condition
      if (invite.invitetype !== FLEET_INVITE_TYPE.EMAIL) {
        const error = new Error("Invite is not an email invite");
        error.errcode = "INVITE_NOT_AN_EMAIL_INVITE";
        throw error;
      }

      if (new Date(invite.expiresat) < currtime) {
        this.logger.info(
          `accountsvc_db.resendInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );
        const error = new Error("Cannot resend an expired invite");
        error.errcode = "CANNOT_RESEND_AN_EXPIRED_INVITE";
        throw error;
      }

      let expiresat = new Date(currtime.getTime() + FLEET_INVITE_EXPIRY_TIME);

      // Update expiry in fleet_invite_pending
      query = `
                    UPDATE fleet_invite_pending SET expiresat = $1, updatedat = $2, updatedby = $3 WHERE inviteid = $4
                `;
      result = await txclient.query(query, [
        expiresat,
        currtime,
        invitedby,
        inviteid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update invite expiry");
      }

      // get account name and fleet name for invite text
      query = `
                    SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false
                `;
      result = await txclient.query(query, [invite.accountid]);
      if (result.rowCount !== 1) {
        const error = new Error("Account not found");
        error.errcode = "ACCOUNT_NOT_FOUND";
        throw error;
      }
      const accountname = result.rows[0].accountname;

      query = `
                    SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
                `;
      result = await txclient.query(query, [invite.accountid, invite.fleetid]);
      if (result.rowCount !== 1) {
        const error = new Error("Fleet not found");
        error.errcode = "FLEET_NOT_FOUND";
        throw error;
      }
      const fleetname = result.rows[0].name;

      // get email invite template
      let emailTemplate = await getInviteEmailTemplate(
        invite.accountid,
        invite.fleetid,
        inviteid,
        accountname,
        fleetname,
        headerReferer,
        invite.contact
      );

      query = `
                    INSERT INTO pending_email (email, nextattempt, nretriespending) VALUES ($1, $2, $3)
                `;
      result = await txclient.query(query, [emailTemplate, currtime, 5]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create pending email");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        inviteid: inviteid,
        accountid: invite.accountid,
        fleetid: invite.fleetid,
        email: invite.contact,
        expiresat: expiresat,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async removeUserFromAccount(accountid, userid, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      // Capture current assignments before delete
      const assignmentsRes = await txclient.query(
        `
        SELECT fleetid, roleid
        FROM fleet_user_role
        WHERE accountid = $1 AND userid = $2
        `,
        [accountid, userid]
      );
      const assignments = assignmentsRes.rows; // may be empty

      let query = `
                DELETE FROM fleet_user_role WHERE accountid = $1 AND userid = $2
            `;
      let result = await txclient.query(query, [accountid, userid]);
      if (result.rowCount !== 1) {
        this.logger.error(
          "No entry found to remove user from account in fleet_user_role",
          {
            accountid: accountid,
            userid: userid,
            updatedby: updatedby,
          }
        );
      }

      // Insert history for each removed assignment
      for (const { fleetid, roleid } of assignments) {
        await txclient.query(
          `
          INSERT INTO fleet_user_role_history
            (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            accountid,
            fleetid,
            userid,
            roleid,
            false,
            "REMOVE",
            currtime,
            updatedby,
          ]
        );
      }

      query = `
                DELETE FROM user_fleet WHERE accountid = $1 AND userid = $2
            `;
      result = await txclient.query(query, [accountid, userid]);
      if (result.rowCount !== 1) {
        this.logger.error(
          "No entry found to remove user from account in user_fleet",
          {
            accountid: accountid,
            userid: userid,
            updatedby: updatedby,
          }
        );
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
      return true;
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async getDefaultAccountPkgs() {
    try {
      let query = `
            SELECT p.pkgid, p.pkgname, p.pkgtype, p.pkginfo, p.isenabled, p.createdat, 
            p.createdby, p.updatedat, p.updatedby, m.moduleid, m.modulename, m.creditspervehicleday FROM package p
            JOIN package_module pm ON p.pkgid = pm.pkgid
            JOIN module m ON pm.moduleid = m.moduleid
            WHERE p.pkgtype = 'standard' AND m.isenabled = true AND p.isenabled = true
        `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve default packages");
    }
  }

  async getCustomAccountPkgs(accountid) {
    try {
      let query = `
        SELECT 
            p.pkgid, 
            p.pkgname, 
            p.pkgtype, 
            p.pkginfo, 
            p.isenabled, 
            p.createdat, 
            p.createdby, 
            p.updatedat, 
            p.updatedby, 
            acpo.createdat as assigned_at, 
            acpo.createdby as assigned_by,
            m.moduleid, 
            m.modulename, 
            m.creditspervehicleday 
        FROM account_custom_package_options acpo
        JOIN package p ON acpo.pkgid = p.pkgid
        JOIN package_module pm ON p.pkgid = pm.pkgid
        JOIN module m ON pm.moduleid = m.moduleid
        WHERE acpo.accountid = $1 
            AND m.isenabled = true 
            AND p.isenabled = true
        ORDER BY acpo.createdat DESC, m.modulename
    `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve custom packages");
    }
  }

  async getUnassignedCustomPkgs(accountid) {
    try {
      // TODO: check performance of this query
      let query = `
            SELECT pkgid, pkgname, pkgtype, pkginfo, isenabled, createdat, createdby, updatedat, updatedby FROM package
            WHERE pkgtype = 'custom' AND pkgid NOT IN (SELECT pkgid FROM account_custom_package_options WHERE accountid = $1)
            ORDER BY createdat DESC
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve unassigned custom packages");
    }
  }

  async addCustomPkgToAccount(accountid, pkgids, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if all pkgids are custom packages
      let query = `
            SELECT pkgid FROM package WHERE pkgtype = 'custom' AND pkgid = ANY($1)
            `;
      let result = await txclient.query(query, [pkgids]);
      if (result.rowCount !== pkgids.length) {
        throw new Error("You can only add custom packages to your account");
      }

      let values = [];
      const placeholders = pkgids
        .map((pkgid, index) => {
          const startIndex = index * 4 + 1;
          values.push(accountid, pkgid, currtime, updatedby);
          return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2}, $${
            startIndex + 3
          })`;
        })
        .join(",");

      query = `
                INSERT INTO account_custom_package_options (accountid, pkgid, createdat, createdby) VALUES ${placeholders}
            `;
      result = await txclient.query(query, values);
      if (result.rowCount !== pkgids.length) {
        throw new Error("Failed to add custom package to account");
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

  async removeCustomPkgFromAccount(accountid, pkgid, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
                SELECT pkgid FROM package WHERE pkgtype = 'custom' AND pkgid = $1
            `;
      let result = await txclient.query(query, [pkgid]);
      if (result.rowCount !== 1) {
        throw new Error(
          "Package you are trying to remove is not a custom package"
        );
      }

      query = `
                DELETE FROM account_custom_package_options WHERE accountid = $1 AND pkgid = $2
            `;
      result = await txclient.query(query, [accountid, pkgid]);
      if (result.rowCount !== 1) {
        this.logger.error(
          "No entry found to remove custom package from account in account_custom_package_options",
          {
            accountid: accountid,
            pkgid: pkgid,
            updatedby: updatedby,
          }
        );
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

  async addAdminToAccRootFleet(accountid, contact, updatedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      let query = "";

      if (emailRegex.test(contact)) {
        query = `
          SELECT userid FROM email_pwd_sso WHERE ssoid = $1
        `;
      } else if (indianMobileRegex.test(contact)) {
        query = `
          SELECT userid FROM mobile_sso WHERE ssoid = $1
        `;
      } else {
        throw new Error("User not found");
      }

      let result = await txclient.query(query, [contact]);
      if (result.rowCount !== 1) {
        throw new Error("User not found");
      }

      const userid = result.rows[0].userid;

      query = `
        SELECT userid FROM user_fleet WHERE userid = $1 AND accountid = $2
      `;
      result = await txclient.query(query, [userid, accountid]);
      if (result.rowCount > 0) {
        throw {
          errcode: "USER_ALREADY_IN_ACCOUNT",
          message: "User is already part of this account",
        };
      }

      query = `
        SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account root fleet not found");
      }

      const fleetid = result.rows[0].fleetid;
      const roleid = ADMIN_ROLE_ID;

      query = `
        INSERT INTO user_fleet (userid, accountid, fleetid) VALUES ($1, $2, $3)
      `;
      result = await txclient.query(query, [userid, accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to account");
      }

      query = `
        INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) VALUES ($1, $2, $3, $4, $5, $6)
      `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        userid,
        roleid,
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add user to account");
      }

      query = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        userid,
        roleid,
        true,
        "ADD",
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add log to fleet_user_role_history");
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
      return true;
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async getAccountUsersInfoWithRoles(accountid) {
    try {
      let query = `
            SELECT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, u.isemailverified, 
            u.ismobileverified, u.createdat, u1.displayname as createdby, u.updatedat, u2.displayname as updatedby, r.roleid, r.rolename, 
            COALESCE(mss.ssoid, eps.ssoid) AS email, ms.ssoid as mobile FROM fleet_user_role fur 
            JOIN users u ON fur.userid = u.userid 
            LEFT JOIN email_pwd_sso eps ON fur.userid = eps.userid
            LEFT JOIN mobile_sso ms ON fur.userid = ms.userid
            LEFT JOIN mahindra_sso mss ON fur.userid = mss.userid
            LEFT JOIN roles r ON fur.accountid = r.accountid AND fur.roleid = r.roleid AND r.isenabled = true
            LEFT JOIN users u1 ON r.createdby = u1.userid 
            LEFT JOIN users u2 ON r.updatedby = u2.userid
            WHERE fur.accountid = $1 AND u.isdeleted = false
            ORDER BY u.userid DESC
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve account users");
    }
  }

  async getSubscriptionInfo(accountid) {
    try {
      let query = `
            SELECT aps.pkgid, p.pkgname, aps.subscriptioninfo, aps.createdat, aps.createdby FROM account_package_subscription aps
            JOIN package p ON aps.pkgid = p.pkgid
            WHERE aps.accountid = $1
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount !== 1) {
        return null;
      }
      return result.rows[0];
    } catch (error) {
      throw new Error("Failed to retrieve subscription info");
    }
  }

  // TODO: see how cost going to change when we enable/disable modules
  async getPkgInfoWithModules(pkgid) {
    try {
      let query = `
            SELECT p.pkgid, p.pkgname, p.pkgtype, p.pkginfo, p.isenabled, p.createdat, u1.displayname as createdby, p.updatedat, u2.displayname as updatedby, m.moduleid, m.modulename, m.creditspervehicleday FROM package p
            JOIN package_module pm ON p.pkgid = pm.pkgid
            JOIN module m ON pm.moduleid = m.moduleid
            JOIN users u1 ON m.createdby = u1.userid 
            JOIN users u2 ON m.updatedby = u2.userid
            WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
        `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve package information");
    }
  }

  async createSubscription(accountid, pkgid, subscriptioninfo, createdby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if there is an active subscription for this account
      let query = `
                SELECT pkgid FROM account_package_subscription WHERE accountid = $1
            `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 0) {
        throw new Error("Account already has an active subscription");
      }

      // check if pkgid is valid custom package
      query = `
                SELECT p.pkgid FROM account_custom_package_options acpo
                JOIN package p ON acpo.pkgid = p.pkgid
                WHERE acpo.accountid = $1 AND acpo.pkgid = $2 AND p.isenabled = $3
            `;
      result = await txclient.query(query, [accountid, pkgid, true]);
      let iscustompkg = true;
      if (result.rowCount !== 1) {
        iscustompkg = false;
      }

      // check if pkgid is valid default package
      query = `
                SELECT p.pkgid FROM package p
                WHERE p.pkgid = $1 AND p.pkgtype = 'standard' AND p.isenabled = $2
            `;
      result = await txclient.query(query, [pkgid, true]);
      let isdefaultpkg = true;
      if (result.rowCount !== 1) {
        isdefaultpkg = false;
      }

      if (!iscustompkg && !isdefaultpkg) {
        throw new Error("Invalid package id");
      }

      // create subscription
      query = `
                INSERT INTO account_package_subscription (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        accountid,
        pkgid,
        subscriptioninfo,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create subscription");
      }

      // add subscription to account_package_subscription_history
      query = `
                INSERT INTO account_package_subscription_history (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        accountid,
        pkgid,
        subscriptioninfo,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create subscription history");
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

  async isVehicleInAccount(accountid, vinno) {
    let query = `
      SELECT vinno FROM fleet_vehicle WHERE accountid = $1 AND vinno = $2
    `;
    let result = await this.pgPoolI.Query(query, [accountid, vinno]);
    return result.rowCount !== 0;
  }

  // TODO: whether subscribed or not info
  async getAccountVehicles(accountid) {
    try {
      let query = `
                SELECT 
                    fv.vinno, 
                    COALESCE(v.license_plate, v.vinno) AS regno, 
                    fv.isowner, 
                    fv.accvininfo, 
                    vm.modelvariant AS vehiclevariant, 
                    vm.modelname AS vehiclemodel, 
                    v.modelcode, 
                    vm.modeldisplayname, 
                    v.vehicleinfo, 
                    fv.assignedat, 
                    COALESCE(uab.displayname, 'Unknown User') AS assignedby, 
                    fv.updatedat, 
                    COALESCE(uub.displayname, 'Unknown User') AS updatedby, 
                    avs.startsat AS subscriptionstartsat, 
                    avs.endsat AS subscriptionendsat, 
                    avs.subscriptioninfo, 
                    avs.state AS subscriptionstate, 
                    avs.createdat AS subscriptioncreatedat, 
                    avs.createdby AS subscriptioncreatedby, 
                    avs.updatedat AS subscriptionupdatedat, 
                    avs.updatedby AS subscriptionupdatedby,
                    CASE 
                        WHEN fv.isowner = true THEN fv.accountid
                        ELSE tv.srcaccountid
                    END AS accountid,
                    CASE 
                        WHEN fv.isowner = true THEN owner_acc.accountname
                        ELSE a.accountname
                    END AS accountname
                FROM fleet_vehicle fv 
                JOIN vehicle v 
                    ON fv.vinno = v.vinno
                LEFT JOIN LATERAL (
                          SELECT *
                          FROM tagged_vehicle tv
                          WHERE tv.vinno = fv.vinno
                            AND tv.isactive = true
                          ORDER BY tv.taggedat DESC
                          LIMIT 1
                      ) tv ON true
                LEFT JOIN account a 
                    ON tv.srcaccountid = a.accountid
                LEFT JOIN account owner_acc
                    ON fv.accountid = owner_acc.accountid
                LEFT JOIN account_vehicle_subscription avs 
                    ON fv.accountid = avs.accountid 
                    AND fv.vinno = avs.vinno
                LEFT JOIN users uab 
                    ON fv.assignedby = uab.userid
                LEFT JOIN users uub 
                    ON fv.updatedby = uub.userid
                LEFT JOIN vehicle_model vm 
                    ON v.modelcode = vm.modelcode
                WHERE fv.accountid = $1;
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to fetch account vehicles");
    }
  }

  async subscribeVehicles(accountid, vinnos, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // get active subscription info
      let query = `
                SELECT pkgid, subscriptioninfo FROM account_package_subscription WHERE accountid = $1
            `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account subscription not found");
      }
      const activepkgid = result.rows[0].pkgid;
      const activepkginfo = result.rows[0].subscriptioninfo;

      // check if all vehicles are already subscribed
      query = `
                SELECT vinno FROM account_vehicle_subscription WHERE accountid = $1 AND vinno = ANY($2) AND state != $3 AND state != $4
            `;
      result = await txclient.query(query, [
        accountid,
        vinnos,
        ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.DISABLED,
        ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.STAGED_FOR_DISABLE,
      ]);
      if (result.rowCount !== 0) {
        throw new Error("Vehicle already subscribed");
      }

      // check if credits are enough to have subscription for all vehicles till end of the month
      query = `
                SELECT sum(m.creditspervehicleday) as pkgcost FROM package p
                JOIN package_module pm ON p.pkgid = pm.pkgid
                JOIN module m ON pm.moduleid = m.moduleid
                WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
            `;
      result = await txclient.query(query, [activepkgid]);
      if (result.rowCount !== 1) {
        throw new Error("Package not found");
      }
      const pkgcost = result.rows[0].pkgcost;

      // get number of days from now to end of the month
      let vehdays =
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0
        ).getDate() - new Date().getDate();
      let creditsrequired = vinnos.length * vehdays * pkgcost;

      // get account credits
      query = `
                SELECT credits FROM account_credits WHERE accountid = $1
            `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account credits not found");
      }
      const useablecredits = result.rows[0].credits;

      if (useablecredits < creditsrequired) {
        throw new Error("Insufficient credits");
      }

      // TODO: also check if these vehicles belong to this account

      // create subscription.
      if (vinnos.length > 0) {
        let values = [];
        const placeholders = vinnos
          .map((vinno, index) => {
            const startindex = index * 10 + 1;
            let startsat = currtime;
            let endsat = new Date(
              currtime.getFullYear(),
              currtime.getMonth() + 1,
              0
            ); // TODO: this is temporary
            values.push(
              accountid,
              vinno,
              startsat,
              endsat,
              {},
              ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.ENABLED,
              currtime,
              updatedby,
              currtime,
              updatedby
            );
            return `($${startindex}, $${startindex + 1}, $${startindex + 2}, $${
              startindex + 3
            }, $${startindex + 4}, $${startindex + 5}, $${startindex + 6}, $${
              startindex + 7
            }, $${startindex + 8}, $${startindex + 9})`;
          })
          .join(",");
        query = `
                    INSERT INTO account_vehicle_subscription (accountid, vinno, startsat, endsat, subscriptioninfo, state, createdat, createdby, updatedat, updatedby) VALUES ${placeholders}
                `;
        result = await txclient.query(query, values);
        if (result.rowCount !== vinnos.length) {
          this.logger.error(
            `Failed to subscribe vehicles: ${JSON.stringify(result.rows)}`
          );
          throw new Error("Some vehicles failed to subscribe");
        }
      }

      const countResult = await txclient.query(
        `SELECT COUNT(distinct vinno) AS vehicle_count FROM account_vehicle_subscription WHERE accountid = $1`,
        [accountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET subscribed = $1 WHERE accountid = $2`,
        [vehicleCount, accountid]
      );

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

  async unsubscribeVehicle(accountid, vinno, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if vehicle is already subscribed
      let query = `
                SELECT state FROM account_vehicle_subscription WHERE accountid = $1 AND vinno = $2
            `;
      let result = await txclient.query(query, [accountid, vinno]);
      if (result.rowCount !== 1) {
        throw new Error("Vehicle not subscribed");
      }
      const state = result.rows[0].state;

      if (state === ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.STAGED_FOR_DISABLE) {
        throw new Error(
          "Vehicle subscription is already staged for disable. It will continue to get data until the end of the month"
        );
      }

      if (state !== ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.ENABLED) {
        throw new Error("Vehicle subscription is not enabled");
      }

      query = `
                UPDATE account_vehicle_subscription SET state = $1, updatedat = $2, updatedby = $3 WHERE accountid = $4 AND vinno = $5
                RETURNING startsat, endsat, subscriptioninfo, state, createdat, createdby
            `;

      result = await txclient.query(query, [
        ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.STAGED_FOR_DISABLE,
        currtime,
        updatedby,
        accountid,
        vinno,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to unsubscribe vehicle");
      }

      const qstartsat = result.rows[0].startsat;
      const qendsat = result.rows[0].endsat;
      const qsubscriptioninfo = result.rows[0].subscriptioninfo;
      const qstate = result.rows[0].state;
      const qcreatedat = result.rows[0].createdat;
      const qcreatedby = result.rows[0].createdby;

      query = `
                INSERT INTO account_vehicle_subscription_history (accountid, vinno, startsat, endsat, subscriptioninfo, state, createdat, createdby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `;
      result = await txclient.query(query, [
        accountid,
        vinno,
        qstartsat,
        qendsat,
        qsubscriptioninfo,
        qstate,
        qcreatedat,
        qcreatedby,
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error(
          "Failed to create account vehicle subscription history"
        );
      }

      const countResult = await txclient.query(
        `SELECT COUNT(distinct vinno) AS vehicle_count FROM account_vehicle_subscription WHERE accountid = $1`,
        [accountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET subscribed = $1 WHERE accountid = $2`,
        [vehicleCount, accountid]
      );

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

  async checkChangeSubscriptionPackage(accountid, newpkgid) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // get current subscription info
      let query = `
        SELECT pkgid, subscriptioninfo FROM account_package_subscription WHERE accountid = $1
      `;
      let result = await txclient.query(query, [accountid]);
      let currentpkgid = result.rowCount == 1 ? result.rows[0].pkgid : null;

      // check if newpkgid is different from current pkgid
      if (newpkgid === currentpkgid) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          isvalid: false,
          msg: "New package id is the same as current package id",
        };
      }

      // check if pkgid is valid custom package
      query = `
        SELECT p.pkgid FROM account_custom_package_options acpo
        JOIN package p ON acpo.pkgid = p.pkgid
        WHERE acpo.accountid = $1 AND acpo.pkgid = $2 AND p.isenabled = $3
      `;
      result = await txclient.query(query, [accountid, newpkgid, true]);
      let iscustompkg = true;
      if (result.rowCount !== 1) {
        iscustompkg = false;
      }

      // check if pkgid is valid default package
      query = `
        SELECT p.pkgid FROM package p
        WHERE p.pkgid = $1 AND p.pkgtype = 'standard' AND p.isenabled = $2
      `;
      result = await txclient.query(query, [newpkgid, true]);
      let isdefaultpkg = true;
      if (result.rowCount !== 1) {
        isdefaultpkg = false;
      }

      if (!iscustompkg && !isdefaultpkg) {
        throw new Error("INVALID_PACKAGE_ID");
      }

      // get number of vehicles currently subscribed
      query = `
        SELECT count(*) FROM account_vehicle_subscription avs
        WHERE avs.accountid = $1 AND avs.state = $2
      `;
      result = await txclient.query(query, [accountid, 1]);
      const numvehicles = parseInt(result.rows[0].count);

      // get package cost for new package
      query = `
        SELECT p.pkgid, p.pkgname, sum(m.creditspervehicleday) as pkgcost FROM package p
        JOIN package_module pm ON p.pkgid = pm.pkgid
        JOIN module m ON pm.moduleid = m.moduleid
        WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
        GROUP BY p.pkgid, p.pkgname
      `;

      result = await txclient.query(query, [newpkgid]);
      if (result.rowCount !== 1) {
        throw new Error("PACKAGE_NOT_FOUND");
      }

      let newpkgcost = 0;
      let newpkgname = "";
      if (result.rowCount == 1 && result.rows[0].pkgid === newpkgid) {
        newpkgcost = Number(result.rows[0].pkgcost);
        newpkgname = result.rows[0].pkgname;
      }

      // get package cost for current package
      query = `
        SELECT p.pkgid, p.pkgname, sum(m.creditspervehicleday) as pkgcost FROM package p
        JOIN package_module pm ON p.pkgid = pm.pkgid
        JOIN module m ON pm.moduleid = m.moduleid
        WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
        GROUP BY p.pkgid, p.pkgname
      `;
      result = await txclient.query(query, [currentpkgid]);

      let oldpkgcost = 0;
      let oldpkgname = "No Package";
      if (result.rowCount == 1 && result.rows[0].pkgid === currentpkgid) {
        oldpkgcost = Number(result.rows[0].pkgcost);
        oldpkgname = result.rows[0].pkgname;
      }

      // get account credits
      query = `
            SELECT credits FROM account_credits WHERE accountid = $1
          `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("ACCOUNT_CREDITS_NOT_FOUND");
      }
      const useablecredits = Number(result.rows[0].credits);

      const availableDays = Math.floor(
        useablecredits / (numvehicles * newpkgcost)
      );

      const currentDailyConsumption =
        numvehicles > 0 && oldpkgcost > 0
          ? Number((numvehicles * oldpkgcost).toFixed(2))
          : 0;

      const newDailyConsumption =
        numvehicles > 0 && newpkgcost > 0
          ? Number((numvehicles * newpkgcost).toFixed(2))
          : 0;

      const currentMonthlyConsumption =
        currentDailyConsumption > 0
          ? Number((currentDailyConsumption * 30).toFixed(2))
          : 0;

      const newMonthlyConsumption =
        newDailyConsumption > 0
          ? Number((newDailyConsumption * 30).toFixed(2))
          : 0;

      const currentTotalConsumption =
        currentDailyConsumption > 0 && availableDays > 0
          ? Number((currentDailyConsumption * availableDays).toFixed(2))
          : 0;

      const newTotalConsumption =
        newDailyConsumption > 0 && availableDays > 0
          ? Number((newDailyConsumption * availableDays).toFixed(2))
          : 0;

      const consumptionDifference =
        newTotalConsumption > 0 && currentTotalConsumption > 0
          ? Number((newTotalConsumption - currentTotalConsumption).toFixed(2))
          : 0;

      const dailyConsumptionDifference =
        newDailyConsumption > 0 && currentDailyConsumption > 0
          ? Number((newDailyConsumption - currentDailyConsumption).toFixed(2))
          : 0;

      const validityofoldpkg =
        numvehicles > 0 && oldpkgcost > 0
          ? Math.floor(useablecredits / (numvehicles * oldpkgcost))
          : 0;

      const validityofnewpkg =
        numvehicles > 0 && newpkgcost > 0
          ? Math.floor(useablecredits / (numvehicles * newpkgcost))
          : 0;

      if (availableDays < 2) {
        return {
          isvalid: false,
          msg: "Insufficient credits for the new package for even one day",
          action: "invalid",
          creditdetails: {
            availablecredits: Number(useablecredits.toFixed(2)),
            requiredcredits: Number((numvehicles * newpkgcost).toFixed(2)),
            deficit: Number(
              (numvehicles * newpkgcost - useablecredits).toFixed(2)
            ),
            currentpackage: {
              name: oldpkgname,
              dailyconsumption: currentDailyConsumption,
              monthlyconsumption: currentMonthlyConsumption,
              totalconsumption: currentTotalConsumption,
              validitydays: validityofoldpkg,
              creditpervehicleperday: Number(oldpkgcost.toFixed(2)),
            },
            newpackage: {
              name: newpkgname,
              dailyconsumption: newDailyConsumption,
              monthlyconsumption: newMonthlyConsumption,
              totalconsumption: newTotalConsumption,
              validitydays: validityofnewpkg,
              creditpervehicleperday: Number(newpkgcost.toFixed(2)),
            },
            impact: {
              dailyconsumptionchange: dailyConsumptionDifference,
              monthlyconsumptionchange: Number(
                (dailyConsumptionDifference * 30).toFixed(2)
              ),
              totalconsumptionchange: consumptionDifference,
              validitychange: validityofnewpkg - validityofoldpkg,
              percentagechange: Number(
                (
                  (dailyConsumptionDifference / currentDailyConsumption) *
                  100
                ).toFixed(2)
              ),
            },
            vehiclecount: numvehicles,
            availabledays: availableDays,
          },
        };
      }

      let msg = "";
      let action = "switch";
      if (numvehicles == 0) {
        msg = `Changing from ${oldpkgname} to ${newpkgname}, no vehicles are currently subscribed in the account`;
        action = "switch";
      } else if (validityofoldpkg == 0 && validityofnewpkg > 0) {
        msg = `Upgrading from No Package to ${newpkgname}, the validity of the subscription will be ${validityofnewpkg} days`;
        action = "upgrade";
      } else if (validityofoldpkg > 0 && validityofnewpkg == 0) {
        msg = `Downgrading from ${oldpkgname} to No Package, the validity of the subscription will be 0 days`;
        action = "downgrade";
      } else if (validityofoldpkg < validityofnewpkg) {
        msg = `Downgrading from ${oldpkgname} to ${newpkgname}, the validity of the subscription will increase from ${validityofoldpkg} days to ${validityofnewpkg} days`;
        action = "downgrade";
      } else if (validityofoldpkg > validityofnewpkg) {
        msg = `Upgrading from ${oldpkgname} to ${newpkgname}, the validity of the subscription will decrease from ${validityofoldpkg} days to ${validityofnewpkg} days`;
        action = "upgrade";
      } else {
        msg = `Changing from ${oldpkgname} to ${newpkgname}, the validity of the subscription will remain the same at ${validityofoldpkg} days`;
        action = "switch";
      }

      //Get package name for the account
      const pkgResult = await txclient.query(
        `
        SELECT p.pkgname
        FROM account_package_subscription aps
        JOIN package p ON aps.pkgid = p.pkgid
        WHERE aps.accountid = $1
        `,
        [accountid]
      );

      //Extract package name (default to 'Lite' if none)
      const packageName = pkgResult.rows[0]?.pkgname || "Lite";

      //Update account_summary with the package name
      await txclient.query(
        `UPDATE account_summary SET packagename = $1 WHERE accountid = $2`,
        [packageName, accountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        isvalid: true,
        msg: msg,
        action: action,
        validityofoldpkg: validityofoldpkg,
        validityofnewpkg: validityofnewpkg,
        creditdetails: {
          availablecredits: Number(useablecredits.toFixed(2)),
          currentpackage: {
            name: oldpkgname,
            dailyconsumption: currentDailyConsumption,
            monthlyconsumption: currentMonthlyConsumption,
            totalconsumption: currentTotalConsumption,
            validitydays: validityofoldpkg,
            creditpervehicleperday: Number(oldpkgcost.toFixed(2)),
          },
          newpackage: {
            name: newpkgname,
            dailyconsumption: newDailyConsumption,
            monthlyconsumption: newMonthlyConsumption,
            totalconsumption: newTotalConsumption,
            validitydays: validityofnewpkg,
            creditpervehicleperday: Number(newpkgcost.toFixed(2)),
          },
          impact: {
            dailyconsumptionchange: dailyConsumptionDifference,
            monthlyconsumptionchange: Number(
              (dailyConsumptionDifference * 30).toFixed(2)
            ),
            totalconsumptionchange: consumptionDifference,
            validitychange: validityofnewpkg - validityofoldpkg,
            percentagechange: Number(
              (
                (dailyConsumptionDifference / currentDailyConsumption) *
                100
              ).toFixed(2)
            ),
          },
          vehiclecount: numvehicles,
          availabledays: availableDays,
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async changeSubscriptionPackage(
    accountid,
    newpkgid,
    subscriptioninfo,
    updatedby
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // get current subscription info (if exists)
      let query = `
                SELECT pkgid, subscriptioninfo FROM account_package_subscription WHERE accountid = $1
            `;
      let result = await txclient.query(query, [accountid]);

      let currentpkgid = null;
      let currentpkginfo = null;
      let hasExistingSubscription = false;

      if (result.rowCount === 1) {
        // Existing subscription found
        currentpkgid = result.rows[0].pkgid;
        currentpkginfo = result.rows[0].subscriptioninfo;
        hasExistingSubscription = true;

        // check if newpkgid is different from current pkgid
        if (newpkgid === currentpkgid) {
          throw {
            errcode: "SAME_PACKAGE_ID",
            message: `New package id is the same as current package id: ${newpkgid}`,
          };
        }
      } else if (result.rowCount === 0) {
        // No existing subscription - this will be a fresh subscription
        hasExistingSubscription = false;
      } else {
        throw {
          errcode: "MULTIPLE_SUBSCRIPTIONS_FOUND",
          message: `Multiple subscriptions found for account: ${accountid}`,
        };
      }

      // check if pkgid is valid custom package
      query = `
                SELECT p.pkgid FROM account_custom_package_options acpo
                JOIN package p ON acpo.pkgid = p.pkgid
                WHERE acpo.accountid = $1 AND acpo.pkgid = $2 AND p.isenabled = $3
            `;
      result = await txclient.query(query, [accountid, newpkgid, true]);
      let iscustompkg = true;
      if (result.rowCount !== 1) {
        iscustompkg = false;
      }

      // check if pkgid is valid default package
      query = `
                SELECT p.pkgid FROM package p
                WHERE p.pkgid = $1 AND p.pkgtype = 'standard' AND p.isenabled = $2
            `;
      result = await txclient.query(query, [newpkgid, true]);
      let isdefaultpkg = true;
      if (result.rowCount !== 1) {
        isdefaultpkg = false;
      }

      if (!iscustompkg && !isdefaultpkg) {
        throw {
          errcode: "INVALID_PACKAGE_ID",
          message: `Invalid package id: ${newpkgid}`,
        };
      }

      // get number of vehicles currently subscribed
      query = `
                SELECT count(*) FROM account_vehicle_subscription avs
                WHERE avs.accountid = $1 AND avs.state = $2
            `;
      result = await txclient.query(query, [
        accountid,
        ACCOUNT_VEHICLE_SUBSCRIPTION_STATE.ENABLED,
      ]);
      const numvehicles = result.rows[0].count;

      // check if there are enough credits to subscribe to the new package
      query = `
                SELECT sum(m.creditspervehicleday) as pkgcost FROM package p
                JOIN package_module pm ON p.pkgid = pm.pkgid
                JOIN module m ON pm.moduleid = m.moduleid
                WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
            `;
      result = await txclient.query(query, [newpkgid]);
      if (result.rowCount !== 1) {
        throw {
          errcode: "PACKAGE_NOT_FOUND",
          message: `Package not found: ${newpkgid}`,
        };
      }
      const newpkgcost = result.rows[0].pkgcost;

      // get number of days from now to end of the month
      let vehdays =
        new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          0
        ).getDate() - new Date().getDate();
      let creditsrequired = vehdays * numvehicles * newpkgcost;

      // get account credits
      query = `
                SELECT credits FROM account_credits WHERE accountid = $1
            `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw {
          errcode: "NO_ACCOUNT_CREDITS",
          message: `No account credits found: ${accountid}`,
        };
      }
      const useablecredits = result.rows[0].credits;

      if (useablecredits < creditsrequired) {
        throw {
          errcode: "INSUFFICIENT_CREDITS",
          message: `Insufficient credits: ${useablecredits} < ${creditsrequired}`,
        };
      }

      // create or update subscription based on whether one exists
      if (hasExistingSubscription) {
        let updatedCurrentSubscriptionInfo = {
          ...currentpkginfo,
          enddate: subscriptioninfo.startdate,
        };

        query = `
                UPDATE account_package_subscription_history 
                SET subscriptioninfo = $1
                WHERE accountid = $2 AND pkgid = $3 
                AND createdat = (
                    SELECT MAX(createdat) 
                    FROM account_package_subscription_history 
                    WHERE accountid = $2 AND pkgid = $3
                )
            `;
        result = await txclient.query(query, [
          updatedCurrentSubscriptionInfo,
          accountid,
          currentpkgid,
        ]);

        // update existing subscription
        query = `
                  UPDATE account_package_subscription SET pkgid = $1, subscriptioninfo = $2, createdat = $3, createdby = $4 WHERE accountid = $5
              `;
        result = await txclient.query(query, [
          newpkgid,
          subscriptioninfo,
          currtime,
          updatedby,
          accountid,
        ]);
        if (result.rowCount !== 1) {
          throw {
            errcode: "FAILED_TO_UPDATE_SUBSCRIPTION",
            message: `Failed to update subscription: ${newpkgid}`,
          };
        }
      } else {
        // create new subscription
        query = `
                  INSERT INTO account_package_subscription (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
              `;
        result = await txclient.query(query, [
          accountid,
          newpkgid,
          subscriptioninfo,
          currtime,
          updatedby,
        ]);
        if (result.rowCount !== 1) {
          throw {
            errcode: "FAILED_TO_CREATE_SUBSCRIPTION",
            message: `Failed to create subscription: ${newpkgid}`,
          };
        }
      }

      // add subscription to account_package_subscription_history
      query = `
                INSERT INTO account_package_subscription_history (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
            `;
      result = await txclient.query(query, [
        accountid,
        newpkgid,
        subscriptioninfo,
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw {
          errcode: "FAILED_TO_CREATE_SUBSCRIPTION_HISTORY",
          message: `Failed to create subscription history: ${newpkgid}`,
        };
      }
      //Get package name for the account
      const pkgResult = await txclient.query(
        `
        SELECT p.pkgname
        FROM account_package_subscription aps
        JOIN package p ON aps.pkgid = p.pkgid
        WHERE aps.accountid = $1
        `,
        [accountid]
      );

      //Extract package name (default to 'Lite' if none)
      const packageName = pkgResult.rows[0]?.pkgname || "Lite";

      //Update account_summary with the package name
      await txclient.query(
        `UPDATE account_summary SET packagename = $1 WHERE accountid = $2`,
        [packageName, accountid]
      );

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

  async getSubscriptionHistory(accountid) {
    try {
      let query = `
            SELECT apsh.pkgid, p.pkgname, apsh.subscriptioninfo, apsh.createdat, u.displayname as createdby FROM account_package_subscription_history apsh
            JOIN package p ON apsh.pkgid = p.pkgid
            JOIN users u ON apsh.createdby = u.userid
            WHERE apsh.accountid = $1 ORDER BY apsh.createdat DESC
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows;
    } catch (error) {
      throw {
        errcode: "FAILED_TO_RETRIEVE_SUBSCRIPTION_HISTORY",
        message: `Unable to retrieve subscription history: ${accountid}`,
      };
    }
  }

  async addVehicleToAccount(accountid, vehicleinfo, assignedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // get root fleetid of this account
      let query = `
                SELECT fleetid FROM account_fleet WHERE accountid = $1 AND isroot = true
            `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        const error = new Error("Account not found");
        error.errcode = "ACCOUNT_NOT_FOUND";
        throw error;
      }
      const fleetid = result.rows[0].fleetid;

      // check if vehicle exists or not
      query = `
            SELECT vinno FROM vehicle WHERE vinno = $1
        `;
      result = await txclient.query(query, [vehicleinfo.vinno]);
      if (result.rowCount === 0) {
        const error = new Error("Vehicle not found");
        error.errcode = "VEHICLE_NOT_FOUND";
        throw error;
      }

      // check if vehicle already belongs to any account/fleet
      query = `
            SELECT accountid, fleetid FROM fleet_vehicle WHERE vinno = $1 and isowner = true
        `;
      result = await txclient.query(query, [vehicleinfo.vinno]);
      if (result.rowCount > 0) {
        const error = new Error("Vehicle already belongs to an account");
        error.errcode = "VEHICLE_ALREADY_IN_ACCOUNT";
        throw error;
      }

      query = `
                INSERT INTO fleet_vehicle (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        vehicleinfo.vinno,
        vehicleinfo.isowner,
        vehicleinfo.accvininfo,
        currtime,
        assignedby,
        currtime,
        assignedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add vehicle to fleet");
      }

      query = `
                INSERT INTO fleet_vehicle_history (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby, action) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        vehicleinfo.vinno,
        vehicleinfo.isowner,
        vehicleinfo.accvininfo,
        currtime,
        assignedby,
        currtime,
        assignedby,
        VEHICLE_ACTION.ADDED,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add vehicle to fleet history");
      }

      const countResult = await txclient.query(
        `SELECT COUNT(vinno) AS vehicle_count FROM fleet_vehicle WHERE accountid = $1`,
        [accountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET vehicles = $1 WHERE accountid = $2`,
        [vehicleCount, accountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return { accountid: accountid, fleetid: fleetid, vehicle: vehicleinfo };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async removeVehicleFromAccount(accountid, vinno, removedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if vehicle exists
      let query = `
            SELECT vinno FROM vehicle WHERE vinno = $1
        `;
      let result = await txclient.query(query, [vinno]);
      if (result.rowCount === 0) {
        throw new Error("Vehicle not found");
      }

      query = `
            SELECT accountid, fleetid, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby 
            FROM fleet_vehicle WHERE vinno = $1 AND accountid = $2
        `;
      result = await txclient.query(query, [vinno, accountid]);
      if (result.rowCount === 0) {
        throw new Error("Vehicle not found in fleet");
      } else if (!result.rows[0].isowner) {
        throw new Error("Vehicle is not owned by this account");
      }

      const vehicleData = result.rows[0];
      // if (vehicleData.accountid !== accountid) {
      //   throw new Error("Vehicle does not belong to this account");
      // }

      query = `
            INSERT INTO fleet_vehicle_history (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby, action) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;
      result = await txclient.query(query, [
        vehicleData.accountid,
        vehicleData.fleetid,
        vinno,
        vehicleData.isowner,
        vehicleData.accvininfo,
        vehicleData.assignedat,
        vehicleData.assignedby,
        currtime,
        removedby,
        VEHICLE_ACTION.REMOVED,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create vehicle history record");
      }

      // Delete from fleet_vehicle
      query = `
            DELETE FROM fleet_vehicle WHERE vinno = $1 and accountid = $2
        `;
      result = await txclient.query(query, [vinno, accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to remove vehicle from fleet");
      }

      // Get vehicle count for the account
      const countResult = await txclient.query(
        `SELECT COUNT(vinno) AS vehicle_count FROM fleet_vehicle WHERE accountid = $1`,
        [accountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET vehicles = $1 WHERE accountid = $2`,
        [vehicleCount, accountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return { accountid: accountid, vinno: vinno };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async getAssignableVehicles(accountid) {
    try {
      let query = `
        SELECT v.vinno, COALESCE(v.license_plate, v.vinno) AS regno, v.modelcode FROM vehicle v WHERE NOT EXISTS (
            SELECT 1 
            FROM fleet_vehicle fv 
            WHERE fv.vinno = v.vinno and fv.isowner = true
        );
      `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      throw new Error("Failed to fetch assignable vehicles");
    }
  }

  async getVehicleFleetInfo(vinno, accountid) {
    try {
      let query = `SELECT accountid, fleetid, isowner FROM fleet_vehicle WHERE vinno = $1 and accountid = $2`;
      let result = await this.pgPoolI.Query(query, [vinno, accountid]);
      return result.rowCount > 0 ? result.rows[0] : null;
    } catch (error) {
      throw new Error("Failed to get vehicle fleet info");
    }
  }

  async listPendingAccounts(
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) {
    try {
      orderbyfield = orderbyfield || "createdat";
      orderbydirection = orderbydirection || "desc";
      searchtext = searchtext || "";
      offset = offset || 0;
      limit = limit || 1000;
      let limitquery = "";
      let offsetquery = "";
      if (!download) {
        limitquery = `LIMIT $3`;
        offsetquery = `OFFSET $2`;
      }
      let baseQuery = `
        WITH account_list AS (
          SELECT rpa.accountid
          FROM reviewpendingaccount rpa
          WHERE (
            upper(rpa.accountname) LIKE '%' || upper($1) || '%' OR
            upper(rpa.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rpa.status) LIKE '%' || upper($1) || '%'
          )
          ORDER BY rpa.${orderbyfield} ${orderbydirection}
          ${offsetquery} ${limitquery}
        )
        SELECT 
          rpa.accountid, 
          rpa.accountname, 
          rpa.accounttype, 
          rpa.accountinfo, 
          rpa.mobile, 
          rpa.isenabled, 
          rpa.isdeleted, 
          rpa.original_input,
          rpa.error_status,
          rpa.status, 
          rpa.reason, 
          rpa.review_data, 
          rpa.createdat, 
          u1.displayname as createdby, 
          rpa.updatedat, 
          u2.displayname as updatedby
        FROM reviewpendingaccount rpa
        JOIN account_list al ON rpa.accountid = al.accountid
        JOIN users u1 ON rpa.createdby = u1.userid
        JOIN users u2 ON rpa.updatedby = u2.userid
        ORDER BY rpa.${orderbyfield} ${orderbydirection}
      `;

      let result;
      let totalcount;
      if (download) {
        result = await this.pgPoolI.Query(baseQuery, [searchtext]);
        totalcount = result.rowCount;
      } else {
        result = await this.pgPoolI.Query(baseQuery, [
          searchtext,
          offset,
          limit,
        ]);
        const countcquery = `WITH account_list AS (
          SELECT rpa.accountid
          FROM reviewpendingaccount rpa
          WHERE (
            upper(rpa.accountname) LIKE '%' || upper($1) || '%' OR
            upper(rpa.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rpa.status) LIKE '%' || upper($1) || '%'
          )
        ) SELECT COUNT(*) FROM account_list`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }
      if (result.rowCount === 0) {
        return {
          accounts: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: Math.ceil(totalcount / limit),
        };
      }
      if (download) {
        return {
          accounts: result.rows,
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
        accounts: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw new Error(`Failed to list pending accounts: ${error.message}`);
    }
  }

  async listDoneAccounts(
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) {
    try {
      orderbyfield = orderbyfield || "updatedat";
      if (orderbyfield === "status") {
        orderbyfield = "original_status";
      } else if (orderbyfield === "reason") {
        orderbyfield = "resolution_reason";
      }

      orderbydirection = orderbydirection || "DESC";
      searchtext = searchtext || "";
      offset = offset || 0;
      limit = limit || 1000;
      let limitquery = "";
      let offsetquery = "";
      if (!download) {
        limitquery = `LIMIT $3`;
        offsetquery = `OFFSET $2`;
      }
      let baseQuery = `
        WITH account_list AS (
          SELECT rda.accountid, rda.reviewed_at
          FROM reviewdoneaccount rda
          WHERE (
            upper(rda.accountname) LIKE '%' || upper($1) || '%' OR
            upper(rda.mobile) LIKE '%' || upper($1) || '%'
          )
          ORDER BY rda.${orderbyfield} ${orderbydirection}
          ${offsetquery} ${limitquery}
        )
        SELECT 
          rda.accountid, 
          rda.accountname, 
          rda.accounttype, 
          rda.accountinfo, 
          rda.mobile, 
          rda.isenabled, 
          rda.isdeleted, 
          rda.original_input,
          rda.original_status as status, 
          rda.resolution_reason as reason, 
          rda.reviewed_at, 
          u1.displayname as reviewed_by, 
          rda.updatedat, 
          u3.displayname as updatedby
        FROM reviewdoneaccount rda
        JOIN account_list al ON rda.accountid = al.accountid AND rda.reviewed_at = al.reviewed_at
        JOIN users u1 ON rda.reviewed_by = u1.userid
        JOIN users u3 ON rda.updatedby = u3.userid
        ORDER BY rda.${orderbyfield} ${orderbydirection}
      `;
      // Don't use addPaginationToQuery since pagination is already in the CTE
      let result;
      let totalcount;
      if (download) {
        result = await this.pgPoolI.Query(baseQuery, [searchtext]);
        totalcount = result.rowCount;
      } else {
        result = await this.pgPoolI.Query(baseQuery, [
          searchtext,
          offset,
          limit,
        ]);
        const countcquery = `WITH account_list AS (
          SELECT rda.accountid
          FROM reviewdoneaccount rda
          WHERE (
            upper(rda.accountname) LIKE '%' || upper($1) || '%' OR
            upper(rda.mobile) LIKE '%' || upper($1) || '%'
          )
        ) SELECT COUNT(*) FROM account_list`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }
      if (result.rowCount === 0) {
        return {
          accounts: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: Math.ceil(totalcount / limit),
        };
      }
      if (download) {
        return {
          accounts: result.rows,
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
        accounts: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw new Error(`Failed to list done accounts: ${error.message}`);
    }
  }

  async addReviewDoneAccount(accountData) {
    try {
      const currtime = new Date();

      const query = `
        INSERT INTO reviewdoneaccount (
          accountid,
          accountname,
          accounttype,
          accountinfo,
          mobile,
          isenabled,
          isdeleted,
          original_input,
          original_status,
          resolution_reason,
          review_data,
          entrytype,
          reviewed_at,
          reviewed_by,
          createdat,
          createdby,
          updatedat,
          updatedby
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `;

      const values = [
        accountData.accountid,
        accountData.accountname,
        accountData.accounttype,
        accountData.accountinfo || {},
        accountData.mobile || "0000000000",
        accountData.isenabled,
        accountData.isdeleted || false,
        accountData.original_input || {},
        accountData.original_status || "APPROVED",
        accountData.resolution_reason || "Account created successfully",
        accountData.review_data || {},
        accountData.entrytype || "onboarding",
        currtime, // reviewed_at
        accountData.reviewed_by,
        currtime, // createdat
        accountData.createdby,
        currtime, // updatedat
        accountData.updatedby,
      ];

      const result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to insert review done account");
      }

      return true;
    } catch (error) {
      this.logger.error(`addReviewDoneAccount error: ${error}`);
      throw new Error("Unable to add review done account");
    }
  }

  async addReviewPendingAccount(accountData) {
    try {
      const currtime = new Date();

      const query = `
        INSERT INTO reviewpendingaccount (
          accountid,
          accountname,
          accounttype,
          accountinfo,
          mobile,
          isenabled,
          isdeleted,
          original_input,
          error_status,
          status,
          reason,
          review_data,
          createdat,
          createdby,
          updatedat,
          updatedby
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
      `;

      const values = [
        accountData.accountid,
        accountData.accountname,
        accountData.accounttype,
        accountData.accountinfo,
        accountData.mobile,
        accountData.isenabled,
        accountData.isdeleted,
        accountData.original_input,
        accountData.error_status,
        accountData.status,
        accountData.reason,
        accountData.review_data,
        currtime,
        accountData.createdby,
        currtime,
        accountData.updatedby,
      ];

      const result = await this.pgPoolI.Query(query, values);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in addReviewPendingAccount:", error);
      throw error;
    }
  }

  async getPendingAccountReviewByAccountName(accountname, vin) {
    try {
      const query = `SELECT DISTINCT(accountid) FROM reviewpendingaccount WHERE accountname = $1 AND original_input->>'vin' = $2`;
      const result = await this.pgPoolI.Query(query, [accountname, vin]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0].accountid;
    } catch (error) {
      this.logger.error(
        "Error in getPendingAccountReviewByAccountName:",
        error
      );
      throw error;
    }
  }

  async getAccountReviewDoneByAccountName(accountname, status) {
    try {
      const query = `SELECT * FROM reviewdoneaccount WHERE accountname = $1 AND original_status = $2`;
      const result = await this.pgPoolI.Query(query, [accountname, status]);
      return result.rowCount > 0;
    } catch (error) {
      this.logger.error("Error in getAccountReviewDoneByAccountName:", error);
      throw error;
    }
  }

  async getPendingAccountReviewById(accountid) {
    try {
      const query = `SELECT * FROM reviewpendingaccount WHERE accountid = $1`;
      const result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in getPendingAccountReviewById:", error);
      throw error;
    }
  }

  async deletePendingAccountReviewById(accountid) {
    try {
      const query = `DELETE FROM reviewpendingaccount WHERE accountid = $1`;
      const result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in deletePendingAccountReviewById:", error);
      throw error;
    }
  }

  async updateReviewPendingAccount(accountid, updateFields, updatedby) {
    try {
      const currtime = new Date();
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      const setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(", ");

      const values = [...Object.values(updateFields), accountid];
      const query = `UPDATE reviewpendingaccount SET ${setClause} WHERE accountid = $${values.length}`;

      const result = await this.pgPoolI.Query(query, values);
      return result.rowCount > 0; // Return boolean for success/failure
    } catch (error) {
      this.logger.error("Error in updateReviewPendingAccount:", error);
      throw error;
    }
  }

  async discardAccountReview(createdBy, taskid) {
    try {
      const existingAccount = await this.pgPoolI.Query(
        `SELECT * FROM reviewpendingaccount WHERE accountid = $1`,
        [taskid]
      );
      if (existingAccount.rows.length === 0) {
        throw new Error("Account review not found");
      }

      const currtime = new Date();

      const query = `
        INSERT INTO reviewdoneaccount (
          accountid,
          accountname,
          accounttype,
          accountinfo,
          mobile,
          isenabled,
          isdeleted,
          original_input,
          original_status,
          resolution_reason,
          review_data,
          entrytype,
          reviewed_at,
          reviewed_by,
          createdat,
          createdby,
          updatedat,
          updatedby
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        )
      `;

      const values = [
        existingAccount.rows[0].accountid,
        existingAccount.rows[0].accountname,
        existingAccount.rows[0].accounttype,
        existingAccount.rows[0].accountinfo || {},
        existingAccount.rows[0].mobile || null,
        existingAccount.rows[0].isenabled,
        existingAccount.rows[0].isdeleted || false,
        existingAccount.rows[0].original_input || {},
        "REVIEW_DISCARDED_BY_ADMIN",
        "Review discarded by admin",
        existingAccount.rows[0] || {},
        "review",
        currtime, // reviewed_at
        createdBy,
        currtime, // createdat
        createdBy,
        currtime, // updatedat
        createdBy,
      ];

      let result = await this.pgPoolI.Query(query, values);

      if (result.rowCount > 0) {
        const deleteQuery = `DELETE FROM reviewpendingaccount WHERE accountid = $1`;
        const deleteResult = await this.pgPoolI.Query(deleteQuery, [taskid]);
        if (deleteResult.rowCount > 0) {
          return true;
        }
      }
      return false;
    } catch (error) {
      this.logger.error("Error in discardAccountReview:", error);
      throw error;
    }
  }

  async getAccountSummary(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    try {
      orderbyfield = orderbyfield || "accountname";
      orderbydirection = orderbydirection || "asc";
      let orderbyclause = `ORDER BY a.accountname NULLS LAST, p.pkgname NULLS LAST`;
      if (orderbyfield && orderbydirection) {
        if (orderbyfield === "accountname") {
          orderbyfield = "a.accountname";
        } else if (orderbyfield === "packagename") {
          orderbyfield = "p.pkgname";
        } else if (orderbyfield === "availablecredit") {
          orderbyfield = "c.credits";
        } else if (orderbyfield === "taggedin") {
          orderbyfield = "COUNT(tvi.srcaccountid)";
        } else if (orderbyfield === "taggedout") {
          orderbyfield = "COUNT(tvo.srcaccountid)";
        } else if (orderbyfield === "expiredate") {
          // Order by the actual date value, not the formatted string
          orderbyfield = `(NOW() + ((CAST(c.credits AS INTEGER) / CASE WHEN (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) = 0 THEN 1 ELSE (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) END)::int * INTERVAL '1 day')) AT TIME ZONE 'Asia/Kolkata'`;
        } else {
          orderbyfield = `s.${orderbyfield}`;
        }
        orderbyclause = `ORDER BY ${orderbyfield} ${orderbydirection} NULLS LAST`;
      }
      let baseQuery = `
        SELECT 
            s.accountid,
            a.accountname,
            s.users,
            s.vehicles AS totalvehicles,
            s.subscribed AS subscribedvehicles,
            p.pkgname AS packagename,
            CAST(c.credits AS INTEGER) AS availablecredit,
            COUNT(tvi.srcaccountid) AS taggedin,
            COUNT(tvo.srcaccountid) AS taggedout,
            TO_CHAR(
                (
                    NOW() + 
                    (
                        (CAST(c.credits AS INTEGER) /
                        CASE 
                            WHEN (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) = 0 
                                THEN 1 
                            ELSE (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) 
                        END
                        )::int * INTERVAL '1 day'
                    )
                ) AT TIME ZONE 'Asia/Kolkata',
                'DD Mon YYYY | HH24:MI:SS'
            ) AS expiredate,
            CAST(c.credits AS INTEGER) /
            (
              CASE 
                WHEN (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) = 0 
                  THEN 1 
                ELSE (s.vehicles * CAST(SUM(m.creditspervehicleday) AS INTEGER)) 
              END
            ) AS expireindays
        FROM account_summary s
        JOIN account a ON a.accountid = s.accountid
        JOIN account_credits c ON c.accountid = a.accountid
        LEFT JOIN tagged_vehicle tvi ON tvi.dstaccountid = a.accountid
        LEFT JOIN tagged_vehicle tvo ON tvo.srcaccountid = a.accountid
        LEFT JOIN account_package_subscription aps ON aps.accountid = a.accountid
        LEFT JOIN package p ON aps.pkgid = p.pkgid
        JOIN package_module pm ON p.pkgid = pm.pkgid
        JOIN module m ON pm.moduleid = m.moduleid
        WHERE a.isenabled = TRUE 
          AND a.isdeleted = FALSE
          AND (UPPER(a.accountname) LIKE '%' || $1 || '%' OR
          UPPER(p.pkgname) LIKE '%' || $1 || '%')
        GROUP BY 
            s.accountid,
            a.accountname,
            s.users,
            s.vehicles,
            s.subscribed,
            p.pkgname,
            c.credits
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
        const countcquery = `SELECT COUNT(*) FROM account_summary s JOIN account a ON a.accountid = s.accountid JOIN account_package_subscription aps ON aps.accountid = a.accountid JOIN package p ON aps.pkgid = p.pkgid WHERE a.isenabled = TRUE AND a.isdeleted = FALSE AND (UPPER(a.accountname) LIKE '%' || $1 || '%' OR
          UPPER(p.pkgname) LIKE '%' || $1 || '%')`;
        const countcresult = await this.pgPoolI.Query(countcquery, [
          searchtext,
        ]);
        totalcount = parseInt(countcresult.rows[0].count);
      }

      if (result.rowCount === 0) {
        return {
          accounts: [],
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
          accounts: result.rows,
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
        accounts: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      this.logger.error("getAccountSummary error:", error);
      throw new Error("Failed to get account summary");
    }
  }

  async getAllAccountUsers(searchtext, offset, limit, download) {
    try {
      let baseQuery = `        
          SELECT DISTINCT 
            a.accountname AS user_accountname, 
            u.displayname AS user_displayname, 
            ep.ssoid AS user_email, 
            ms.ssoid AS user_mobile, 
            v.dealer, 
            v.vehicle_city AS delivered_city, 
            fv.vinno, 
            v.license_plate, 
            vm.modeldisplayname 
          FROM users u 
          LEFT JOIN user_fleet uf ON uf.userid = u.userid 
          LEFT JOIN account a ON a.accountid = uf.accountid 
          LEFT JOIN fleet_vehicle fv ON fv.accountid = uf.accountid AND fv.fleetid = uf.fleetid 
          LEFT JOIN vehicle v ON v.vinno = fv.vinno 
          LEFT JOIN vehicle_model vm ON vm.modelcode = v.modelcode 
          LEFT JOIN email_pwd_sso ep ON ep.userid = u.userid 
          LEFT JOIN mobile_sso ms ON ms.userid = u.userid 
          WHERE a.isenabled = TRUE 
            AND a.isdeleted = FALSE
            AND (UPPER(a.accountname) LIKE '%' || UPPER($1) || '%' OR
            UPPER(ep.ssoid) LIKE '%' || UPPER($1) || '%' OR
            UPPER(ms.ssoid) LIKE '%' || UPPER($1) || '%' OR
            UPPER(u.displayname) LIKE '%' || UPPER($1) || '%' OR
            UPPER(v.vinno) LIKE '%' || UPPER($1) || '%' OR
            UPPER(v.license_plate) LIKE '%' || UPPER($1) || '%' OR
            UPPER(v.dealer) LIKE '%' || UPPER($1) || '%' OR
            UPPER(v.vehicle_city) LIKE '%' || UPPER($1) || '%' OR
            UPPER(vm.modeldisplayname) LIKE '%' || UPPER($1) || '%')
          ORDER BY a.accountname NULLS LAST, ms.ssoid NULLS LAST, v.dealer NULLS LAST, v.vehicle_city NULLS LAST, vm.modeldisplayname NULLS LAST
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

        // Fix: Remove ORDER BY from COUNT query and use DISTINCT COUNT
        const countcquery = `SELECT COUNT(DISTINCT u.userid) 
        FROM users u 
        LEFT JOIN user_fleet uf ON uf.userid = u.userid 
        LEFT JOIN account a ON a.accountid = uf.accountid 
        LEFT JOIN fleet_vehicle fv ON fv.accountid = uf.accountid AND fv.fleetid = uf.fleetid 
        LEFT JOIN vehicle v ON v.vinno = fv.vinno 
        LEFT JOIN vehicle_model vm ON vm.modelcode = v.modelcode 
        LEFT JOIN email_pwd_sso ep ON ep.userid = u.userid 
        LEFT JOIN mobile_sso ms ON ms.userid = u.userid 
        WHERE a.isenabled = TRUE 
          AND a.isdeleted = FALSE
          AND (UPPER(a.accountname) LIKE '%' || $1 || '%' OR
          UPPER(ep.ssoid) LIKE '%' || $1 || '%' OR
          UPPER(ms.ssoid) LIKE '%' || $1 || '%' OR
          UPPER(u.displayname) LIKE '%' || $1 || '%' OR
          UPPER(v.vinno) LIKE '%' || $1 || '%' OR
          UPPER(v.license_plate) LIKE '%' || $1 || '%' OR
          UPPER(v.dealer) LIKE '%' || $1 || '%' OR
          UPPER(v.vehicle_city) LIKE '%' || $1 || '%' OR
          UPPER(vm.modeldisplayname) LIKE '%' || $1 || '%')`;
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
      this.logger.error("getAllAccountUsers error:", error);
      throw error;
    }
  }

  async getAllLoggedInAccountUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    try {
      // Build WHERE clause conditionally based on searchtext
      let orderbyclause = `ORDER BY a.accountname NULLS LAST, ms.ssoid NULLS LAST, v.dealer NULLS LAST, v.vehicle_city NULLS LAST, vm.modeldisplayname NULLS LAST`;
      if (orderbyfield && orderbydirection) {
        orderbyclause = `ORDER BY ${orderbyfield} ${orderbydirection} NULLS LAST`;
      }
      const searchCondition =
        searchtext && searchtext.trim() !== ""
          ? `AND (UPPER(COALESCE(a.accountname, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(ep.ssoid, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(ms.ssoid, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(u.displayname, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(v.vinno, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(v.license_plate, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(v.dealer, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(v.vehicle_city, '')) LIKE '%' || $1 || '%' OR
            UPPER(COALESCE(vm.modeldisplayname, '')) LIKE '%' || $1 || '%')`
          : "";

      let baseQuery = `
        SELECT DISTINCT 
          a.accountname AS user_accountname, 
          u.displayname AS user_displayname, 
          COALESCE(mss.ssoid, ep.ssoid) AS user_email, 
          ms.ssoid AS user_mobile, 
          v.dealer, 
          v.vehicle_city AS delivered_city, 
          fv.vinno, 
          v.license_plate, 
          vm.modeldisplayname 
        FROM (SELECT DISTINCT userid FROM user_login_audit) ua 
        JOIN users u ON u.userid = ua.userid 
        LEFT JOIN user_fleet uf ON uf.userid = u.userid 
        LEFT JOIN account a ON a.accountid = uf.accountid 
        LEFT JOIN fleet_vehicle fv ON fv.accountid = uf.accountid AND fv.fleetid = uf.fleetid 
        LEFT JOIN vehicle v ON v.vinno = fv.vinno 
        LEFT JOIN vehicle_model vm ON vm.modelcode = v.modelcode 
        LEFT JOIN email_pwd_sso ep ON ep.userid = u.userid 
        LEFT JOIN mobile_sso ms ON ms.userid = u.userid 
        LEFT JOIN mahindra_sso mss ON mss.userid = u.userid 
        WHERE (a.accountid IS NULL OR (a.isenabled = TRUE AND a.isdeleted = FALSE))
          ${searchCondition}
        ${orderbyclause}
      `;

      let result;
      let totalcount;
      const params = searchtext && searchtext.trim() !== "" ? [searchtext] : [];

      if (download) {
        // When downloading, get all data without pagination
        result = await this.pgPoolI.Query(baseQuery, params);
        totalcount = result.rowCount;
      } else {
        // Normal pagination flow
        let { query, params: paginationParams } = addPaginationToQuery(
          baseQuery,
          offset,
          limit,
          params
        );
        result = await this.pgPoolI.Query(query, paginationParams);

        // Count query - use DISTINCT to match the main query
        const countQuery = `
          SELECT COUNT(*) 
          FROM (SELECT DISTINCT userid FROM user_login_audit) ua 
          JOIN users u ON u.userid = ua.userid 
          LEFT JOIN user_fleet uf ON uf.userid = u.userid 
          LEFT JOIN account a ON a.accountid = uf.accountid 
          LEFT JOIN fleet_vehicle fv ON fv.accountid = uf.accountid AND fv.fleetid = uf.fleetid 
          LEFT JOIN vehicle v ON v.vinno = fv.vinno 
          LEFT JOIN vehicle_model vm ON vm.modelcode = v.modelcode 
          LEFT JOIN email_pwd_sso ep ON ep.userid = u.userid 
          LEFT JOIN mobile_sso ms ON ms.userid = u.userid 
          LEFT JOIN mahindra_sso mss ON mss.userid = u.userid 
          WHERE (a.accountid IS NULL OR (a.isenabled = TRUE AND a.isdeleted = FALSE))
            ${searchCondition}
        `;
        const countcresult = await this.pgPoolI.Query(countQuery, params);
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
        hasmore: nextOffset < totalcount,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      this.logger.error("getAllLoggedInAccountUsers error:", error);
      throw error;
    }
  }

  async listPendingAccountReviews() {
    try {
      let query = `SELECT * FROM reviewpendingaccount ORDER BY updatedat ASC LIMIT 100`;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw new Error(
        `Failed to list pending account reviews: ${error.message}`
      );
    }
  }

  async listAllAccounts() {
    try {
      let query = `
        SELECT accountid, accountname, accounttype, accountinfo->'primarycontact'->'emaillist' as email,accountinfo->'primarycontact'->'mobilelist' as mobile, isenabled, isdeleted, createdat FROM account
        WHERE isenabled = TRUE 
          AND isdeleted = FALSE
        ORDER BY createdat DESC
      `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      this.logger.error("listAllAccounts error:", error);
      throw error;
    }
  }
  async accountsAvailableForTagging(
    platformAccountId,
    vinno,
    searchtext,
    offset,
    limit
  ) {
    try {
      // TODO: ideally we should not return platform account
      let baseQuery = `
            SELECT DISTINCT a.accountid, a.accountname, a.updatedat
            FROM account a
            WHERE a.accounttype = 'customer'
              AND a.isdeleted = false
              AND a.accountid != $3
              AND UPPER(a.accountname) LIKE '%' || $1 || '%'

              AND NOT EXISTS (
                  SELECT 1
                  FROM tagged_vehicle tv
                  WHERE tv.vinno = $2
                    AND (
                        tv.srcaccountid = a.accountid
                        OR tv.dstaccountid = a.accountid
                    )
                    AND tv.isactive = true
              )

              AND NOT EXISTS (
                  SELECT 1
                  FROM fleet_vehicle fv
                  WHERE fv.vinno = $2
                    AND fv.accountid = a.accountid
              )

            ORDER BY a.updatedat DESC
            OFFSET $4 LIMIT $5`;
      let params = [searchtext, vinno, platformAccountId, offset, limit];
      let result = await this.pgPoolI.Query(baseQuery, params);
      if (result.rowCount === 0) {
        return {
          accounts: [],
          previousoffset: 0,
          nextoffset: 0,
          limit: limit,
          hasmore: false,
          totalcount: 0,
          totalpages: 0,
        };
      }
      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;
      const countcquery = `SELECT COUNT(DISTINCT a.accountid)
                            FROM account a
                            WHERE a.accounttype = 'customer'
                              AND a.isdeleted = false
                              AND a.accountid != $3
                              AND UPPER(a.accountname) LIKE '%' || $1 || '%'

                              AND NOT EXISTS (
                                  SELECT 1
                                  FROM tagged_vehicle tv
                                  WHERE tv.vinno = $2
                                    AND (
                                        tv.srcaccountid = a.accountid
                                        OR tv.dstaccountid = a.accountid
                                    )
                              )

                              AND NOT EXISTS (
                                  SELECT 1
                                  FROM fleet_vehicle fv
                                  WHERE fv.vinno = $2
                                    AND fv.accountid = a.accountid
                              )`;
      const countcresult = await this.pgPoolI.Query(countcquery, [
        searchtext,
        vinno,
        platformAccountId,
      ]);
      const totalcount = parseInt(countcresult.rows[0].count);
      return {
        accounts: result.rows,
        previousoffset: previousOffset,
        nextoffset: nextOffset,
        limit: limit,
        hasmore: limit > result.rowCount ? false : true,
        totalcount: totalcount,
        totalpages: Math.ceil(totalcount / limit),
      };
    } catch (error) {
      throw error;
    }
  }

  async getAccountCategory() {
    try {
      let query = `SELECT categorycode, categoryname FROM accountcategory where categorycode != 'console'`;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      this.logger.error("getAccountCategory error:", error);
      throw error;
    }
  }
}
