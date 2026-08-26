import { DateTime } from "luxon";
import ClickHouseClient from "../../../utils/clickhouse.js";
import {
  ADMIN_ROLE_ID,
  FLEET_INVITE_EXPIRY_TIME,
  FLEET_INVITE_STATUS,
  FLEET_INVITE_TYPE,
  NEGATIVE_CREDIT_THRESHOLD,
  VEHICLE_ACTION,
} from "../../../utils/constant.js";
import {
  getInviteEmailTemplate,
  isRedundantInvite,
  markInviteAsExpired,
  updateInviteExpiryAndSendEmail,
} from "../../../utils/inviteUtil.js";
import { v4 as uuidv4 } from "uuid";

export default class FmsAccountSvcDB {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.clickHouseClient = new ClickHouseClient();
    this.config = config;
  }

  async getUserDisplayName(userid) {
    let query = `SELECT displayname FROM users WHERE userid = $1`;
    let result = await this.pgPoolI.Query(query, [userid]);
    return result.rows[0];
  }

  async listInvitesOfAccount(accountid) {
    try {
      let query = `
      SELECT 
        fip.inviteid, fip.accountid, fip.fleetid, 
        fip.contact, fip.roleid, fip.invitetype, fip.invitestatus, 
        fip.createdat as invitedat, u1.displayname as invitedby, fip.updatedat as updatedat, u2.displayname as updatedby,
        a.accountname, ft.name as fleetname,
        fip.expiresat,
        r.rolename
      FROM fleet_invite_pending fip
      JOIN account a ON fip.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
      JOIN fleet_tree ft ON fip.accountid = ft.accountid AND fip.fleetid = ft.fleetid
      JOIN roles r ON fip.accountid = r.accountid AND fip.roleid = r.roleid
      LEFT JOIN users u1 ON fip.createdby = u1.userid
      LEFT JOIN users u2 ON fip.updatedby = u2.userid
      WHERE fip.accountid = $1
      
      UNION ALL
      
      SELECT 
        fid.inviteid, fid.accountid, fid.fleetid, 
        fid.contact, fid.roleid, fid.invitetype, fid.invitestatus, 
        fid.createdat as inviteacceptedat, u1.displayname as invitedby, fid.updatedat as updatedat, u2.displayname as updatedby,
        a.accountname, ft.name as fleetname,
        fid.updatedat as expiresat,
        r.rolename
      FROM fleet_invite_done fid
      JOIN account a ON fid.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
      JOIN fleet_tree ft ON fid.accountid = ft.accountid AND fid.fleetid = ft.fleetid
      JOIN roles r ON fid.accountid = r.accountid AND fid.roleid = r.roleid
      LEFT JOIN users u1 ON fid.createdby = u1.userid
      LEFT JOIN users u2 ON fid.updatedby = u2.userid
      WHERE fid.accountid = $1
      
      ORDER BY invitedat DESC
    `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return [];
      }

      for (let invite of result.rows) {
        let contacttype = "contact";
        if (invite.invitetype === FLEET_INVITE_TYPE.EMAIL) {
          contacttype = "email";
        } else if (invite.invitetype === FLEET_INVITE_TYPE.MOBILE) {
          contacttype = "mobile";
        }
        invite.info = {
          [contacttype]: invite.contact,
          roleids: [invite.roleid],
          rolenames: [invite.rolename],
        };
        delete invite.contact;
        delete invite.roleid;
        delete invite.rolename;
      }

      return result.rows;
    } catch (error) {
      throw new Error("Failed to retrieve account invites");
    }
  }

  async listInvitesOfFleet(accountid, fleetid, recursive = false) {
    try {
      let query;
      let params = [accountid, fleetid];

      if (recursive) {
        query = `
          WITH RECURSIVE fleet_hierarchy AS (
            SELECT fleetid, accountid, pfleetid, name
            FROM fleet_tree 
            WHERE accountid = $1 AND fleetid = $2
            
            UNION ALL
            
            SELECT ft.fleetid, ft.accountid, ft.pfleetid, ft.name
            FROM fleet_tree ft
            INNER JOIN fleet_hierarchy fh ON ft.pfleetid = fh.fleetid AND ft.accountid = fh.accountid
          )
          SELECT 
            fip.inviteid, fip.accountid, fip.fleetid, 
            fip.contact, fip.roleid, fip.invitetype, fip.invitestatus, 
            fip.createdat as invitedat, u1.displayname as invitedby, fip.updatedat as updatedat, u2.displayname as updatedby,
            a.accountname, ft.name as fleetname,
            fip.expiresat,
            r.rolename
          FROM fleet_invite_pending fip
          JOIN account a ON fip.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
          JOIN fleet_tree ft ON fip.accountid = ft.accountid AND fip.fleetid = ft.fleetid
          JOIN roles r ON fip.accountid = r.accountid AND fip.roleid = r.roleid
          LEFT JOIN users u1 ON fip.createdby = u1.userid
          LEFT JOIN users u2 ON fip.updatedby = u2.userid
          WHERE fip.accountid = $1 AND fip.fleetid IN (SELECT fleetid FROM fleet_hierarchy)
          
          UNION ALL
          
          SELECT 
            fid.inviteid, fid.accountid, fid.fleetid, 
            fid.contact, fid.roleid, fid.invitetype, fid.invitestatus, 
            fid.createdat as inviteacceptedat, u1.displayname as invitedby, fid.updatedat as updatedat, u2.displayname as updatedby,
            a.accountname, ft.name as fleetname,
            fid.updatedat as expiresat,
            r.rolename
          FROM fleet_invite_done fid
          JOIN account a ON fid.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
          JOIN fleet_tree ft ON fid.accountid = ft.accountid AND fid.fleetid = ft.fleetid
          JOIN roles r ON fid.accountid = r.accountid AND fid.roleid = r.roleid
          LEFT JOIN users u1 ON fid.createdby = u1.userid
          LEFT JOIN users u2 ON fid.updatedby = u2.userid
          WHERE fid.accountid = $1 AND fid.fleetid IN (SELECT fleetid FROM fleet_hierarchy)
          
          ORDER BY invitedat DESC
        `;
      } else {
        query = `
          SELECT 
            fip.inviteid, fip.accountid, fip.fleetid, 
            fip.contact, fip.roleid, fip.invitetype, fip.invitestatus, 
            fip.createdat as invitedat, u1.displayname as invitedby, fip.updatedat as updatedat, u2.displayname as updatedby,
            a.accountname, ft.name as fleetname,
            fip.expiresat,
            r.rolename
          FROM fleet_invite_pending fip
          JOIN account a ON fip.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
          JOIN fleet_tree ft ON fip.accountid = ft.accountid AND fip.fleetid = ft.fleetid
          JOIN roles r ON fip.accountid = r.accountid AND fip.roleid = r.roleid
          LEFT JOIN users u1 ON fip.createdby = u1.userid
          LEFT JOIN users u2 ON fip.updatedby = u2.userid
          WHERE fip.accountid = $1 AND fip.fleetid = $2
          
          UNION ALL
          
          SELECT 
            fid.inviteid, fid.accountid, fid.fleetid, 
            fid.contact, fid.roleid, fid.invitetype, fid.invitestatus, 
            fid.createdat as inviteacceptedat, u1.displayname as invitedby, fid.updatedat as updatedat, u2.displayname as updatedby,
            a.accountname, ft.name as fleetname,
            fid.updatedat as expiresat,
            r.rolename
          FROM fleet_invite_done fid
          JOIN account a ON fid.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
          JOIN fleet_tree ft ON fid.accountid = ft.accountid AND fid.fleetid = ft.fleetid
          JOIN roles r ON fid.accountid = r.accountid AND fid.roleid = r.roleid
          LEFT JOIN users u1 ON fid.createdby = u1.userid
          LEFT JOIN users u2 ON fid.updatedby = u2.userid
          WHERE fid.accountid = $1 AND fid.fleetid = $2
          
          ORDER BY invitedat DESC
        `;
      }

      let result = await this.pgPoolI.Query(query, params);
      if (result.rowCount === 0) {
        return [];
      }

      for (let invite of result.rows) {
        let contacttype = "contact";
        if (invite.invitetype === FLEET_INVITE_TYPE.EMAIL) {
          contacttype = "email";
        } else if (invite.invitetype === FLEET_INVITE_TYPE.MOBILE) {
          contacttype = "mobile";
        }
        invite.info = {
          [contacttype]: invite.contact,
          roleids: [invite.roleid],
          rolenames: [invite.rolename],
        };
        delete invite.contact;
        delete invite.roleid;
        delete invite.rolename;
      }

      return result.rows;
    } catch (err) {
      this.logger.error(`listInvitesOfFleet error: ${err}`);
      throw err;
    }
  }

  async triggerEmailInvite(
    accountid,
    fleetid,
    roleids,
    inviteid,
    contact,
    invitedby,
    headerReferer
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if email already exists in user sso table
      let redundantInvite = await isRedundantInvite(
        accountid,
        fleetid,
        contact,
        roleids,
        txclient
      );
      if (redundantInvite) {
        this.logger.info(
          `fmsaccountsvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, contact: ${contact}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
        );
        throw new Error("Email already invited to fleet with same role");
      }

      // check if fleetid is valid
      let query = `
                SELECT fleetid FROM account_fleet WHERE accountid = $1 AND fleetid = $2
            `;
      let result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Invalid fleet id");
      }

      // Check for existing pending invites for this email and role combinations
      query = `
                SELECT inviteid, invitestatus, roleid, expiresat FROM fleet_invite_pending 
                WHERE accountid = $1 AND fleetid = $2 AND contact = $3 AND invitetype = $4 AND invitestatus = $5 AND roleid = ANY($6)
            `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        contact,
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
              `fmsaccountsvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
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
            `fmsaccountsvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
          );
          let res = await updateInviteExpiryAndSendEmail(
            accountid,
            fleetid,
            inviteToUpdate.inviteid,
            { email: contact, roleid: inviteToUpdate.roleid },
            currtime,
            headerReferer,
            contact,
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
          contact,
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
                SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false AND isenabled = true
            `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found or not enabled");
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
        contact
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

  async triggerMahindrassoInvite(
    accountid,
    fleetid,
    roleids,
    inviteid,
    contact,
    invitedby,
    headerReferer
  ) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {;
      // check if mahindrasso id already exists in user sso table
      let redundantInvite = await isRedundantInvite(
        accountid,
        fleetid,
        contact,
        roleids,
        txclient
      );
      if (redundantInvite) {
        this.logger.info(
          `fmsaccountsvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, contact: ${contact}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
        );
        throw new Error("Email already invited to fleet with same role");
      }

      // check if fleetid is valid
      let query = `
                SELECT fleetid FROM account_fleet WHERE accountid = $1 AND fleetid = $2
            `;
      let result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount !== 1) {
        throw new Error("Invalid fleet id");
      }

      // Check if mahindrasso id already exists in user sso table
      query = `
        SELECT userid FROM mahindra_sso WHERE ssoid = $1 or secondaryssoid = $1
      `;
      result = await txclient.query(query, [contact]);
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
          contact,
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
          contact,
          userid,
          {},
          contact,
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
          contact,
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
        contact,
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
              `fmsaccountsvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
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
            `fmsaccountsvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
          );
          let res = await updateInviteExpiryAndSendEmail(
            accountid,
            fleetid,
            inviteToUpdate.inviteid,
            { email: contact, roleid: inviteToUpdate.roleid },
            currtime,
            headerReferer,
            contact,
            txclient
          );

          let commiterr = await this.pgPoolI.TxCommit(txclient);
          if (commiterr) {
            throw commiterr;
          }
          return {
            accountid: accountid,
            fleetid: fleetid,
            inviteid: inviteid,
            success: true,
            isUpdated: true,
          };
        }
      }

      this.logger.info(
        `fmsaccountsvc_db.triggerEmailInviteToRootFleet: Sending new invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, contact: ${contact}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
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
          contact,
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
        contact
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
        contact: contact,
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

  async cancelEmailInvite(accountid, inviteid, cancelledby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE accountid = $1 AND inviteid = $2
            `;
      let result = await txclient.query(query, [accountid, inviteid]);
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
          `fmsaccountsvc_db.cancelEmailInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );
        const error = new Error("Cannot cancel an expired invite");
        error.errcode = "CANNOT_CANCEL_AN_EXPIRED_INVITE";
        throw error;
      }

      query = `
                UPDATE fleet_invite_pending
                SET invitestatus = $1, updatedat = $2, updatedby = $3
                WHERE inviteid = $4
            `;
      result = await txclient.query(query, [
        FLEET_INVITE_STATUS.CANCELLED,
        currtime,
        cancelledby,
        inviteid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to cancel invite");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return {
        inviteid: inviteid,
        accountid: accountid,
        invitestatus: FLEET_INVITE_STATUS.CANCELLED,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async validateInvite(inviteid, userid) {
    let currtime = new Date();
    let isdifferentuser = false;

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      this.logger.error("Failed to start transaction", err);
      return {
        isvalid: false,
        invalidreason: "Something went wrong",
        isdifferentuser: isdifferentuser,
      };
    }

    try {
      // check if inviteid is valid
      let query = `
                SELECT inviteid, accountid, fleetid, contact, roleid, invitetype, invitestatus, expiresat, createdat, createdby, updatedat, updatedby FROM fleet_invite_pending WHERE inviteid = $1
            `;
      let result = await txclient.query(query, [inviteid]);
      if (result.rowCount !== 1) {
        this.logger.error("Invalid invite id", inviteid);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          invalidreason: "Invalid invite id",
        };
      }

      let invite = result.rows[0];
      const inviteemail = invite.contact;

      const mahindrassoemailregex = /^[a-zA-Z0-9._%+-]+@mahindra\.com$/;
      let isuseralreadyexists = false;
      let inviteuserid = null;
      let mahindrassoemail = false;
      let firstlogin = false;
      if (mahindrassoemailregex.test(inviteemail.toLowerCase())) {
        query = `
          SELECT u.userid, u.isemailverified FROM mahindra_sso ms JOIN users u ON ms.userid = u.userid WHERE ms.ssoid = $1 or ms.secondaryssoid = $1
        `;
        result = await txclient.query(query, [inviteemail]);
        if (result.rowCount !== 0) {
          isuseralreadyexists = true;
          inviteuserid = result.rows[0].userid;
          if (userid !== inviteuserid) {
            isdifferentuser = true;
          }
          mahindrassoemail = true;
          if (!result.rows[0].isemailverified) {
            firstlogin = true;
          }
        }
      } else {
        // check if email already exists
        query = `
                SELECT u.userid, u.isemailverified FROM email_pwd_sso ep JOIN users u ON ep.userid = u.userid WHERE ep.ssoid = $1
            `;
        result = await txclient.query(query, [inviteemail]);
        if (result.rowCount !== 0) {
          isuseralreadyexists = true;
          inviteuserid = result.rows[0].userid;
          mahindrassoemail = false;
          if (!result.rows[0].isemailverified) {
            firstlogin = true;
          }
        }
        if (userid) {
          if (inviteuserid !== userid) {
            isdifferentuser = true;
          }
        }
      }

      if (invite.invitestatus !== FLEET_INVITE_STATUS.PENDING) {
        this.logger.error("Invite is not in sent state", inviteid);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          invalidreason: "Invite is no longer valid state",
          firstlogin: firstlogin,
        };
      }

      // TODO: temporary condition
      if (invite.invitetype !== FLEET_INVITE_TYPE.EMAIL) {
        this.logger.error("Invite is not an email invite", inviteid);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          invalidreason:
            "Invite is not an email invite. currently only email invites are supported",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      const inviteexpiresat = invite.expiresat;

      if (new Date(inviteexpiresat) < currtime) {
        this.logger.info(
          `fmsaccountsvc_db.validateInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
          currtime,
          FLEET_INVITE_STATUS.EXPIRED,
          txclient
        );

        let commiterr = await this.pgPoolI.TxCommit(txclient);
        if (commiterr) {
          this.logger.error("Failed to commit transaction", commiterr);
        }
        return {
          isvalid: false,
          invalidreason: "Invite has expired",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      // get account name and fleet name for invite text
      query = `
                SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false AND isenabled = true
            `;
      result = await txclient.query(query, [invite.accountid]);
      if (result.rowCount !== 1) {
        this.logger.error("Account not found or not enabled", inviteid);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          invalidreason: "Invited account not found",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }
      const accountname = result.rows[0].accountname;

      query = `
                SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
            `;
      result = await txclient.query(query, [invite.accountid, invite.fleetid]);
      if (result.rowCount !== 1) {
        this.logger.error("Fleet not found", inviteid);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          invalidreason: "Invited fleet not found",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      const fleetname = result.rows[0].name;

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        this.logger.error("Failed to commit transaction", commiterr);
        let rollbackerr = await this.pgPoolI.TxRollback(txclient);
        if (rollbackerr) {
          this.logger.error("Failed to rollback transaction", rollbackerr);
        }
        return {
          isvalid: false,
          invalidreason: "Something went wrong",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      return {
        inviteid: inviteid,
        accountid: invite.accountid,
        fleetid: invite.fleetid,
        accountname: accountname,
        fleetname: fleetname,
        inviteemail: inviteemail,
        inviteexpiresat: inviteexpiresat,
        inviteinfo: { email: invite.contact, roleids: [invite.roleid] }, // Convert to expected format
        isuseralreadyexists: isuseralreadyexists,
        isvalid: true,
        isdifferentuser: isdifferentuser,
        firstlogin: firstlogin,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        this.logger.error("Failed to rollback transaction", rollbackerr);
      }
      this.logger.error("Failed to validate invite", e);
      return {
        isvalid: false,
        invalidreason: "Unknown error",
        isdifferentuser: isdifferentuser,
        firstlogin: firstlogin,
      };
    }
  }

  async deleteUserRecords(userid, accountid, fleetid, inviteid, deletedby) {
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
        this.logger.warn("Failed to insert back into fleet_invite_pending", {
          accountid,
          fleetid,
          inviteid,
        });
      }

      // 2. Delete from fleet_invite_done
      query = `
       DELETE FROM fleet_invite_done 
       WHERE inviteid = $1
     `;
      result = await txclient.query(query, [inviteid]);
      if (result.rowCount === 0) {
        this.logger.warn("No fleet_invite_done record found to delete", {
          accountid,
          fleetid,
          inviteid,
        });
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
      const roleids = result.rows.map(row => row.roleid); // array of roleids

      query = `
        DELETE FROM fleet_user_role 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      result = await txclient.query(query, [accountid, fleetid, userid]);
      if (result.rowCount === 0) {
        this.logger.warn("No fleet_user_role records found to delete", {
          accountid,
          fleetid,
          userid,
        });
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
          'REMOVE',
          currtime,
          deletedby,
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
        this.logger.warn("No user_fleet records found to delete", {
          accountid,
          fleetid,
          userid,
        });
      }

      // 5. Delete from user_sso (depends on users)
      query = `
        DELETE FROM user_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        this.logger.warn("No user_sso records found to delete", {
          userid,
        });
      }

      // 6. Delete from email_pwd_sso (depends on users)
      query = `
        DELETE FROM email_pwd_sso 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        this.logger.warn("No email_pwd_sso records found to delete", {
          userid,
        });
      }

      // 7. Finally delete from users (this is the main table)
      query = `
        DELETE FROM users 
        WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        this.logger.warn("No user record found to delete", {
          userid,
        });
        throw new Error("User record not found");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        success: true,
        message: "User records deleted successfully",
        deletedRecords: {
          userid,
          accountid,
          fleetid,
          inviteid,
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        this.logger.error("Failed to rollback transaction", rollbackerr);
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
          `fmsaccountsvc_db.resendInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${inviteid}`
        );
        await markInviteAsExpired(
          invite.accountid,
          invite.fleetid,
          invite.inviteid,
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

  // fleet management
  async getFleetInfo(accountid, fleetid) {
    try {
      let query = `
                SELECT ft.fleetid, ft.name as fleetname, ft.fleetinfo, ft.isdeleted, af.isroot, af.createdat, u1.displayname as createdby, u2.displayname as updatedby, ft.updatedat
                FROM fleet_tree ft
                JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
                JOIN users u1 ON af.createdby = u1.userid
                JOIN users u2 ON ft.updatedby = u2.userid
                WHERE ft.accountid = $1 AND ft.fleetid = $2
            `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      if (result.rowCount !== 1) {
        return null;
      }
      return result.rows[0];
    } catch (e) {
      throw new Error("Failed to retrieve fleet information");
    }
  }

  async createFleet(accountid, fleetid, parentfleetid, fleetname, createdby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
                    INSERT INTO account_fleet (accountid, fleetid, isroot, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
                `;
      let result = await txclient.query(query, [
        accountid,
        fleetid,
        false,
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create fleet");
      }

      query = `
                    INSERT INTO fleet_tree (accountid, pfleetid, fleetid, name, isdeleted, fleetinfo, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `;
      result = await txclient.query(query, [
        accountid,
        parentfleetid,
        fleetid,
        fleetname,
        false,
        {},
        currtime,
        createdby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create fleet");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return {
        accountid: accountid,
        parentfleetid: parentfleetid,
        fleetid: fleetid,
        fleetname: fleetname,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async editFleet(accountid, fleetid, updateFields, updatedby) {
    try {
      let currtime = new Date();
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      const setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 3}`)
        .join(", ");

      const query = `
      UPDATE fleet_tree
      SET ${setClause}
      WHERE accountid = $1 AND fleetid = $2
    `;

      const params = [accountid, fleetid, ...Object.values(updateFields)];
      let result = await this.pgPoolI.Query(query, params);
      if (result.rowCount !== 1) {
        throw new Error("FLEET_NOT_FOUND");
      }

      return {
        accountid,
        fleetid,
        updatedFields: Object.keys(updateFields),
      };
    } catch (e) {
      throw new Error("Failed to edit fleet information");
    }
  }

  async getSubFleets(accountid, fleetid, recursive = false) {
    try {
      if (recursive) {
        // Get all nested subfleets with path
        let query = `
                WITH RECURSIVE subfleets AS (
                    SELECT ft.fleetid, ft.pfleetid, ft.name as fleetname, ft.fleetinfo, ft.isdeleted, af.isroot, af.createdat, ft.updatedat, 
                           u1.displayname as createdby, u2.displayname as updatedby, 1 as depth,
                           ft.name as path
                    FROM fleet_tree ft
                    JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
                    JOIN users u1 ON af.createdby = u1.userid
                    JOIN users u2 ON ft.updatedby = u2.userid
                    WHERE ft.accountid = $1 AND ft.pfleetid = $2 AND ft.isdeleted = false
                    
                    UNION ALL
                    
                    SELECT ft.fleetid, ft.pfleetid, ft.name as fleetname, ft.fleetinfo, ft.isdeleted, af.isroot, af.createdat, ft.updatedat,
                           u1.displayname as createdby, u2.displayname as updatedby, sf.depth + 1,
                           sf.path || '/' || ft.name as path
                    FROM fleet_tree ft
                    JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
                    JOIN users u1 ON af.createdby = u1.userid
                    JOIN users u2 ON ft.updatedby = u2.userid
                    JOIN subfleets sf ON ft.pfleetid = sf.fleetid
                    WHERE ft.accountid = $1 AND ft.isdeleted = false
                )
                SELECT * FROM subfleets
                ORDER BY depth, fleetname
            `;
        let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
        if (result.rowCount === 0) {
          return [];
        }
        return result.rows;
      } else {
        // Get only direct children (unchanged)
        let query = `
                SELECT ft.fleetid, ft.pfleetid, ft.name as fleetname, ft.fleetinfo, ft.isdeleted, af.isroot, af.createdat, ft.updatedat,
                       u1.displayname as createdby, u2.displayname as updatedby
                FROM fleet_tree ft
                JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
                JOIN users u1 ON af.createdby = u1.userid
                JOIN users u2 ON ft.updatedby = u2.userid
                WHERE ft.accountid = $1 AND ft.pfleetid = $2 AND ft.isdeleted = false
                ORDER BY ft.name
            `;
        let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
        if (result.rowCount === 0) {
          return [];
        }
        return result.rows;
      }
    } catch (error) {
      throw new Error("Failed to retrieve subfleets. Please try again later.");
    }
  }

  async getChildFleets(accountid, fleetid, isrecursive = false) {
    try {
      let query = `
        SELECT fleetid FROM fleet_tree WHERE accountid = $1 AND pfleetid = $2 AND isdeleted = false
      `;
      if (isrecursive) {
        query = `
          WITH RECURSIVE child_fleets AS (
            SELECT accountid, fleetid FROM fleet_tree WHERE accountid = $1 AND pfleetid = $2 AND isdeleted = false
            UNION ALL
            SELECT ft.accountid, ft.fleetid FROM fleet_tree ft
            JOIN child_fleets cf ON ft.accountid = cf.accountid AND ft.pfleetid = cf.fleetid AND ft.isdeleted = false
          )
          SELECT fleetid FROM child_fleets
        `;
      }
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        return [];
      }

      let fleets = result.rows.map((row) => row.fleetid);

      fleets = fleets.filter((fleet) => fleet !== fleetid);

      return fleets;
    } catch (error) {
      throw new Error(
        "Failed to retrieve child fleets. Please try again later."
      );
    }
  }

  async getFleetCount(accountid) {
    try {
      let query = `
        SELECT COUNT(*) as total_fleets
        FROM account_fleet af
        WHERE af.accountid = $1
      `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      return parseInt(result.rows[0].total_fleets);
    } catch (error) {
      throw new Error("Failed to count fleets for account");
    }
  }

  async getFleetDepthFromRoot(accountid, fleetid) {
    try {
      let query = `
        WITH RECURSIVE hierarchy AS (
          SELECT 
              ft.accountid,
              ft.pfleetid,
              ft.fleetid,
              1 AS depth,
              ARRAY[ft.fleetid] AS path
          FROM fleet_tree ft
          WHERE ft.accountid = $1 AND ft.fleetid = $2 AND ft.isdeleted = false

          UNION ALL

          SELECT 
              parent.accountid,
              parent.pfleetid,
              parent.fleetid,
              child.depth + 1,
              child.path || parent.fleetid
          FROM fleet_tree parent
          JOIN hierarchy child
            ON parent.accountid = child.accountid
           AND parent.fleetid = child.pfleetid
          WHERE parent.isdeleted = false
            AND NOT parent.fleetid = ANY(child.path)
        )
        SELECT 
            COALESCE(MAX(depth), 0) AS current_depth,
            BOOL_OR(array_length(path, 1) > depth) AS cycle_detected
        FROM hierarchy;
      `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);

      if (result.rowCount === 0) {
        throw new Error("Fleet not found or invalid fleet hierarchy");
      }

      const row = result.rows[0];

      if (row.cycle_detected) {
        throw new Error(
          "Corrupted fleet hierarchy detected - cycle found in fleet tree"
        );
      }

      return parseInt(row.current_depth);
    } catch (error) {
      if (
        error.message.includes("cycle") ||
        error.message.includes("Corrupted")
      ) {
        throw error;
      }
      throw new Error("Failed to calculate fleet depth from root");
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
      throw new Error("Failed to retrieve user information");
    }
  }

  // role management
  async createRole(role) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
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

      let currtime = new Date();
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
      await this.logRoleHistory(role, role.createdby, currtime, 'CREATE', {}, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      if (error.message === "ROLE_NAME_ALREADY_EXISTS") {
        throw new Error("ROLE_NAME_ALREADY_EXISTS");
      }
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Error creating role");
    }
  }

  async updateRole(accountid, roleid, updateFields, updatedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      const currtime = new Date();
      
      let previousStateQuery = `
        SELECT roleid, rolename, roletype, isenabled FROM roles WHERE accountid = $1 AND roleid = $2
      `;
      let previousStateResult = await txclient.query(previousStateQuery, [accountid, roleid]);
      if (previousStateResult.rowCount === 0) {
        throw new Error("Role not found");
      }
      let previousState = previousStateResult.rows[0];
      
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      const setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 3}`)
        .join(", ");

      const query = `
      UPDATE roles
      SET ${setClause}
      WHERE accountid = $1 AND roleid = $2
    `;

      const params = [accountid, roleid, ...Object.values(updateFields)];
      const result = await txclient.query(query, params);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update role");
      }

      let role = {
        accountid: accountid,
        roleid: roleid,
        rolename: updateFields.rolename !== undefined ? updateFields.rolename : previousState.rolename,
        roletype: updateFields.roletype !== undefined ? updateFields.roletype : previousState.roletype,
        isenabled: updateFields.isenabled !== undefined ? updateFields.isenabled : previousState.isenabled,
        updatedat: currtime,
        updatedby: updatedby,
      };
      
      await this.logRoleHistory(role, updatedby, currtime, 'UPDATE', previousState, txclient);
      await this.pgPoolI.TxCommit(txclient);
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error(`Unable to update role: ${error.message}`);
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
      throw new Error("Failed to retrieve roles.");
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
      throw new Error("Failed to retrieve role information.");
    }
  }

  async logRoleHistory(role, updatedby, updatedat, action, previousstate, txclient = null) {
    try {
      const finalUpdatedBy = updatedby ?? role.updatedby;
      const finalUpdatedAt = updatedat ?? role.updatedat;
      const currentstate = action === 'DELETE' 
        ? {} 
        : {
            rolename: role.rolename,
            roletype: role.roletype,
            isenabled: role.isenabled,
          };
      let query = `
        INSERT INTO role_history (accountid, roleid, rolename, roletype, isenabled, updatedat, updatedby, action, previousstate, currentstate) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `;
      let result = await txclient.query(query, [role.accountid, role.roleid, role.rolename, role.roletype, role.isenabled, finalUpdatedAt, finalUpdatedBy, action, previousstate, currentstate]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log role history");
      }
      return true;
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error(`Failed to log role history: ${error.message}`);
    }
  }

  async getRoleHistory(starttime, endtime) {
    try {
      let query = `
        SELECT a.accountname, r.roleid, r.rolename, r.roletype, r.isenabled, r.updatedat, u.displayname as updatedby, r.action, r.previousstate, r.currentstate 
        FROM role_history r 
        JOIN account a ON r.accountid = a.accountid 
        JOIN users u ON r.updatedby = u.userid 
        WHERE r.updatedat >= $1 AND r.updatedat <= $2 AND r.accountid != 'ffffffff-ffff-ffff-ffff-ffffffffffff'
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
        WHERE r.updatedat >= $1 AND r.updatedat <= $2 AND r.accountid != 'ffffffff-ffff-ffff-ffff-ffffffffffff'
        ORDER BY r.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [new Date(starttime), new Date(endtime)]);
      return result.rows;
    }
    catch (error) {
      throw new Error("Failed to retrieve role perm history");
    }
  }

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

      const accountPerms = result.rows.filter(
        (row) =>
          row.permid.startsWith("account.") || row.permid === "all.all.all"
      );

      return accountPerms;
    } catch (error) {
      throw new Error("Unable to retrieve platform permissions.");
    }
  }

  async getRolePermsForAccount(accountid, roleid) {
    try {
      let query = `
        SELECT permid FROM role_perm WHERE accountid = $1 AND roleid = $2
    `;
      let result = await this.pgPoolI.Query(query, [accountid, roleid]);
      if (result.rowCount === 0) {
        return [];
      }

      return result.rows;
    } catch (error) {
      throw new Error("Unable to retrieve role permissions.");
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

      const stateQuery = `
        SELECT permid, isenabled FROM role_perm WHERE accountid = $1 AND roleid = $2
      `;
      let stateResult = await txclient.query(stateQuery, [accountid, roleid]);
      const previousState = stateResult.rows;
      const previousPermIds = previousState.map((row) => row.permid);

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
        await this.logRolePermHistory(accountid, roleid, permid, updatedby, currtime, 'DISABLE', false, txclient);
      }

      for (const permid of addedPerms) {
        await this.logRolePermHistory(accountid, roleid, permid, updatedby, currtime, 'ENABLE', true, txclient);
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
  

  // vehicle management
  async getVehicles(accountid, fleetid, recursive, isforcedfilter) {
    try {
      let query;
      if (recursive) {
        query = `
          WITH RECURSIVE fleet_hierarchy AS (
            SELECT ft.accountid, ft.fleetid, ft.name
            FROM fleet_tree ft
            WHERE ft.accountid = $1 AND ft.fleetid = $2 AND ft.isdeleted = false
        
            UNION ALL
        
            SELECT ft.accountid, ft.fleetid, ft.name
            FROM fleet_tree ft
            JOIN fleet_hierarchy fh ON ft.accountid = fh.accountid AND ft.pfleetid = fh.fleetid
            WHERE ft.isdeleted = false
          )
          SELECT fv.accountid, fv.fleetid, fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.isowner, fv.accvininfo, 
                 fv.assignedat, fv.updatedat, u1.displayname as assignedby, u2.displayname as updatedby,
                 vm.modelvariant as vehiclevariant, vm.modelname as vehiclemodel, v.modelcode, v.vehicleinfo, v.delivered_date, v.vehicle_city, vm.modeldisplayname, af.isroot
          FROM fleet_vehicle fv
          JOIN vehicle v ON fv.vinno = v.vinno
          JOIN users u1 ON fv.assignedby = u1.userid
          JOIN users u2 ON fv.updatedby = u2.userid
          JOIN account_fleet af ON fv.accountid = af.accountid AND fv.fleetid = af.fleetid
          JOIN fleet_hierarchy fh ON fv.accountid = fh.accountid AND fv.fleetid = fh.fleetid
          JOIN vehicle_model vm ON v.modelcode = vm.modelcode
          ORDER BY fv.assignedat DESC
        `;
      } else {
        query = `
          SELECT fv.accountid, fv.fleetid, fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.isowner, fv.accvininfo, 
                 fv.assignedat, fv.updatedat, u1.displayname as assignedby, u2.displayname as updatedby,
                 vm.modelvariant as vehiclevariant, vm.modelname as vehiclemodel, v.modelcode, vm.modeldisplayname, v.vehicleinfo, v.delivered_date, v.vehicle_city, af.isroot
          FROM fleet_vehicle fv
          JOIN vehicle v ON fv.vinno = v.vinno
          JOIN users u1 ON fv.assignedby = u1.userid
          JOIN users u2 ON fv.updatedby = u2.userid
          JOIN vehicle_model vm ON v.modelcode = vm.modelcode
          JOIN account_fleet af ON fv.accountid = af.accountid AND fv.fleetid = af.fleetid
          WHERE fv.accountid = $1 AND fv.fleetid = $2
          ORDER BY fv.assignedat DESC
        `;
      }

      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        return [];
      }
      const allVehicles = result.rows;

      const shouldFilterSubscribed =
        this.config?.fmsFeatures?.enableSubscribedVehiclesFilter || false;

      if (!shouldFilterSubscribed || isforcedfilter) {
        return allVehicles;
      }

      const vinNumbers = allVehicles.map((vehicle) => vehicle.vinno);

      const subscribedQuery = `
        SELECT vinno FROM account_vehicle_subscription 
        WHERE accountid = $1 AND vinno = ANY($2) AND state = 1
      `;
      const subscribedResult = await this.pgPoolI.Query(subscribedQuery, [
        accountid,
        vinNumbers,
      ]);

      if (subscribedResult.rowCount === 0) {
        return [];
      }

      const subscribedVins = new Set(
        subscribedResult.rows.map((row) => row.vinno)
      );

      const subscribedVehicles = allVehicles.filter((vehicle) =>
        subscribedVins.has(vehicle.vinno)
      );

      return subscribedVehicles;
    } catch (error) {
      throw new Error("Unable to retrieve vehicle information");
    }
  }

  async moveVehicle(accountid, fromfleetid, tofleetid, vehicleid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT * FROM fleet_vehicle 
        WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      `;
      let result = await txclient.query(query, [
        accountid,
        fromfleetid,
        vehicleid,
      ]);
      if (result.rowCount !== 1) {
        const error = new Error("vehicle not found in source fleet");
        error.errcode = "VEHICLE_NOT_FOUND_IN_SOURCE_FLEET";
        throw error;
      }

      const vehicleData = result.rows[0];

      query = `
        SELECT vinno FROM fleet_vehicle 
        WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      `;
      result = await txclient.query(query, [accountid, tofleetid, vehicleid]);
      if (result.rowCount > 0) {
        const error = new Error("vehicle already exists in target fleet");
        error.errcode = "VEHICLE_ALREADY_EXISTS_IN_TARGET_FLEET";
        throw error;
      }

      query = `
        INSERT INTO fleet_vehicle_history (
          accountid, fleetid, vinno, isowner, accvininfo, 
          assignedat, assignedby, updatedat, updatedby, action
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      result = await txclient.query(query, [
        accountid,
        fromfleetid,
        vehicleid,
        vehicleData.isowner,
        vehicleData.accvininfo,
        vehicleData.assignedat,
        vehicleData.assignedby,
        currtime,
        vehicleData.updatedby,
        VEHICLE_ACTION.REMOVED
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create history record");
      }

      query = `
        INSERT INTO fleet_vehicle_history (
          accountid, fleetid, vinno, isowner, accvininfo, 
          assignedat, assignedby, updatedat, updatedby, action
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      result = await txclient.query(query, [
        accountid,
        tofleetid,
        vehicleid,
        vehicleData.isowner,
        vehicleData.accvininfo,
        vehicleData.assignedat,
        vehicleData.assignedby,
        currtime,
        vehicleData.updatedby,
        VEHICLE_ACTION.ADDED
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create history record");
      }

      // Delete from source fleet
      // query = `
      //   DELETE FROM fleet_vehicle
      //   WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      // `;
      // result = await txclient.query(query, [accountid, fromfleetid, vehicleid]);
      // if (result.rowCount !== 1) {
      //   throw new Error("Failed to remove vehicle from source fleet");
      // }

      // // Insert into target fleet
      // query = `
      //   INSERT INTO fleet_vehicle (
      //     accountid, fleetid, vinno, isowner, accvininfo,
      //     assignedat, assignedby, updatedat, updatedby
      //   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      // `;
      // result = await txclient.query(query, [
      //   accountid,
      //   tofleetid,
      //   vehicleid,
      //   vehicleData.isowner,
      //   vehicleData.accvininfo,
      //   currtime,
      //   vehicleData.assignedby,
      //   currtime,
      //   vehicleData.updatedby,
      // ]);
      // if (result.rowCount !== 1) {
      //   throw new Error("Failed to add vehicle to target fleet");
      // }

      query = `
        UPDATE fleet_vehicle 
        SET fleetid = $1, assignedat = $2, updatedat = $3
        WHERE accountid = $4 AND fleetid = $5 AND vinno = $6
      `;
      result = await txclient.query(query, [
        tofleetid,
        currtime,
        currtime,
        accountid,
        fromfleetid,
        vehicleid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to move vehicle to target fleet");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid: accountid,
        fromfleetid: fromfleetid,
        tofleetid: tofleetid,
        vinno: vehicleid,
        movedat: currtime,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async removeVehicle(accountid, fleetid, vehicleid) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT * FROM fleet_vehicle 
        WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      `;
      let result = await txclient.query(query, [accountid, fleetid, vehicleid]);
      if (result.rowCount !== 1) {
        throw new Error("VEHICLE_NOT_FOUND");
      }

      const vehicleData = result.rows[0];

      // Find the root fleet for this account
      query = `
        SELECT fleetid FROM account_fleet 
        WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("ROOT_FLEET_NOT_FOUND");
      }

      const rootFleetId = result.rows[0].fleetid;

      if (fleetid === rootFleetId) {
        throw new Error("VEHICLE_ALREADY_IN_ROOT_FLEET");
      }

      // Save the current state to history before moving
      query = `
        INSERT INTO fleet_vehicle_history (
          accountid, fleetid, vinno, isowner, accvininfo, 
          assignedat, assignedby, updatedat, updatedby, action
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      result = await txclient.query(query, [
        accountid,
        fleetid,
        vehicleid,
        vehicleData.isowner,
        vehicleData.accvininfo,
        vehicleData.assignedat,
        vehicleData.assignedby,
        currtime,
        vehicleData.updatedby,
        VEHICLE_ACTION.REMOVED
      ]);
      if (result.rowCount !== 1) {
        throw new Error("FAILED_TO_CREATE_HISTORY_RECORD");
      }

      query = `
        SELECT vinno FROM fleet_vehicle 
        WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      `;
      result = await txclient.query(query, [accountid, rootFleetId, vehicleid]);
      if (result.rowCount > 0) {
        throw new Error("Vehicle already exists in root fleet");
      }

      // Delete the vehicle from the current fleet
      query = `
        DELETE FROM fleet_vehicle 
        WHERE accountid = $1 AND fleetid = $2 AND vinno = $3
      `;
      result = await txclient.query(query, [accountid, fleetid, vehicleid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to remove vehicle from current fleet");
      }

      // Add the vehicle to the root fleet
      query = `
        INSERT INTO fleet_vehicle (
          accountid, fleetid, vinno, isowner, accvininfo, 
          assignedat, assignedby, updatedat, updatedby
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      result = await txclient.query(query, [
        accountid,
        rootFleetId,
        vehicleid,
        vehicleData.isowner,
        vehicleData.accvininfo,
        currtime,
        vehicleData.assignedby,
        currtime,
        vehicleData.updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add vehicle to root fleet");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid: accountid,
        fromFleetId: fleetid,
        toRootFleetId: rootFleetId,
        vinno: vehicleid,
        movedat: currtime,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async listMoveableFleets(accountid, vehicleid, userid) {
    try {
      // First verify the vehicle exists in the account
      const vehicleQuery = `
        SELECT fleetid 
        FROM fleet_vehicle 
        WHERE accountid = $1 AND vinno = $2
    `;
      const vehicleResult = await this.pgPoolI.Query(vehicleQuery, [
        accountid,
        vehicleid,
      ]);
      if (vehicleResult.rowCount === 0) {
        throw new Error("VEHICLE_NOT_FOUND");
      }

      // Get all fleets where user has permission to move vehicles
      // const query = `
      //     WITH RECURSIVE fleet_hierarchy AS (
      //         -- Base case: Get all fleets where user has direct permission
      //         SELECT
      //             ft.fleetid,
      //             ft.name as fleetname
      //         FROM fleet_tree ft
      //         JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
      //         JOIN user_fleet uf ON ft.accountid = uf.accountid AND ft.fleetid = uf.fleetid
      //         JOIN fleet_user_role fur ON uf.accountid = fur.accountid AND uf.fleetid = fur.fleetid AND uf.userid = fur.userid
      //         JOIN roles r ON fur.accountid = r.accountid AND fur.roleid = r.roleid
      //         JOIN role_perm rp ON r.accountid = rp.accountid AND r.roleid = rp.roleid
      //         WHERE ft.accountid = $1
      //         AND uf.userid = $2
      //         AND rp.permid = 'fleet.vehicle.move'
      //         AND ft.isdeleted = false
      //         AND r.isenabled = true
      //         AND rp.isenabled = true

      //         UNION ALL

      //         -- Recursive case: Get child fleets
      //         SELECT
      //             ft.fleetid,
      //             ft.name as fleetname
      //         FROM fleet_tree ft
      //         JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
      //         JOIN fleet_hierarchy fh ON ft.accountid = fh.accountid AND ft.pfleetid = fh.fleetid
      //         WHERE ft.isdeleted = false
      //     )
      //     SELECT DISTINCT
      //         fleetid,
      //         fleetname
      //     FROM fleet_hierarchy
      //     -- Exclude the current fleet where the vehicle is located
      //     WHERE fleetid != $3
      //     ORDER BY fleetname
      // `;

      const query = `
        WITH RECURSIVE fleet_hierarchy AS (
            -- Base case: Get all fleets where user is directly added
            SELECT 
                ft.accountid,
                ft.fleetid,
                ft.name as fleetname,
                ft.name as path
            FROM fleet_tree ft
            JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
            JOIN user_fleet uf ON ft.accountid = uf.accountid AND ft.fleetid = uf.fleetid
            WHERE ft.accountid = $1 
            AND uf.userid = $2
            AND ft.isdeleted = false

            UNION ALL

            -- Recursive case: Get child fleets
            SELECT 
                ft.accountid,
                ft.fleetid,
                ft.name as fleetname,
                fh.path || '/' || ft.name as path
            FROM fleet_tree ft
            JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
            JOIN fleet_hierarchy fh ON ft.accountid = fh.accountid AND ft.pfleetid = fh.fleetid
            WHERE ft.isdeleted = false
        )
        SELECT DISTINCT
            fleetid,
            fleetname,
            path
        FROM fleet_hierarchy
        -- Exclude the current fleet where the vehicle is located
        WHERE fleetid != $3
        ORDER BY path
    `;

      const result = await this.pgPoolI.Query(query, [
        accountid,
        userid,
        vehicleResult.rows[0].fleetid,
      ]);

      if (result.rowCount === 0) {
        return [];
      }

      return result.rows;
    } catch (error) {
      throw new Error("Unable to retrieve list of fleets");
    }
  }

  async getSubscribedVehiclesFromList(accountid, vehicles) {
    if (!vehicles || vehicles.length === 0) {
      return [];
    }

    // Extract VIN numbers from the vehicles list
    const vinNumbers = vehicles.map((vehicle) => vehicle.vinno);
    const vinList = vinNumbers.map((vin) => `'${vin}'`).join(",");

    let query = `
      SELECT vinno, startsat, endsat, createdat, createdby
      FROM account_vehicle_subscription 
      WHERE accountid = $1 AND state = 1 AND vinno IN (${vinList})
    `;
    let result = await this.pgPoolI.Query(query, [accountid]);
    return result.rows;
  }

  // user management
  async getFleetUsers(accountid, fleetid, recursive = false) {
    try {
      let fleetIds = [fleetid];

      if (recursive) {
        let childFleetsQuery = `
          WITH RECURSIVE subfleets AS (
            SELECT ft.fleetid
            FROM fleet_tree ft
            WHERE ft.accountid = $1 AND ft.pfleetid = $2 AND ft.isdeleted = false
            
            UNION ALL
            
            SELECT ft.fleetid
            FROM fleet_tree ft
            JOIN subfleets sf ON ft.pfleetid = sf.fleetid
            WHERE ft.accountid = $1 AND ft.isdeleted = false
          )
          SELECT fleetid FROM subfleets
        `;

        let childFleetsResult = await this.pgPoolI.Query(childFleetsQuery, [
          accountid,
          fleetid,
        ]);
        if (childFleetsResult.rowCount > 0) {
          let childFleetIds = childFleetsResult.rows.map((row) => row.fleetid);
          fleetIds = fleetIds.concat(childFleetIds);
        }
      }

      let query = `
        SELECT DISTINCT u.userid, u.displayname, u.usertype, u.userinfo, u.isenabled, u.isdeleted, 
          u.isemailverified, u.ismobileverified, u.createdat, creator.displayname as createdby, 
          u.updatedat, updater.displayname as updatedby,
          eps.ssoid as email, mps.ssoid as mobile 
        FROM users u
        JOIN fleet_user_role fur ON u.userid = fur.userid
        LEFT JOIN email_pwd_sso eps ON u.userid = eps.userid
        LEFT JOIN mobile_sso mps ON u.userid = mps.userid
        LEFT JOIN users creator ON u.createdby = creator.userid
        LEFT JOIN users updater ON u.updatedby = updater.userid
        WHERE fur.accountid = $1 AND fur.fleetid = ANY($2) AND u.isdeleted = false
        ORDER BY u.createdat DESC
      `;

      let result = await this.pgPoolI.Query(query, [accountid, fleetIds]);
      return result.rows;
    } catch (error) {
      this.logger.error(`getFleetUsers error: ${error}`);
      throw new Error("Unable to retrieve fleet users");
    }
  }

  async getAssignableRoles(accountid, fleetid, userid, assignedby) {
    try {
      // TODO: check user has permission to list roles for this fleet
      // First, get all roles for the account
      let query = `
      SELECT r.roleid, r.rolename, r.roletype, r.isenabled, r.createdat, u1.displayname as createdby, r.updatedat, u2.displayname as updatedby 
      FROM roles r 
      JOIN users u1 ON r.createdby = u1.userid 
      JOIN users u2 ON r.updatedby = u2.userid
      WHERE r.accountid = $1 AND r.isenabled = true
    `;
      let allRolesResult = await this.pgPoolI.Query(query, [accountid]);
      if (allRolesResult.rowCount === 0) {
        return [];
      }

      // Get roles already assigned to the user
      query = `
      SELECT roleid 
      FROM fleet_user_role 
      WHERE accountid = $1 AND fleetid = $2 AND userid = $3
    `;
      let userRolesResult = await this.pgPoolI.Query(query, [
        accountid,
        fleetid,
        userid,
      ]);
      let userRoleIds = userRolesResult.rows.map((row) => row.roleid);

      let assignableRoles = allRolesResult.rows.filter((role) => {
        return !userRoleIds.includes(role.roleid);
      });

      return assignableRoles;
    } catch (error) {
      throw new Error("Unable to retrieve assignable roles");
    }
  }

  async assignUserRoles(accountid, fleetid, userid, roleids, assignedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    let currtime = new Date();
    try {
      if (userid === assignedby) {
        let adminCheckQuery = `
          SELECT 1 FROM fleet_user_role fur
          JOIN account_fleet af ON fur.accountid = af.accountid AND fur.fleetid = af.fleetid
          WHERE fur.accountid = $1 AND fur.userid = $2 AND fur.roleid = $3 AND af.isroot = true
        `;
        let adminResult = await txclient.query(adminCheckQuery, [
          accountid,
          assignedby,
          ADMIN_ROLE_ID,
        ]);

        if (adminResult.rowCount === 0) {
          throw {
            errcode: "PERMISSION_DENIED",
            errdata: "Users cannot assign roles to themselves",
            message:
              "Users cannot assign roles to themselves. Only admins can assign roles to themselves.",
          };
        }
      }

      let query = `
        SELECT isroot FROM account_fleet 
        WHERE accountid = $1 AND fleetid = $2
      `;
      let result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        throw {
          errcode: "FLEET_NOT_FOUND",
          errdata: "Fleet not found",
          message: "Fleet not found or does not belong to this account",
        };
      }

      const isRootFleet = result.rows[0].isroot;

      if (!isRootFleet) {
        query = `
          WITH RECURSIVE parent_fleets AS (
            -- Get the initial fleet
            SELECT accountid, fleetid, pfleetid
            FROM fleet_tree
            WHERE accountid = $1 AND fleetid = $2
            
            UNION ALL
          
            SELECT ft.accountid, ft.fleetid, ft.pfleetid
            FROM fleet_tree ft
            JOIN parent_fleets pf ON ft.accountid = pf.accountid AND ft.fleetid = pf.pfleetid
          )
          SELECT DISTINCT uf.userid 
          FROM user_fleet uf
          JOIN parent_fleets pf ON uf.accountid = pf.accountid AND uf.fleetid = pf.fleetid
          WHERE uf.userid = $3
        `;
        result = await txclient.query(query, [accountid, fleetid, userid]);
        if (result.rowCount === 0) {
          throw {
            errcode: "USER_NOT_IN_FLEET",
            errdata: "User not found in fleet hierarchy",
            message: "User is not a member of this fleet or any parent fleet",
          };
        }
      } else {
        query = `
          SELECT userid FROM user_fleet 
          WHERE accountid = $1 AND fleetid = $2 AND userid = $3
        `;
        result = await txclient.query(query, [accountid, fleetid, userid]);
        if (result.rowCount === 0) {
          throw {
            errcode: "USER_NOT_IN_FLEET",
            errdata: "User not found in fleet",
            message: "User is not a member of this fleet",
          };
        }
      }

      for (const roleid of roleids) {
        query = `
          SELECT roleid FROM roles 
          WHERE accountid = $1 AND roleid = $2 AND isenabled = true
        `;
        result = await txclient.query(query, [accountid, roleid]);
        if (result.rowCount === 0) {
          throw {
            errcode: "ROLE_INVALID",
            errdata: `Role ${roleid} not found or disabled`,
            message: `Role ${roleid} not found or is disabled`,
          };
        }

        query = `
          SELECT roleid FROM fleet_user_role 
          WHERE accountid = $1 AND fleetid = $2 AND userid = $3 AND roleid = $4
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          userid,
          roleid,
        ]);

        if (result.rowCount > 0) {
          throw {
            errcode: "ROLE_ALREADY_ASSIGNED",
            errdata: `Role ${roleid} already assigned`,
            message: `Role ${roleid} is already assigned to this user`,
          };
        }

        query = `
          INSERT INTO fleet_user_role (accountid, fleetid, userid, roleid, assignedat, assignedby) 
          VALUES ($1, $2, $3, $4, $5, $6)
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          userid,
          roleid,
          currtime,
          assignedby,
        ]);

        query = `
          INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        result = await txclient.query(query, [
          accountid,
          fleetid,
          userid,
          roleid,
          true,
          'ASSIGN',
          currtime,
          assignedby,
        ]);

        if (result.rowCount !== 1) {
          throw {
            errcode: "ROLE_ASSIGNMENT_FAILED",
            errdata: `Failed to assign role ${roleid}`,
            message: `Failed to assign role ${roleid}`,
          };
        }
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid,
        fleetid,
        userid,
        roleids,
        assignedby,
        assignedat: currtime,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async deassignUserRole(accountid, fleetid, userid, roleid, deassignedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
      if (err) {
        throw err;
      }
    try {
      let currtime = new Date();
      // Check if user is an account admin
      if (userid === deassignedby) {
        // Check if user is an account admin
        let adminCheckQuery = `
        SELECT 1 FROM fleet_user_role fur
        JOIN account_fleet af ON fur.accountid = af.accountid AND fur.fleetid = af.fleetid
        WHERE fur.accountid = $1 AND fur.userid = $2 AND fur.roleid = $3 AND af.isroot = true
      `;
        let adminResult = await txclient.query(adminCheckQuery, [
          accountid,
          deassignedby,
          ADMIN_ROLE_ID,
        ]);

        if (adminResult.rowCount === 0) {
          const error = new Error(
            "Users cannot deassign roles. Permission denied"
          );
          error.errcode = "PERMISSION_DENIED";
          throw error;
        }

        if (roleid === ADMIN_ROLE_ID) {
          const error = new Error(
            "Account admin cannot remove their own admin role"
          );
          error.errcode = "ACCOUNT_ADMIN_CANNOT_REMOVE_OWN_ADMIN_ROLE";
          throw error;
        }
      }
      // Check if the role is assigned to the user
      let query = `
        SELECT roleid FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3 AND roleid = $4
      `;
      let roleAssignmentResult = await txclient.query(query, [
        accountid,
        fleetid,
        userid,
        roleid,
      ]);
      if (roleAssignmentResult.rowCount === 0) {
        const error = new Error("Role is not assigned to the user");
        error.errcode = "ROLE_NOT_ASSIGNED";
        throw error;
      }

      // Check if this is the last role for the user in this account-fleet
      let roleCountQuery = `
        SELECT COUNT(*) as count FROM fleet_user_role 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      let roleCountResult = await txclient.query(roleCountQuery, [
        accountid,
        fleetid,
        userid,
      ]);

      if (parseInt(roleCountResult.rows[0].count) === 1) {
        const error = new Error(
          "Cannot remove the last role of a user for this account-fleet"
        );
        error.errcode = "CANNOT_REMOVE_LAST_ROLE";
        throw error;
      }

      // Remove the role from the user
      query = `
        DELETE FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3 AND roleid = $4
      `;
      let result = await txclient.query(query, [
        accountid,
        fleetid,
        userid,
        roleid,
      ]);

      if (result.rowCount !== 1) {
        const error = new Error("Failed to deassign role from user");
        error.errcode = "ROLE_DEASSIGNMENT_FAILED";
        throw error;
      }

      let historyQuery = `
        INSERT INTO fleet_user_role_history (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      let historyResult = await txclient.query(historyQuery, [
        accountid,
        fleetid,
        userid,
        roleid,
        false,
        'DEASSIGN',
        currtime,
        deassignedby,
      ]);

      if (historyResult.rowCount !== 1) {
        const error = new Error("Failed to add log to fleet_user_role_history");
        throw error;
      }

      // Check if user has any remaining roles in this fleet
      query = `
        SELECT COUNT(*) as count FROM fleet_user_role 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
      let remainingRolesResult = await txclient.query(query, [
        accountid,
        fleetid,
        userid,
      ]);

      // If no roles remaining, remove user from user_fleet table
      if (parseInt(remainingRolesResult.rows[0].count) === 0) {
        query = `
        DELETE FROM user_fleet 
        WHERE accountid = $1 AND fleetid = $2 AND userid = $3
      `;
        result = await txclient.query(query, [accountid, fleetid, userid]);

        if (result.rowCount !== 1) {
          this.logger.warn(
            "No user_fleet record found to delete or failed to delete",
            {
              accountid,
              fleetid,
              userid,
            }
          );
        }
      }
      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        accountid,
        fleetid,
        userid,
        roleid,
        deassignedby,
        deassignedat: new Date(),
      };
    } catch (error) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw error;
    }
  }

  async getAllUserRolesOnFleet(accountid, fleetid, userid) {
    try {
      let query = `
      WITH RECURSIVE parent_fleets AS (
          SELECT ft.accountid, ft.pfleetid, ft.fleetid, ft.name FROM fleet_tree ft
          WHERE ft.accountid = $2 AND ft.fleetid = $3 AND ft.isdeleted = false

          UNION ALL

          SELECT ft.accountid, ft.pfleetid, ft.fleetid, ft.name FROM fleet_tree ft
          JOIN parent_fleets pf ON ft.accountid = pf.accountid AND ft.fleetid = pf.pfleetid
          WHERE ft.isdeleted = false
      ),
      child_fleets AS (
          SELECT ft.accountid, ft.pfleetid, ft.fleetid, ft.name FROM fleet_tree ft
          WHERE ft.accountid = $2 AND ft.fleetid = $3 AND ft.isdeleted = false

          UNION ALL

          SELECT ft.accountid, ft.pfleetid, ft.fleetid, ft.name FROM fleet_tree ft
          JOIN child_fleets cf ON ft.pfleetid = cf.fleetid AND ft.accountid = cf.accountid
          WHERE ft.isdeleted = false
      ),
      all_fleets AS (
          SELECT accountid, pfleetid, fleetid, name FROM parent_fleets
          UNION
          SELECT accountid, pfleetid, fleetid, name FROM child_fleets
      )
      SELECT DISTINCT r.roleid, r.rolename, r.roletype, r.isenabled, af.name as fleetname, af.fleetid
      FROM all_fleets af
      JOIN fleet_user_role fur ON af.accountid = fur.accountid AND af.fleetid = fur.fleetid
      JOIN roles r ON fur.roleid = r.roleid AND r.accountid = fur.accountid AND r.isenabled = $1
      WHERE fur.userid = $4
    `;
      let result = await this.pgPoolI.Query(query, [
        true,
        accountid,
        fleetid,
        userid,
      ]);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to get user roles`);
    }
  }

  async removeUser(accountid, userid, removedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // Validate that the user exists
      let query = `
        SELECT userid, displayname FROM users WHERE userid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      const user = result.rows[0];

      // Validate that the account exists
      query = `
        SELECT accountid FROM account WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account not found or not enabled");
      }

      // Check if user is actually in this account
      query = `
        SELECT userid FROM user_fleet WHERE userid = $1 AND accountid = $2
      `;
      result = await txclient.query(query, [userid, accountid]);
      if (result.rowCount === 0) {
        throw new Error("User is not a member of this account");
      }

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
      
      // Remove user from all fleet_user_role entries for this account
      query = `
        DELETE FROM fleet_user_role 
        WHERE accountid = $1 AND userid = $2
      `;
      result = await txclient.query(query, [accountid, userid]);
      
      // Remove user from all user_fleet entries for this account
      query = `
        DELETE FROM user_fleet 
        WHERE accountid = $1 AND userid = $2
      `;
      result = await txclient.query(query, [accountid, userid]);
      if (result.rowCount === 0) {
        throw new Error("Failed to remove user from account");
      }
      
      // Insert history for each removed assignment
      for (const { fleetid, roleid } of assignments) {
        await txclient.query(
          `
          INSERT INTO fleet_user_role_history
            (accountid, fleetid, userid, roleid, isenabled, action, updatedat, updatedby)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [accountid, fleetid, userid, roleid, false, 'REMOVE', currtime, removedby]
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

      return {
        userid: userid,
        accountid: accountid,
        original_displayname: user.displayname,
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

  // subscription management
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
      throw new Error(`Failed to retrieve default account packages`);
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
      throw new Error(`Failed to retrieve custom packages for account`);
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
      throw new Error(`Failed to retrieve subscription`);
    }
  }

  async getSubscriptionHistoryInfo(accountid, starttime, endtime) {
    try {
      const query = `
        SELECT
          COALESCE(v.license_plate, v.vinno) AS regno,
          ash.vinno AS vinno,
          ash.startsat,
          ash.endsat,
          ash.state,
          ash.isowner,
          ash.updatedat
        FROM account_vehicle_subscription_history ash
        JOIN vehicle v ON v.vinno = ash.vinno
        WHERE ash.accountid = $1
        AND ash.updatedat >= to_timestamp($2 / 1000.0)
        AND ash.updatedat <  to_timestamp($3 / 1000.0)
        ORDER BY ash.updatedat DESC
      `;
      const result = await this.pgPoolI.Query(query, [
        accountid,
        starttime,
        endtime,
      ]);
      return result.rows; // return all rows (history), not null when != 1
    } catch (error) {
      throw new Error(`Failed to retrieve subscription`);
    }
  }

  async updateSubscription(accountid, pkgid, subscriptioninfo, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      // check if pkgid is valid custom package
      let query = `
              SELECT p.pkgid FROM account_custom_package_options acpo
              JOIN package p ON acpo.pkgid = p.pkgid
              WHERE acpo.accountid = $1 AND acpo.pkgid = $2 AND p.isenabled = $3
          `;
      let result = await txclient.query(query, [accountid, pkgid, true]);
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
        throw {
          errcode: "INVALID_PACKAGE_ID",
          message: `Invalid package id: ${pkgid}`,
        };
      }

      query = `
              SELECT pkgid, subscriptioninfo FROM account_package_subscription WHERE accountid = $1
          `;
      result = await txclient.query(query, [accountid]);
      let currentSubscription = result.rowCount > 0 ? result.rows[0] : null;

      // Check if user is already subscribed to the same package
      if (currentSubscription && currentSubscription.pkgid === pkgid) {
        throw {
          errcode: "ACCOUNT_ALREADY_SUBSCRIBED_TO_THIS_PACKAGE",
          message: `Account already subscribed to this package: ${pkgid}`,
        };
      }

      if (currentSubscription) {
        let updatedCurrentSubscriptionInfo = {
          ...currentSubscription.subscriptioninfo,
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
          currentSubscription.pkgid,
        ]);
      }

      query = `
              INSERT INTO account_package_subscription (accountid, pkgid, subscriptioninfo, createdat, createdby) 
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (accountid) 
              DO UPDATE SET 
                  pkgid = EXCLUDED.pkgid,
                  subscriptioninfo = EXCLUDED.subscriptioninfo
              RETURNING pkgid, subscriptioninfo, createdat
          `;
      result = await txclient.query(query, [
        accountid,
        pkgid,
        subscriptioninfo,
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw {
          errcode: "FAILED_TO_UPDATE_SUBSCRIPTION",
          message: `Failed to update subscription: ${pkgid}`,
        };
      }

      query = `
              INSERT INTO account_package_subscription_history (accountid, pkgid, subscriptioninfo, createdat, createdby) VALUES ($1, $2, $3, $4, $5)
          `;
      result = await txclient.query(query, [
        accountid,
        pkgid,
        subscriptioninfo,
        currtime,
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw {
          errcode: "FAILED_TO_CREATE_SUBSCRIPTION_HISTORY",
          message: `Failed to create subscription history: ${pkgid}`,
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
      return {
        accountid: accountid,
        oldpkgid: currentSubscription?.pkgid || null,
        newpkgid: pkgid,
        subscriptioninfo: subscriptioninfo,
        updatedby: updatedby,
        updatedat: currtime,
      };
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
            WHERE apsh.accountid = $1
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve subscription history`);
    }
  }

  async getRootFleetId(accountid) {
    try {
      let query = `
      SELECT fleetid FROM account_fleet 
      WHERE accountid = $1 AND isroot = true
    `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount !== 1) {
        return null;
      }
      return result.rows[0].fleetid;
    } catch (error) {
      throw new Error(`Failed to retrieve root fleet ID`);
    }
  }

  async getPackageWithModules(pkgid) {
    try {
      let query = `
      SELECT p.pkgid, p.pkgname, p.pkgtype, p.pkginfo, p.isenabled, 
             p.createdat, p.createdby, p.updatedat, p.updatedby,
             m.moduleid, m.modulename, m.creditspervehicleday
      FROM package p
      JOIN package_module pm ON p.pkgid = pm.pkgid
      JOIN module m ON pm.moduleid = m.moduleid
      WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
    `;
      let result = await this.pgPoolI.Query(query, [pkgid]);
      if (result.rowCount === 0) {
        return null;
      }

      let packageData = {
        pkgid: result.rows[0].pkgid,
        pkgname: result.rows[0].pkgname,
        pkgtype: result.rows[0].pkgtype,
        pkginfo: result.rows[0].pkginfo,
        isenabled: result.rows[0].isenabled,
        createdat: result.rows[0].createdat,
        createdby: result.rows[0].createdby,
        updatedat: result.rows[0].updatedat,
        updatedby: result.rows[0].updatedby,
        modules: [],
      };

      for (let row of result.rows) {
        packageData.modules.push({
          moduleid: row.moduleid,
          modulename: row.modulename,
          creditspervehicleday: row.creditspervehicleday,
        });
      }

      return packageData;
    } catch (error) {
      throw new Error(`Failed to retrieve package`);
    }
  }

  async getAllVehiclesSourceAccount(vinnos) {
    try {
      let query = `
      SELECT tv.vinno, tv.srcaccountid, a.accountname, tv.dstaccountid
      FROM tagged_vehicle tv
      JOIN account a ON tv.srcaccountid = a.accountid
      WHERE tv.vinno = ANY($1)
    `;
      let result = await this.pgPoolI.Query(query, [vinnos]);
      return result.rows.map((row) => ({
        vinno: row.vinno,
        srcaccountid: row.srcaccountid,
        accountname: row.accountname,
        dstaccountid: row.dstaccountid,
      }));
    } catch (error) {
      throw new Error(`Failed to retrieve all vehicles source account`);
    }
  }

  async getSubscribedVehicles(accountid) {
    try {
      let query = `
      SELECT avs.vinno, avs.startsat, avs.endsat, avs.lockedtill, a.accountid as sourceaccountid, a.accountname as sourceaccountname
      FROM account_vehicle_subscription avs
      JOIN tagged_vehicle tv ON avs.vinno = tv.vinno AND avs.accountid = tv.dstaccountid
      JOIN account a ON tv.srcaccountid = a.accountid
      WHERE avs.accountid = $1 AND avs.state = 1
    `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve subscribed vehicles`);
    }
  }

  async createSubscriptionIntent(accountid, vinnos, userid) {
    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const vinResults = [];

      let query = `
        SELECT vinno FROM fleet_vehicle 
        WHERE accountid = $1 AND vinno IN (${vinList})
      `;
      let result = await this.pgPoolI.Query(query, [accountid]);

      const foundVins = result.rows.map((row) => row.vinno);
      const missingVins = vinnos.filter((vin) => !foundVins.includes(vin));

      for (let vinno of missingVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          statuscode: 3,
          reason: "vehicle_not_found_in_account",
          message: "Vehicle not found in account",
          details: {},
        });
      }

      query = `
        SELECT vinno FROM account_vehicle_subscription 
        WHERE accountid = $1 AND vinno IN (${vinList}) AND state = 1
      `;
      result = await this.pgPoolI.Query(query, [accountid]);

      const alreadySubscribedVins = result.rows.map((row) => row.vinno);

      for (let vinno of alreadySubscribedVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          statuscode: 3,
          reason: "vehicle_already_subscribed",
          message: "Vehicle already subscribed",
          details: {},
        });
      }

      const validVins = vinnos.filter(
        (vin) => foundVins.includes(vin) && !alreadySubscribedVins.includes(vin)
      );

      if (validVins.length === 0) {
        return {
          status: "error",
          statuscode: 3,
          message: "No valid vehicles to subscribe",
          vinresults: vinResults,
          summary: {
            maxsubscribablevehicles: 0,
            totalvehicles: vinnos.length,
            successcount: 0,
            errorcount: vinResults.length,
            connectedvehicles: [],
            disconnectedvehicles: [],
            availablecredits: 0,
            remainingcredits: 0,
            creditsforalreadysubscribed: 0,
            creditsfornewvehicles: 0,
            totalrequiredcredits: 0,
            existingsubscribedcount: 0,
            activesubscribedcount: 0,
            newvehiclecount: 0,
            availabledays: 0,
            lastdate: null,
            creditpervehicleperday: 0,
          },
        };
      }

      const gpsDataMap = await this.getLastestGpsDataForVehicles(validVins);
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

      const connectedVehicles = [];
      const disconnectedVehicles = [];

      for (let vinno of validVins) {
        const lastConnectedAt = gpsDataMap[vinno]
          ? parseInt(gpsDataMap[vinno])
          : null;
        const isConnected =
          lastConnectedAt && lastConnectedAt > twentyFourHoursAgo;

        if (isConnected) {
          connectedVehicles.push(vinno);
        } else {
          disconnectedVehicles.push(vinno);
        }
      }

      for (let vinno of disconnectedVehicles) {
        const lastConnectedAt = gpsDataMap[vinno]
          ? parseInt(gpsDataMap[vinno])
          : null;
        vinResults.push({
          vinno: vinno,
          status: "error",
          statuscode: 3,
          reason: "vehicle_not_connected",
          message: "Vehicle not connected in last 24 hours",
          details: {
            lastconnectedat: lastConnectedAt,
            isconnected: false,
          },
        });
      }

      query = `
        SELECT pkgid, subscriptioninfo FROM account_package_subscription 
        WHERE accountid = $1
      `;
      result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account subscription not found");
      }
      const subscriptionInfo = result.rows[0];

      query = `
        SELECT sum(m.creditspervehicleday) as pkgcost FROM package p
        JOIN package_module pm ON p.pkgid = pm.pkgid
        JOIN module m ON pm.moduleid = m.moduleid
        WHERE p.pkgid = $1 AND m.isenabled = true AND p.isenabled = true
      `;
      result = await this.pgPoolI.Query(query, [subscriptionInfo.pkgid]);
      if (result.rowCount !== 1) {
        throw new Error("Package not found");
      }
      const creditPerVehiclePerDay =
        Math.round(Number(result.rows[0].pkgcost) * 100) / 100;

      const today = new Date();
      const endOfNextMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 2,
        0
      );
      const availableDays = Math.ceil(
        (endOfNextMonth - today) / (1000 * 60 * 60 * 24)
      );

      const validVinList = validVins.map((vin) => `'${vin}'`).join(",");
      query = `
        SELECT vinno, lockedtill FROM account_vehicle_subscription 
        WHERE accountid = $1 AND state = 1 AND vinno NOT IN (${validVinList})
      `;
      result = await this.pgPoolI.Query(query, [accountid]);
      const existingSubscribedVins = result.rows;
      const existingSubscribedCount = existingSubscribedVins.length;

      let creditsForAlreadySubscribed = 0;
      const activeSubscribedVins = [];

      for (let row of existingSubscribedVins) {
        const lockedtill = row.lockedtill ? new Date(row.lockedtill) : null;

        if (lockedtill && lockedtill > today) {
          const daysUntilLocked = Math.ceil(
            (lockedtill - today) / (1000 * 60 * 60 * 24)
          );
          creditsForAlreadySubscribed +=
            daysUntilLocked * creditPerVehiclePerDay;
          activeSubscribedVins.push(row.vinno);
        }
      }
      creditsForAlreadySubscribed =
        Math.round(creditsForAlreadySubscribed * 100) / 100;

      query = `
        SELECT credits FROM account_credits WHERE accountid = $1
      `;
      result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account credits not found");
      }
      const availableCredits =
        Math.round(Number(result.rows[0].credits) * 100) / 100;

      // Modified credit validation for existing subscriptions
      const projectedCreditsAfterExisting =
        availableCredits - creditsForAlreadySubscribed;
      if (projectedCreditsAfterExisting < NEGATIVE_CREDIT_THRESHOLD) {
        for (let vinno of validVins) {
          vinResults.push({
            vinno: vinno,
            status: "error",
            statuscode: 2,
            reason: "insufficient_credits_for_existing",
            message:
              "Insufficient credits for existing subscriptions (exceeds negative credit limit)",
            details: {
              availablecredits: availableCredits,
              requiredcredits: creditsForAlreadySubscribed,
              projectedcredits: projectedCreditsAfterExisting,
              negativecreditthreshold: NEGATIVE_CREDIT_THRESHOLD,
              existingsubscribedcount: existingSubscribedCount,
              activesubscribedcount: activeSubscribedVins.length,
              availabledays: availableDays,
              creditpervehicleperday: creditPerVehiclePerDay,
            },
          });
        }

        return {
          status: "error",
          statuscode: 2,
          message:
            "Insufficient credits for existing subscriptions (exceeds negative credit limit)",
          vinresults: vinResults,
          summary: {
            maxsubscribablevehicles: 0,
            totalvehicles: vinnos.length,
            successcount: 0,
            errorcount: vinResults.length,
            connectedvehicles: connectedVehicles,
            disconnectedvehicles: disconnectedVehicles,
            availablecredits: availableCredits,
            remainingcredits: 0,
            creditsforalreadysubscribed: creditsForAlreadySubscribed,
            creditsfornewvehicles: 0,
            totalrequiredcredits: creditsForAlreadySubscribed,
            existingsubscribedcount: existingSubscribedCount,
            activesubscribedcount: activeSubscribedVins.length,
            newvehiclecount: connectedVehicles.length,
            availabledays: availableDays,
            lastdate: endOfNextMonth,
            creditpervehicleperday: creditPerVehiclePerDay,
          },
        };
      }

      const remainingCredits =
        Math.round((availableCredits - creditsForAlreadySubscribed) * 100) /
        100;

      const newVehicleCount = connectedVehicles.length;
      const creditsForNewVehicles =
        Math.round(
          availableDays * newVehicleCount * creditPerVehiclePerDay * 100
        ) / 100;

      // Modified credit validation for new vehicles
      const finalProjectedCredits = remainingCredits - creditsForNewVehicles;
      if (finalProjectedCredits < NEGATIVE_CREDIT_THRESHOLD) {
        let maxSubscribableVehicles = Math.floor(
          remainingCredits / (availableDays * creditPerVehiclePerDay)
        );
        for (let vinno of connectedVehicles) {
          vinResults.push({
            vinno: vinno,
            status: "error",
            statuscode: 2,
            reason: "insufficient_credits_for_new_vehicles",
            message:
              "Insufficient credits for new vehicle subscriptions (exceeds negative credit limit)",
            details: {
              availablecredits: availableCredits,
              remainingcredits: remainingCredits,
              requiredcredits: creditsForNewVehicles,
              projectedcredits: finalProjectedCredits,
              negativecreditthreshold: NEGATIVE_CREDIT_THRESHOLD,
              newvehiclecount: newVehicleCount,
              availabledays: availableDays,
              creditpervehicleperday: creditPerVehiclePerDay,
            },
          });
        }

        return {
          status: "error",
          statuscode: 2,
          message:
            "Insufficient credits for new vehicle subscriptions (exceeds negative credit limit)",
          vinresults: vinResults,
          summary: {
            totalvehicles: vinnos.length,
            maxsubscribablevehicles: maxSubscribableVehicles,
            successcount: 0,
            errorcount: vinResults.length,
            connectedvehicles: connectedVehicles,
            disconnectedvehicles: disconnectedVehicles,
            availablecredits: availableCredits,
            remainingcredits: remainingCredits,
            creditsforalreadysubscribed: creditsForAlreadySubscribed,
            creditsfornewvehicles: creditsForNewVehicles,
            totalrequiredcredits:
              Math.round(
                (creditsForAlreadySubscribed + creditsForNewVehicles) * 100
              ) / 100,
            existingsubscribedcount: existingSubscribedCount,
            activesubscribedcount: activeSubscribedVins.length,
            newvehiclecount: newVehicleCount,
            availabledays: availableDays,
            lastdate: endOfNextMonth,
            creditpervehicleperday: creditPerVehiclePerDay,
          },
        };
      }

      for (let vinno of connectedVehicles) {
        const lastConnectedAt = gpsDataMap[vinno]
          ? parseInt(gpsDataMap[vinno])
          : null;
        vinResults.push({
          vinno: vinno,
          status: "success",
          statuscode: 1,
          reason: "can_subscribe",
          message: "Vehicle can be subscribed",
          details: {
            isconnected: true,
            lastconnectedat: lastConnectedAt,
            availablecredits: availableCredits,
            remainingcredits: remainingCredits,
            creditpervehicleperday: creditPerVehiclePerDay,
            availabledays: availableDays,
          },
        });
      }

      return {
        status: "success",
        statuscode: 1,
        message: "Subscription intent created successfully",
        vinresults: vinResults,
        summary: {
          totalvehicles: vinnos.length,
          maxsubscribablevehicles: newVehicleCount,
          successcount: connectedVehicles.length,
          errorcount: vinResults.filter((r) => r.status === "error").length,
          connectedvehicles: connectedVehicles,
          disconnectedvehicles: disconnectedVehicles,
          availablecredits: availableCredits,
          remainingcredits: remainingCredits,
          creditsforalreadysubscribed: creditsForAlreadySubscribed,
          creditsfornewvehicles: creditsForNewVehicles,
          totalrequiredcredits:
            Math.round(
              (creditsForAlreadySubscribed + creditsForNewVehicles) * 100
            ) / 100,
          existingsubscribedcount: existingSubscribedCount,
          activesubscribedcount: activeSubscribedVins.length,
          newvehiclecount: newVehicleCount,
          availabledays: availableDays,
          lastdate: endOfNextMonth,
          creditpervehicleperday: creditPerVehiclePerDay,
        },
      };
    } catch (error) {
      this.logger.error("Error in createSubscriptionIntent:", error);
      throw error;
    }
  }

  async subscribeVehicle(accountid, vinnos, userid, intentResult) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      return {
        status: "error",
        message: "Failed to start database transaction",
        details: {
          error: err.message,
        },
      };
    }

    try {
      let query = `
        SELECT pkgid, subscriptioninfo FROM account_package_subscription 
        WHERE accountid = $1
      `;
      let result = await txclient.query(query, [accountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Account subscription not found",
          details: {
            accountid,
          },
        };
      }
      const subscriptionInfo = result.rows[0];

      const today = new Date();
      const endOfNextMonth = new Date(
        today.getFullYear(),
        today.getMonth() + 2,
        0
      );
      const endOf5years = new Date(
        today.getFullYear() + 5,
        today.getMonth(),
        today.getDate()
      );

      const oneminutesfromnow = new Date(today.getTime() + 1 * 60 * 1000);

      if (vinnos.length > 0) {
        let values = [];
        const placeholders = vinnos
          .map((vinno, index) => {
            const startindex = index * 11 + 1;
            let startsat = currtime;
            let endsat = endOf5years;
            let lockedtill = endOfNextMonth;
            // below is for testing
            // let lockedtill = oneminutesfromnow;
            values.push(
              accountid,
              vinno,
              startsat,
              endsat,
              lockedtill,
              {},
              1,
              currtime,
              userid,
              currtime,
              userid
            );
            return `($${startindex}, $${startindex + 1}, $${startindex + 2}, $${
              startindex + 3
            }, $${startindex + 4}, $${startindex + 5}, $${startindex + 6}, $${
              startindex + 7
            }, $${startindex + 8}, $${startindex + 9}, $${startindex + 10})`;
          })
          .join(",");

        query = `
          INSERT INTO account_vehicle_subscription 
          (accountid, vinno, startsat, endsat, lockedtill, subscriptioninfo, state, createdat, createdby, updatedat, updatedby) 
          VALUES ${placeholders}
        `;
        result = await txclient.query(query, values);
        if (result.rowCount !== vinnos.length) {
          await this.pgPoolI.TxRollback(txclient);
          return {
            status: "error",
            message: "Failed to create vehicle subscriptions",
            details: {
              expected: vinnos.length,
              actual: result.rowCount,
              vinnos,
            },
          };
        }

        const isOwnerList = await Promise.all(
          vinnos.map(async (vinno) => {
            const r = await txclient.query(
              `SELECT isowner FROM fleet_vehicle WHERE accountid=$1 AND vinno=$2 LIMIT 1`,
              [accountid, vinno]
            );
            return r.rows[0]?.isowner ?? false; // ensure a boolean
          })
        );

        let historyValues = [];
        const historyPlaceholders = vinnos
          .map((vinno, index) => {
            const startindex = index * 11 + 1;
            let startsat = currtime;
            let endsat = null;
            let isowner = isOwnerList[index];
            historyValues.push(
              accountid,
              vinno,
              isowner,
              startsat,
              endsat,
              {},
              1,
              currtime,
              userid,
              currtime,
              userid
            );
            return `($${startindex}, $${startindex + 1}, $${startindex + 2}, $${
              startindex + 3
            }, $${startindex + 4}, $${startindex + 5}, $${startindex + 6}, $${
              startindex + 7
            }, $${startindex + 8}, $${startindex + 9}, $${startindex + 10})`;
          })
          .join(",");

        query = `
          INSERT INTO account_vehicle_subscription_history 
          (accountid, vinno, isowner, startsat, endsat, subscriptioninfo, state, createdat, createdby, updatedat, updatedby) 
          VALUES ${historyPlaceholders}
        `;
        result = await txclient.query(query, historyValues);
        if (result.rowCount !== vinnos.length) {
          await this.pgPoolI.TxRollback(txclient);
          return {
            status: "error",
            message: "Failed to create vehicle subscription history records",
            details: {
              expected: vinnos.length,
              actual: result.rowCount,
              vinnos,
            },
          };
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
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Failed to commit transaction",
          details: {
            error: commiterr.message,
          },
        };
      }

      return {
        status: "success",
        message: "Vehicles subscribed successfully",
        subscribedvehicles: vinnos,
        subscriptioninfo: {
          startsat: currtime,
          endsat: endOfNextMonth,
          totalvehicles: vinnos.length,
          pkgid: subscriptionInfo.pkgid,
        },
        summary: {
          ...intentResult.summary,
          subscribedcount: vinnos.length,
          skippedcount: intentResult.vinresults.filter(
            (r) => r.status === "error"
          ).length,
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      return {
        status: "error",
        message: "Failed to subscribe vehicles",
        details: {
          error: e.message,
          rollbackerror: rollbackerr ? rollbackerr.message : null,
        },
      };
    }
  }

  async unsubscribeVehicle(accountid, vinnos, userid) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      return {
        status: "error",
        message: "Failed to start database transaction",
        details: {
          error: err.message,
        },
      };
    }

    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const vinResults = [];

      let query = `
        SELECT vinno, state, lockedtill, startsat, endsat, subscriptioninfo FROM account_vehicle_subscription 
        WHERE accountid = $1 AND vinno IN (${vinList})
      `;
      let result = await txclient.query(query, [accountid]);

      const subscribedVins = result.rows.filter((row) => row.state === 1);
      const notSubscribedVins = vinnos.filter(
        (vin) => !subscribedVins.some((row) => row.vinno === vin)
      );

      // Mark vehicles that are not subscribed as errors
      for (let vinno of notSubscribedVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          reason: "vehicle_not_subscribed",
          message: "Vehicle is currently not subscribed",
          details: {
            currentstate: "not_subscribed",
            action: "no_action_taken",
          },
        });
      }

      const today = new Date();

      const unsubscribableVins = [];
      const lockedVins = [];

      for (let row of subscribedVins) {
        const lockedtill = row.lockedtill ? new Date(row.lockedtill) : null;

        if (!lockedtill || today >= lockedtill) {
          unsubscribableVins.push({
            vinno: row.vinno,
            startsat: row.startsat,
            endsat: row.endsat,
            subscriptioninfo: row.subscriptioninfo,
          });
        } else {
          lockedVins.push({
            vinno: row.vinno,
            lockedtill: row.lockedtill,
          });
        }
      }

      for (let lockedVehicle of lockedVins) {
        vinResults.push({
          vinno: lockedVehicle.vinno,
          status: "error",
          reason: "vehicle_still_locked",
          message:
            "Cannot Unsubscribe. Vehicle Subscription is locked till " +
            lockedVehicle.lockedtill,
          details: {
            lockedtill: lockedVehicle.lockedtill,
            currentdate: today.toISOString(),
            action: "no_action_taken",
          },
        });
      }

      if (unsubscribableVins.length === 0) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "No vehicles can be unsubscribed",
          vinresults: vinResults,
          summary: {
            totalvehicles: vinnos.length,
            successcount: 0,
            errorcount: vinResults.length,
            unsubscribedvehicles: [],
            notsubscribedvehicles: notSubscribedVins,
            lockedvehicles: lockedVins.map((v) => v.vinno),
            currentdate: today.toISOString(),
          },
        };
      }

      const unsubscribableVinList = unsubscribableVins
        .map((vin) => `'${vin.vinno}'`)
        .join(",");
      query = `
        UPDATE account_vehicle_subscription_history 
        SET endsat = $1, updatedat = $2, updatedby = $3
        WHERE accountid = $4 AND vinno IN (${unsubscribableVinList}) AND endsat IS NULL
      `;
      result = await txclient.query(query, [
        currtime,
        currtime,
        userid,
        accountid,
      ]);

      if (result.rowCount !== unsubscribableVins.length) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Failed to update history records for some vehicles",
          details: {
            expected: unsubscribableVins.length,
            actual: result.rowCount,
            vinnos: unsubscribableVins.map((v) => v.vinno),
          },
        };
      }

      query = `
        DELETE FROM account_vehicle_subscription 
        WHERE accountid = $1 AND vinno IN (${unsubscribableVinList})
      `;
      result = await txclient.query(query, [accountid]);

      if (result.rowCount !== unsubscribableVins.length) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Failed to remove some vehicles from subscription table",
          details: {
            expected: unsubscribableVins.length,
            actual: result.rowCount,
            vinnos: unsubscribableVins.map((v) => v.vinno),
          },
        };
      }

      for (let vehicle of unsubscribableVins) {
        vinResults.push({
          vinno: vehicle.vinno,
          status: "success",
          reason: "vehicle_unsubscribed",
          message: "Vehicle unsubscribed successfully",
          details: {
            unsubscribedat: currtime,
            action: "removed_from_subscription",
            subscriptionstart: vehicle.startsat,
            subscriptionend: currtime,
            subscriptionduration:
              Math.ceil(
                (currtime - new Date(vehicle.startsat)) / (1000 * 60 * 60 * 24)
              ) + " days",
          },
        });
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
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Failed to commit transaction",
          details: {
            error: commiterr.message,
          },
        };
      }

      return {
        status: "success",
        message: "Vehicles unsubscribed successfully",
        vinresults: vinResults,
        summary: {
          totalvehicles: vinnos.length,
          successcount: unsubscribableVins.length,
          errorcount: vinResults.filter((r) => r.status === "error").length,
          unsubscribedvehicles: unsubscribableVins.map((v) => v.vinno),
          notsubscribedvehicles: notSubscribedVins,
          lockedvehicles: lockedVins.map((v) => v.vinno),
          currentdate: today.toISOString(),
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      return {
        status: "error",
        message: "Failed to unsubscribe vehicles",
        details: {
          error: e.message,
          rollbackerror: rollbackerr ? rollbackerr.message : null,
        },
      };
    }
  }

  async getLastestGpsDataForVehicles(vinnos) {
    if (!vinnos || vinnos.length === 0) {
      return {};
    }

    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const query = `
        SELECT vin, utctime
        FROM lmmdata_latest.gpsdatalatest
        WHERE vin IN (${vinList})
      `;

      const result = await this.clickHouseClient.query(query);

      if (!result.success) {
        this.logger.error(
          "Failed to query ClickHouse for GPS data:",
          result.error
        );
        return {};
      }

      const gpsDataMap = {};
      for (let row of result.data) {
        gpsDataMap[row.vin] = row.utctime;
      }

      return gpsDataMap;
    } catch (error) {
      this.logger.error("Error fetching latest GPS data:", error);
      return {};
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
        throw new Error("NEW_PACKAGE_NOT_FOUND");
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

  async getUserAccountFleets(accountid, userid) {
    try {
      const allFleetsQuery = `
        SELECT * FROM get_all_fleets_path_from_root($1, $2)
      `;
      const allFleets = await this.pgPoolI.Query(allFleetsQuery, [
        accountid,
        userid,
      ]);
      if (allFleets.rowCount === 0) return null;

      const accessibleFleetsQuery = `
        SELECT DISTINCT fleetid 
        FROM fleet_user_role 
        WHERE accountid = $1 AND userid = $2
      `;
      const accessibleFleets = await this.pgPoolI.Query(accessibleFleetsQuery, [
        accountid,
        userid,
      ]);
      if (accessibleFleets.rowCount === 0) return null;

      const accessibleFleetIds = accessibleFleets.rows.map(
        (row) => row.fleetid
      );

      const childFleetsQuery = `
        WITH RECURSIVE fleet_children AS (
          SELECT ft.fleetid
          FROM fleet_tree ft
          WHERE ft.accountid = $1
            AND ft.fleetid = ANY($2)
            AND ft.isdeleted = false

          UNION ALL

          SELECT ft.fleetid
          FROM fleet_tree ft
          JOIN fleet_children fc ON ft.pfleetid = fc.fleetid
          WHERE ft.accountid = $1 AND ft.isdeleted = false

        )
        SELECT DISTINCT fleetid FROM fleet_children;
      `;

      const allAllowedFleets = await this.pgPoolI.Query(childFleetsQuery, [
        accountid,
        accessibleFleetIds,
      ]);

      const allowedFleetIds = new Set(
        allAllowedFleets.rows.map((row) => row.fleetid)
      );

      const filteredFleets = allFleets.rows.filter((fleet) =>
        allowedFleetIds.has(fleet.fleetid)
      );

      const fleetMap = new Map();

      filteredFleets.forEach((fleet) => {
        const fleetId = fleet.fleetid;
        const pathSlashCount = (fleet.path.match(/\//g) || []).length;

        if (!fleetMap.has(fleetId)) {
          fleetMap.set(fleetId, fleet);
        } else {
          const existingFleet = fleetMap.get(fleetId);
          const existingPathSlashCount = (existingFleet.path.match(/\//g) || [])
            .length;

          if (pathSlashCount === 1 && existingPathSlashCount !== 1) {
            fleetMap.set(fleetId, fleet);
          }
        }
      });

      const uniqueFleets = Array.from(fleetMap.values());

      return uniqueFleets;
    } catch (error) {
      console.error("Error in getUserAccountFleets:", error);
      throw new Error(`Failed to retrieve user account fleets`);
    }
  }

  async getAllAccountModules(accountid) {
    try {
      let query = `
            select pm.moduleid, m.modulename, m.moduletype, m.modulecode, m.moduleinfo, m.isenabled, m.priority, m.createdat, m.createdby, m.updatedat, m.updatedby from account_package_subscription aps, package_module pm, module m where aps.pkgid=pm.pkgid and pm.moduleid=m.moduleid and m.moduletype = 'web' and m.isenabled = true and aps.accountid=$1 ORDER BY m.priority asc;
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve web modules`);
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
      await this.logRoleHistory(role, deletedby, new Date(), 'DELETE', previousState, txclient);
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

  async logRolePermHistory(accountid, roleid, permid, updatedby, updatedat, action, isenabled, txclient = null) {
    try {
      let query = `
        INSERT INTO role_perm_history (accountid, roleid, permid, updatedat, updatedby, isenabled, action) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `;
      let result = await txclient.query(query, [accountid, roleid, permid, updatedat, updatedby, isenabled, action]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to log role perm history");
      }
      return true;
    }
    catch (error) {
      this.logger.error("role perm history insert failed", { accountid, roleid, permid, err: error });
      await this.pgPoolI.TxRollback(txclient);
      throw new Error(`Failed to log role perm history: ${error.message}`);
    }
  }
  
  async doesFleetHaveVehicles(accountid, fleetid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM fleet_vehicle WHERE accountid = $1 AND fleetid = $2
      `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check fleet vehicles");
    }
  }

  async doesFleetHaveSubfleets(accountid, fleetid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM fleet_tree WHERE accountid = $1 AND pfleetid = $2 AND isdeleted = false
      `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check fleet subfleets");
    }
  }

  async doesFleetHaveUsers(accountid, fleetid) {
    try {
      let query = `
        SELECT COUNT(*) as count FROM user_fleet WHERE accountid = $1 AND fleetid = $2
      `;
      let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      throw new Error("Failed to check fleet users");
    }
  }

  async doesFleetHaveConstraints(accountid, fleetid) {
    try {
      let queries = [
        `SELECT COUNT(*) as count FROM geofencesch.geofence WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofencerule WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofencerulevehicle WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofencerulefleet WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofenceruleuser WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofenceruleinfo WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofencevehruletrip WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM geofencesch.geofencevehrulealert WHERE accountid = $1 AND fleetid = $2`,

        // TODO: need to check if these tables exist if yes then what is the schema
        // `SELECT COUNT(*) as count FROM route WHERE accountid = $1 AND fleetid = $2`,
        // `SELECT COUNT(*) as count FROM trip WHERE accountid = $1 AND fleetid = $2`,
        // `SELECT COUNT(*) as count FROM user_dashboard WHERE accountid = $1`,

        `SELECT COUNT(*) as count FROM fleet_invite_pending WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM fleet_invite_done WHERE accountid = $1 AND fleetid = $2`,
        `SELECT COUNT(*) as count FROM fleet_vehicle_history WHERE accountid = $1 AND fleetid = $2`,
      ];

      for (let query of queries) {
        let result = await this.pgPoolI.Query(query, [accountid, fleetid]);
        if (parseInt(result.rows[0].count) > 0) {
          return true;
        }
      }

      return false;
    } catch (error) {
      throw new Error("Failed to check fleet constraints");
    }
  }

  async deleteFleet(accountid, fleetid, deletedby, hasConstraints) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let query = `
        SELECT ft.fleetid, ft.name as fleetname, af.isroot 
        FROM fleet_tree ft
        JOIN account_fleet af ON ft.accountid = af.accountid AND ft.fleetid = af.fleetid
        WHERE ft.accountid = $1 AND ft.fleetid = $2
      `;
      let result = await txclient.query(query, [accountid, fleetid]);
      if (result.rowCount === 0) {
        throw new Error("Fleet not found");
      }

      const fleet = result.rows[0];

      if (hasConstraints) {
        const timestamp = Date.now();
        const deletedFleetName = `Deleted_Fleet_${timestamp}`;

        query = `
          UPDATE fleet_tree 
          SET isdeleted = true, name = $1, updatedat = $2, updatedby = $3
          WHERE accountid = $4 AND fleetid = $5
        `;
        result = await txclient.query(query, [
          deletedFleetName,
          new Date(),
          deletedby,
          accountid,
          fleetid,
        ]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to soft delete fleet");
        }
      } else {
        // Hard delete - remove from all tables
        query = `
          DELETE FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
        `;
        result = await txclient.query(query, [accountid, fleetid]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to delete fleet from fleet_tree");
        }

        query = `
          DELETE FROM account_fleet WHERE accountid = $1 AND fleetid = $2
        `;
        result = await txclient.query(query, [accountid, fleetid]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to delete fleet from account_fleet");
        }
      }

      await this.pgPoolI.TxCommit(txclient);
      return {
        fleetid: fleetid,
        fleetname: fleet.fleetname,
        deletedat: new Date(),
        deletedby: deletedby,
        deletetype: hasConstraints ? "soft" : "hard",
      };
    } catch (e) {
      await this.pgPoolI.TxRollback(txclient);
      throw e;
    }
  }

  async isUserInAccount(accountid, userid) {
    try {
      let query = `
        SELECT userid FROM user_fleet WHERE accountid = $1 AND userid = $2
      `;
      let result = await this.pgPoolI.Query(query, [accountid, userid]);
      return result.rowCount > 0;
    } catch (error) {
      throw new Error("Failed to check user account membership");
    }
  }

  async deleteUser(accountid, userid, deletedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        SELECT userid, displayname FROM users WHERE userid = $1 AND isdeleted = false
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User not found");
      }

      const user = result.rows[0];

      const randomNum = Math.floor(Math.random() * 1000000);
      const newDisplayName = `${user.displayname}_deleted_${randomNum}`;

      query = `
        UPDATE users 
        SET isdeleted = true, 
            displayname = $1, 
            updatedat = $2, 
            updatedby = $3 
        WHERE userid = $4
      `;
      result = await txclient.query(query, [
        newDisplayName,
        currtime,
        deletedby,
        userid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to update user record");
      }

      query = `
        SELECT ssotype, ssoid FROM user_sso WHERE userid = $1
      `;
      result = await txclient.query(query, [userid]);

      const ssoRecords = result.rows;
      let ssoRecordsUpdated = 0;

      for (const ssoRecord of ssoRecords) {
        const newSsoId = `${ssoRecord.ssoid}_deleted_${randomNum}`;

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

        if (ssoRecord.ssotype === "EMAIL_PWD") {
          query = `
            UPDATE email_pwd_sso 
            SET ssoid = $1, updatedat = $2 
            WHERE userid = $3
          `;
          await txclient.query(query, [newSsoId, currtime, userid]);
        } else if (ssoRecord.ssotype === "MOBILE") {
          query = `
            UPDATE mobile_sso 
            SET ssoid = $1, updatedat = $2 
            WHERE userid = $3
          `;
          await txclient.query(query, [newSsoId, currtime, userid]);
        }

        ssoRecordsUpdated++;
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return {
        userid: userid,
        original_displayname: user.displayname,
        new_displayname: newDisplayName,
        deletedat: currtime,
        deletedby: deletedby,
        sso_records_updated: ssoRecordsUpdated,
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  async tagVehicle(srcaccountid, dstaccountid, vinnos, allow_retag, taggedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      return {
        status: "error",
        message: "Failed to start database transaction",
        details: {
          error: err.message,
        },
      };
    }

    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const vinResults = [];

      // Check if source account exists
      let query = `
        SELECT accountid, accountname FROM account 
        WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      let result = await txclient.query(query, [srcaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Source account not found or not enabled",
          details: { srcaccountid },
        };
      }
      const srcAccountName = result.rows[0].accountname;

      // Check if destination account exists
      query = `
        SELECT accountid, accountname FROM account 
        WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      result = await txclient.query(query, [dstaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Destination account not found or not enabled",
          details: { dstaccountid },
        };
      }
      const dstAccountName = result.rows[0].accountname;

      // Get destination account's root fleet ID
      query = `
        SELECT fleetid FROM account_fleet 
        WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [dstaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Destination account root fleet not found",
          details: { dstaccountid },
        };
      }
      const dstRootFleetId = result.rows[0].fleetid;

      // Check if all vehicles exist and belong to source account
      query = `
        SELECT fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.accvininfo, vm.modelvariant as vehiclevariant, vm.modelname as vehiclemodel, v.vehicleinfo
        FROM fleet_vehicle fv
        JOIN vehicle v ON fv.vinno = v.vinno
        JOIN vehicle_model vm ON v.modelcode = vm.modelcode
        WHERE fv.accountid = $1 AND fv.vinno IN (${vinList})
      `;
      result = await txclient.query(query, [srcaccountid]);

      const foundVins = result.rows.map((row) => row.vinno);
      const vehicleDataMap = {};
      result.rows.forEach((row) => {
        vehicleDataMap[row.vinno] = {
          regno: row.regno,
          accvininfo: row.accvininfo,
          vehiclevariant: row.vehiclevariant,
          vehiclemodel: row.vehiclemodel,
          vehicleinfo: row.vehicleinfo,
        };
      });

      const missingVins = vinnos.filter((vin) => !foundVins.includes(vin));

      for (let vinno of missingVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          reason: "vehicle_not_found_in_source_account",
          message: "Vehicle not found in source account",
          details: { srcaccountid, dstaccountid },
        });
      }

      // Check for existing tags
      if (foundVins.length > 0) {
        const foundVinList = foundVins.map((vin) => `'${vin}'`).join(",");

        // Check existing tagged_vehicle records
        query = `
          SELECT vinno, isactive FROM tagged_vehicle 
          WHERE srcaccountid = $1 AND dstaccountid = $2 AND vinno IN (${foundVinList})
        `;
        result = await txclient.query(query, [srcaccountid, dstaccountid]);

        const existingTags = {};
        result.rows.forEach((row) => {
          existingTags[row.vinno] = row.isactive;
        });

        // Check if vehicles already exist in destination fleet_vehicle
        query = `
          SELECT vinno FROM fleet_vehicle 
          WHERE accountid = $1 AND vinno IN (${foundVinList})
        `;
        result = await txclient.query(query, [dstaccountid]);

        const vehiclesInDstFleet = result.rows.map((row) => row.vinno);

        const validVins = [];

        for (let vinno of foundVins) {
          // Check if vehicle is already in destination fleet
          if (vehiclesInDstFleet.includes(vinno)) {
            vinResults.push({
              vinno: vinno,
              status: "error",
              reason: "vehicle_already_in_destination_fleet",
              message: "Vehicle already exists in destination account fleet",
              details: {
                srcaccountid,
                dstaccountid,
                currentstatus: "in_destination_fleet",
              },
            });
            continue;
          }

          if (existingTags[vinno] !== undefined) {
            if (existingTags[vinno]) {
              // Already actively tagged
              vinResults.push({
                vinno: vinno,
                status: "error",
                reason: "vehicle_already_tagged",
                message: "Vehicle is already tagged to destination account",
                details: {
                  srcaccountid,
                  dstaccountid,
                  currentstatus: "active",
                },
              });
            } else if (allow_retag) {
              // Inactive tag, but retag is allowed
              validVins.push(vinno);
            } else {
              // Inactive tag, retag not allowed
              vinResults.push({
                vinno: vinno,
                status: "error",
                reason: "vehicle_previously_tagged_retag_not_allowed",
                message:
                  "Vehicle was previously tagged and retag is not allowed",
                details: {
                  srcaccountid,
                  dstaccountid,
                  currentstatus: "inactive",
                  allow_retag: false,
                },
              });
            }
          } else {
            // No existing tag
            validVins.push(vinno);
          }
        }

        if (validVins.length === 0) {
          await this.pgPoolI.TxRollback(txclient);
          return {
            status: "error",
            message: "No vehicles can be tagged",
            vinresults: vinResults,
            summary: {
              totalvehicles: vinnos.length,
              successcount: 0,
              errorcount: vinResults.length,
              srcaccountid,
              srcaccountname: srcAccountName,
              dstaccountid,
              dstaccountname: dstAccountName,
            },
          };
        }

        // Handle retagging (update existing inactive tags to active)
        const retagVins = validVins.filter(
          (vinno) => existingTags[vinno] !== undefined && !existingTags[vinno]
        );

        if (retagVins.length > 0) {
          const retagVinList = retagVins.map((vin) => `'${vin}'`).join(",");

          // Update existing tags to active
          query = `
            UPDATE tagged_vehicle 
            SET isactive = true, allow_retag = $1, taggedat = $2, taggedby = $3
            WHERE srcaccountid = $4 AND dstaccountid = $5 AND vinno IN (${retagVinList})
          `;
          result = await txclient.query(query, [
            allow_retag,
            currtime,
            taggedby,
            srcaccountid,
            dstaccountid,
          ]);

          // Insert history records for retagged vehicles
          let historyValues = [];
          const historyPlaceholders = retagVins
            .map((vinno, index) => {
              const startindex = index * 7 + 1;
              historyValues.push(
                srcaccountid,
                vinno,
                dstaccountid,
                true,
                allow_retag,
                currtime,
                taggedby
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              })`;
            })
            .join(",");

          query = `
            INSERT INTO tagged_vehicle_history 
            (srcaccountid, vinno, dstaccountid, isactive, allow_retag, taggedat, taggedby) 
            VALUES ${historyPlaceholders}
          `;
          await txclient.query(query, historyValues);

          // Add vehicles back to destination fleet_vehicle
          let fleetVehicleValues = [];
          const fleetVehiclePlaceholders = retagVins
            .map((vinno, index) => {
              const startindex = index * 9 + 1;
              const vehicleData = vehicleDataMap[vinno];
              fleetVehicleValues.push(
                dstaccountid,
                dstRootFleetId,
                vinno,
                false,
                vehicleData.accvininfo,
                currtime,
                taggedby,
                currtime,
                taggedby
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              }, $${startindex + 7}, $${startindex + 8})`;
            })
            .join(",");

          query = `
            INSERT INTO fleet_vehicle 
            (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby) 
            VALUES ${fleetVehiclePlaceholders}
          `;
          await txclient.query(query, fleetVehicleValues);

          // Add fleet_vehicle_history records for retagged vehicles
          let fleetHistoryValues = [];
          const fleetHistoryPlaceholders = retagVins
            .map((vinno, index) => {
              const startindex = index * 10 + 1;
              fleetHistoryValues.push(
                dstaccountid,
                dstRootFleetId,
                vinno,
                true,
                allow_retag,
                currtime,
                taggedby,
                currtime,
                taggedby,
                VEHICLE_ACTION.TAGGED
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              }, $${startindex + 7}, $${startindex + 8}, $${startindex + 9})`;
            })
            .join(",");

          query = `
            INSERT INTO fleet_vehicle_history 
            (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby, action) 
            VALUES ${fleetHistoryPlaceholders}
          `;
          await txclient.query(query, fleetHistoryValues);
        }

        // Handle new tags
        const newTagVins = validVins.filter(
          (vinno) => existingTags[vinno] === undefined
        );

        if (newTagVins.length > 0) {
          // Insert new tagged_vehicle records
          let tagValues = [];
          const tagPlaceholders = newTagVins
            .map((vinno, index) => {
              const startindex = index * 7 + 1;
              tagValues.push(
                srcaccountid,
                vinno,
                dstaccountid,
                true,
                allow_retag,
                currtime,
                taggedby
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              })`;
            })
            .join(",");

          query = `
            INSERT INTO tagged_vehicle 
            (srcaccountid, vinno, dstaccountid, isactive, allow_retag, taggedat, taggedby) 
            VALUES ${tagPlaceholders}
          `;
          result = await txclient.query(query, tagValues);

          // Insert history records for new tags
          query = `
            INSERT INTO tagged_vehicle_history 
            (srcaccountid, vinno, dstaccountid, isactive, allow_retag, taggedat, taggedby) 
            VALUES ${tagPlaceholders}
          `;
          await txclient.query(query, tagValues);

          let fleetVehicleValues = [];
          const fleetVehiclePlaceholders = newTagVins
            .map((vinno, index) => {
              const startindex = index * 9 + 1; 
              const vehicleData = vehicleDataMap[vinno];
              fleetVehicleValues.push(
                dstaccountid,
                dstRootFleetId,
                vinno,
                false,
                vehicleData.accvininfo,
                currtime,
                taggedby,
                currtime,
                taggedby,
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              }, $${startindex + 7}, $${startindex + 8})`;
            })
            .join(",");

          query = `
            INSERT INTO fleet_vehicle 
            (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby) 
            VALUES ${fleetVehiclePlaceholders}
          `;
          result = await txclient.query(query, fleetVehicleValues);

          let fleetHistoryValues = [];
          const fleetHistoryPlaceholders = newTagVins
            .map((vinno, index) => {
              const startindex = index * 10 + 1;
              const vehicleData = vehicleDataMap[vinno];
              fleetHistoryValues.push(
                dstaccountid,
                dstRootFleetId,
                vinno,
                false,
                vehicleData.accvininfo,
                currtime,
                taggedby,
                currtime,
                taggedby,
                VEHICLE_ACTION.TAGGED
              );
              return `($${startindex}, $${startindex + 1}, $${
                startindex + 2
              }, $${startindex + 3}, $${startindex + 4}, $${startindex + 5}, $${
                startindex + 6
              }, $${startindex + 7}, $${startindex + 8}, $${startindex + 9})`;
            })
            .join(",");

          query = `
            INSERT INTO fleet_vehicle_history 
            (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby, action) 
            VALUES ${fleetHistoryPlaceholders}
          `;
          await txclient.query(query, fleetHistoryValues);
        }

        for (let vinno of validVins) {
          const isRetag = existingTags[vinno] !== undefined;
          vinResults.push({
            vinno: vinno,
            status: "success",
            reason: isRetag ? "vehicle_retagged" : "vehicle_tagged",
            message: isRetag
              ? "Vehicle retagged successfully"
              : "Vehicle tagged successfully",
            details: {
              srcaccountid,
              srcaccountname: srcAccountName,
              dstaccountid,
              dstaccountname: dstAccountName,
              dstfleetid: dstRootFleetId,
              taggedat: currtime,
              taggedby,
              allow_retag,
              isowner: false,
              vehicleinfo: vehicleDataMap[vinno] || {},
              action: isRetag ? "retagged" : "tagged",
            },
          });
        }
      }

      const countResult = await txclient.query(
        `SELECT COUNT(vinno) AS vehicle_count FROM fleet_vehicle WHERE accountid = $1`,
        [dstaccountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET vehicles = $1 WHERE accountid = $2`,
        [vehicleCount, dstaccountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        return {
          status: "error",
          message: "Failed to commit transaction",
          details: {
            error: commiterr.message,
          },
        };
      }

      const successCount = vinResults.filter(
        (r) => r.status === "success"
      ).length;

      return {
        status: successCount > 0 ? "success" : "error",
        message:
          successCount > 0
            ? "Vehicles tagged successfully"
            : "No vehicles were tagged",
        vinresults: vinResults,
        summary: {
          totalvehicles: vinnos.length,
          successcount: successCount,
          errorcount: vinResults.filter((r) => r.status === "error").length,
          srcaccountid,
          srcaccountname: srcAccountName,
          dstaccountid,
          dstaccountname: dstAccountName,
          dstfleetid: dstRootFleetId,
          taggedat: currtime,
          taggedby,
          allow_retag,
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      return {
        status: "error",
        message: "Failed to tag vehicles",
        details: {
          error: e.message,
          rollbackerror: rollbackerr ? rollbackerr.message : null,
        },
      };
    }
  }

  async untagVehicle(srcaccountid, dstaccountid, vinnos, untaggedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      return {
        status: "error",
        message: "Failed to start database transaction",
        details: {
          error: err.message,
        },
      };
    }

    try {
      const vinList = vinnos.map((vin) => `'${vin}'`).join(",");
      const vinResults = [];

      // Check if source account exists
      let query = `
        SELECT accountid, accountname FROM account 
        WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      let result = await txclient.query(query, [srcaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Source account not found or not enabled",
          details: { srcaccountid },
        };
      }
      const srcAccountName = result.rows[0].accountname;

      // Check if destination account exists
      query = `
        SELECT accountid, accountname FROM account 
        WHERE accountid = $1 AND isenabled = true AND isdeleted = false
      `;
      result = await txclient.query(query, [dstaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Destination account not found or not enabled",
          details: { dstaccountid },
        };
      }
      const dstAccountName = result.rows[0].accountname;

      // Get destination account's root fleet ID
      query = `
        SELECT fleetid FROM account_fleet 
        WHERE accountid = $1 AND isroot = true
      `;
      result = await txclient.query(query, [dstaccountid]);
      if (result.rowCount !== 1) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Destination account root fleet not found",
          details: { dstaccountid },
        };
      }
      const dstRootFleetId = result.rows[0].fleetid;

      // Check which vehicles are currently tagged
      query = `
        SELECT tv.vinno, tv.isactive, tv.allow_retag, tv.taggedat, vm.modelvariant as vehiclevariant, vm.modelname as vehiclemodel
        FROM tagged_vehicle tv
        JOIN vehicle v ON tv.vinno = v.vinno
        JOIN vehicle_model vm ON v.modelcode = vm.modelcode
        WHERE tv.srcaccountid = $1 AND tv.dstaccountid = $2 AND tv.vinno IN (${vinList})
      `;
      result = await txclient.query(query, [srcaccountid, dstaccountid]);

      const taggedVehicles = {};
      result.rows.forEach((row) => {
        taggedVehicles[row.vinno] = {
          isactive: row.isactive,
          allow_retag: row.allow_retag,
          taggedat: row.taggedat,
          vehiclevariant: row.vehiclevariant,
          vehiclemodel: row.vehiclemodel,
        };
      });

      // Check which vehicles exist in destination fleet_vehicle
      query = `
        SELECT fv.vinno, COALESCE(v.license_plate, v.vinno) as regno, fv.accvininfo, fv.assignedat, fv.assignedby
        FROM fleet_vehicle fv
        JOIN vehicle v ON fv.vinno = v.vinno
        WHERE fv.accountid = $1 AND fv.vinno IN (${vinList})
      `;
      result = await txclient.query(query, [dstaccountid]);

      const vehiclesInDstFleet = {};
      result.rows.forEach((row) => {
        vehiclesInDstFleet[row.vinno] = {
          regno: row.regno,
          accvininfo: row.accvininfo,
          assignedat: row.assignedat,
          assignedby: row.assignedby,
        };
      });

      const notTaggedVins = vinnos.filter((vin) => !taggedVehicles[vin]);
      const inactiveTaggedVins = vinnos.filter(
        (vin) => taggedVehicles[vin] && !taggedVehicles[vin].isactive
      );
      const activeTaggedVins = vinnos.filter(
        (vin) => taggedVehicles[vin] && taggedVehicles[vin].isactive
      );

      // Mark vehicles that are not tagged as errors
      for (let vinno of notTaggedVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          reason: "vehicle_not_tagged",
          message: "Vehicle is not tagged to destination account",
          details: {
            srcaccountid,
            dstaccountid,
            currentstatus: "not_tagged",
          },
        });
      }

      // Mark vehicles that are already inactive as errors
      for (let vinno of inactiveTaggedVins) {
        vinResults.push({
          vinno: vinno,
          status: "error",
          reason: "vehicle_already_untagged",
          message: "Vehicle is already untagged from destination account",
          details: {
            srcaccountid,
            dstaccountid,
            currentstatus: "inactive",
            previoustaggedat: taggedVehicles[vinno].taggedat,
          },
        });
      }

      if (activeTaggedVins.length === 0) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "No vehicles can be untagged",
          vinresults: vinResults,
          summary: {
            totalvehicles: vinnos.length,
            successcount: 0,
            errorcount: vinResults.length,
            srcaccountid,
            srcaccountname: srcAccountName,
            dstaccountid,
            dstaccountname: dstAccountName,
          },
        };
      }

      // Update tagged vehicles to inactive
      const activeVinList = activeTaggedVins.map((vin) => `'${vin}'`).join(",");
      query = `
        UPDATE tagged_vehicle 
        SET isactive = false, taggedat = $1, taggedby = $2
        WHERE srcaccountid = $3 AND dstaccountid = $4 AND vinno IN (${activeVinList}) AND isactive = true
      `;
      result = await txclient.query(query, [
        currtime,
        untaggedby,
        srcaccountid,
        dstaccountid,
      ]);

      if (result.rowCount !== activeTaggedVins.length) {
        await this.pgPoolI.TxRollback(txclient);
        return {
          status: "error",
          message: "Failed to untag some vehicles",
          details: {
            expected: activeTaggedVins.length,
            actual: result.rowCount,
            vinnos: activeTaggedVins,
          },
        };
      }

      // Insert history records for untagged vehicles
      let historyValues = [];
      const historyPlaceholders = activeTaggedVins
        .map((vinno, index) => {
          const startindex = index * 7 + 1;
          historyValues.push(
            srcaccountid,
            vinno,
            dstaccountid,
            false,
            taggedVehicles[vinno].allow_retag,
            currtime,
            untaggedby
          );
          return `($${startindex}, $${startindex + 1}, $${startindex + 2}, $${
            startindex + 3
          }, $${startindex + 4}, $${startindex + 5}, $${startindex + 6})`;
        })
        .join(",");

      query = `
        INSERT INTO tagged_vehicle_history 
        (srcaccountid, vinno, dstaccountid, isactive, allow_retag, taggedat, taggedby) 
        VALUES ${historyPlaceholders}
      `;
      await txclient.query(query, historyValues);

      const vehiclesToRemove = activeTaggedVins.filter(
        (vinno) => vehiclesInDstFleet[vinno]
      );

      if (vehiclesToRemove.length > 0) {
        const removeVinList = vehiclesToRemove
          .map((vin) => `'${vin}'`)
          .join(",");

        let fleetHistoryValues = [];
        const fleetHistoryPlaceholders = vehiclesToRemove
          .map((vinno, index) => {
            const startindex = index * 10 + 1;
            const vehicleData = vehiclesInDstFleet[vinno];
            fleetHistoryValues.push(
              dstaccountid,
              dstRootFleetId,
              vinno,
              false,
              vehicleData.accvininfo,
              vehicleData.assignedat,
              vehicleData.assignedby,
              currtime,
              untaggedby,
              VEHICLE_ACTION.UNTAGGED
            );
            return `($${startindex}, $${startindex + 1}, $${startindex + 2}, $${
              startindex + 3
            }, $${startindex + 4}, $${startindex + 5}, $${startindex + 6}, $${
              startindex + 7
            }, $${startindex + 8}, $${startindex + 9})`;
          })
          .join(",");

        query = `
          INSERT INTO fleet_vehicle_history 
          (accountid, fleetid, vinno, isowner, accvininfo, assignedat, assignedby, updatedat, updatedby, action) 
          VALUES ${fleetHistoryPlaceholders}
        `;
        await txclient.query(query, fleetHistoryValues);

        query = `
          DELETE FROM fleet_vehicle 
          WHERE accountid = $1 AND vinno IN (${removeVinList})
        `;
        result = await txclient.query(query, [dstaccountid]);

        if (result.rowCount !== vehiclesToRemove.length) {
          await this.pgPoolI.TxRollback(txclient);
          return {
            status: "error",
            message: "Failed to remove some vehicles from destination fleet",
            details: {
              expected: vehiclesToRemove.length,
              actual: result.rowCount,
              vinnos: vehiclesToRemove,
            },
          };
        }
      }

      for (let vinno of activeTaggedVins) {
        vinResults.push({
          vinno: vinno,
          status: "success",
          reason: "vehicle_untagged",
          message: "Vehicle untagged successfully",
          details: {
            srcaccountid,
            srcaccountname: srcAccountName,
            dstaccountid,
            dstaccountname: dstAccountName,
            dstfleetid: dstRootFleetId,
            untaggedat: currtime,
            untaggedby,
            previoustaggedat: taggedVehicles[vinno].taggedat,
            removedfromfleet: !!vehiclesInDstFleet[vinno],
            vehicleinfo: {
              vehiclevariant: taggedVehicles[vinno].vehiclevariant,
              vehiclemodel: taggedVehicles[vinno].vehiclemodel,
            },
            action: "untagged",
          },
        });
      }

      const countResult = await txclient.query(
        `SELECT COUNT(vinno) AS vehicle_count FROM fleet_vehicle WHERE accountid = $1`,
        [dstaccountid]
      );

      const vehicleCount = countResult.rows[0].vehicle_count;

      // Update account_summary with the correct count
      await txclient.query(
        `UPDATE account_summary SET vehicles = $1 WHERE accountid = $2`,
        [vehicleCount, dstaccountid]
      );

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        return {
          status: "error",
          message: "Failed to commit transaction",
          details: {
            error: commiterr.message,
          },
        };
      }

      const successCount = vinResults.filter(
        (r) => r.status === "success"
      ).length;

      return {
        status: successCount > 0 ? "success" : "error",
        message:
          successCount > 0
            ? "Vehicles untagged successfully"
            : "No vehicles were untagged",
        vinresults: vinResults,
        summary: {
          totalvehicles: vinnos.length,
          successcount: successCount,
          errorcount: vinResults.filter((r) => r.status === "error").length,
          srcaccountid,
          srcaccountname: srcAccountName,
          dstaccountid,
          dstaccountname: dstAccountName,
          dstfleetid: dstRootFleetId,
          untaggedat: currtime,
          untaggedby,
          vehiclesremovedfromfleet: vehiclesToRemove.length,
        },
      };
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      return {
        status: "error",
        message: "Failed to untag vehicles",
        details: {
          error: e.message,
          rollbackerror: rollbackerr ? rollbackerr.message : null,
        },
      };
    }
  }

  async getRegno(vinNumbers) {
    try {
      const vins = vinNumbers.map((vin) => `'${vin}'`).join(",");
      const query = `
      SELECT
        v.vinno,
        v.license_plate,
        vm.modelinfo,
        vm.modelfamilycode
      FROM
        vehicle v
      JOIN
        vehicle_model vm
      ON
        v.modelcode = vm.modelcode
      WHERE
        v.vinno IN (${vins})
    `;
      const result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      this.logger.error("Error fetching vehicle details:", error);
      throw error;
    }
  }

  async getChargeStationTypes(accountid) {
    try {
      let vehicleQuery = `
        SELECT DISTINCT v.modelcode
        FROM fleet_vehicle fv
        JOIN vehicle v ON fv.vinno = v.vinno
        WHERE fv.accountid = $1
      `;

      let vehicleResult = await this.pgPoolI.Query(vehicleQuery, [accountid]);
      if (vehicleResult.rowCount === 0) {
        return {
          chargestationtype: [],
          modelfamilies: [],
        };
      }

      const modelCodes = vehicleResult.rows.map((row) => row.modelcode);

      let modelFamilyQuery = `
        SELECT vmf.modelfamilycode, vmf.modelfamilyname, vmf.modelfamilyinfo 
        FROM vehicle_modelfamily vmf, vehicle_model vm 
        WHERE vm.modelfamilycode = vmf.modelfamilycode 
          AND vm.modelcode = ANY($1)
      `;

      let result = await this.pgPoolI.Query(modelFamilyQuery, [modelCodes]);
      if (result.rowCount === 0) {
        return {
          chargestationtype: [],
          modelfamilies: [],
        };
      }

      const allChargeStationTypes = new Set();
      const modelFamiliesMap = new Map();

      for (let row of result.rows) {
        const modelfamilyinfo = row.modelfamilyinfo;

        if (
          modelfamilyinfo &&
          modelfamilyinfo.chargestationtype &&
          Array.isArray(modelfamilyinfo.chargestationtype) &&
          modelfamilyinfo.chargestationtype.length > 0
        ) {
          const chargestationtype = modelfamilyinfo.chargestationtype;

          chargestationtype.forEach((type) => allChargeStationTypes.add(type));

          if (!modelFamiliesMap.has(row.modelfamilycode)) {
            modelFamiliesMap.set(row.modelfamilycode, {
              modelfamilycode: row.modelfamilycode,
              modelfamilyname: row.modelfamilyname,
              chargestationtype: chargestationtype,
            });
          }
        }
      }

      return {
        chargestationtype: Array.from(allChargeStationTypes).sort(),
        modelfamilies: Array.from(modelFamiliesMap.values()),
      };
    } catch (error) {
      this.logger.error("Error in getChargeStationTypes:", error);
      throw new Error("Failed to retrieve charger station types");
    }
  }

  async getLatestCanDataForVins(vinList) {
    try {
      const BATCH_SIZE = 500; // Process 500 VINs at a time
      const canDataMap = {};

      // Process VINs in batches
      for (let i = 0; i < vinList.length; i += BATCH_SIZE) {
        const batch = vinList.slice(i, i + BATCH_SIZE);
        const vins = batch.map((vin) => `'${vin}'`).join(",");

        const query = `
          SELECT vin, utctime, odometer, bms_cyclenum
          FROM lmmdata_latest.candatalatest
          WHERE (vin, utctime) GLOBAL IN (
            SELECT
              vin,
              max(utctime) AS max_utctime
            FROM lmmdata_latest.candatalatest
            WHERE vin IN (${vins})
            GROUP BY vin
          )
        `;

        this.logger.info(
          `Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
            vinList.length / BATCH_SIZE
          )} with ${batch.length} VINs`
        );

        const result = await this.clickHouseClient.query(query);

        if (!result.success) {
          this.logger.error(
            `Failed to query ClickHouse for CAN data batch ${
              Math.floor(i / BATCH_SIZE) + 1
            }:`,
            result.error
          );
          // Continue with other batches instead of failing completely
          continue;
        }

        // Merge batch results into main map
        for (let row of result.data) {
          canDataMap[row.vin] = {
            odometer: row.odometer,
            bms_cyclenum: row.bms_cyclenum,
          };
        }

        // Add a small delay between batches to avoid overwhelming the database
        if (i + BATCH_SIZE < vinList.length) {
          await new Promise((resolve) => setTimeout(resolve, 50)); // 50ms delay
        }
      }

      this.logger.info(
        `Successfully fetched CAN data for ${
          Object.keys(canDataMap).length
        } out of ${vinList.length} vehicles`
      );
      return canDataMap;
    } catch (error) {
      this.logger.error("Error fetching latest vehicle data:", error);
      throw error;
    }
  }

  async getAllWebModules() {
    try {
      let query = `
        SELECT moduleid, modulename, moduletype, modulecode, moduleinfo, creditspervehicleday, isenabled, priority 
        FROM module 
        WHERE moduletype = 'web' AND isenabled = true 
        ORDER BY priority
      `;
      let result = await this.pgPoolI.Query(query);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error("Unable to retrieve web modules.");
    }
  }

  async getAllModulePerms(modules) {
    try {
      let query = `
        SELECT m.moduleid, m.modulename, mp.permid FROM module m JOIN module_perm mp ON m.moduleid = mp.moduleid
        WHERE m.moduletype = 'web' AND m.isenabled = true AND mp.isenabled = true AND m.moduleid = ANY($1) ORDER BY m.priority
      `;
      let result = await this.pgPoolI.Query(query, [modules]);
      if (result.rowCount === 0) {
        return [];
      }

      return result.rows;
    } catch (error) {
      throw new Error("Unable to retrieve web module permissions.");
    }
  }

  // credits
  async getAccountCredits(accountid) {
    try {
      let query = `
            SELECT credits FROM account_credits WHERE accountid = $1
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Account credits not found");
      }
      return result.rows[0]?.credits || 0;
    } catch (error) {
      this.logger.error("Error in getAccountCreditsDB:", error);
      throw new Error("Failed to get account credits");
    }
  }

  async getAccountCreditsOverview(accountid, starttime, endtime) {
    let query = `
      SELECT 
        DATE(targetdate) as targetdate, 
        SUM(CASE WHEN deltacredits > 0 THEN deltacredits ELSE 0 END) as creditsadded,
        SUM(CASE WHEN deltacredits < 0 THEN ABS(deltacredits) ELSE 0 END) as creditsconsumed,
        MAX(totalvehicles) as totalvehicles,
        MAX(subscribedvehicles) as subscribedvehicles,
        MAX(connectedvehicles) as connectedvehicles
      FROM account_credits_history
      WHERE accountid = $1 AND DATE(targetdate) BETWEEN $2 AND $3 
      GROUP BY DATE(targetdate)
      ORDER BY targetdate ASC
    `;

    let result = await this.pgPoolI.Query(query, [
      accountid,
      new Date(starttime),
      new Date(endtime),
    ]);

    if (result.rowCount === 0) {
      return [];
    }

    for (let row of result.rows) {
      row.targetdate = DateTime.fromJSDate(row.targetdate, {
        zone: "utc",
      }).toFormat("dd LLL yyyy");
      row.creditsadded = Number(row.creditsadded) || 0;
      row.creditsconsumed = Number(row.creditsconsumed) || 0;
      row.totalvehicles = Number(row.totalvehicles) || 0;
      row.subscribedvehicles = Number(row.subscribedvehicles) || 0;
      row.connectedvehicles = Number(row.connectedvehicles) || 0;
    }

    return result.rows;
  }

  async getAccountCreditsHistory(accountid, starttime, endtime) {
    let query = `
            SELECT ach.targetdate, ach.updatedat, ach.deltacredits, ach.closingcredits, ach.pkginfo, ach.txninfo, 
            ach.totalvehicles, ach.subscribedvehicles, ach.connectedvehicles, ach.comment, 
            COALESCE(u.displayname, 'Unknown User') as updatedby 
            FROM account_credits_history ach
            LEFT JOIN users u ON ach.updatedby = u.userid
            WHERE ach.accountid = $1 AND ach.targetdate BETWEEN $2 AND $3 
            ORDER BY targetdate, updatedat DESC
        `;

    let result = await this.pgPoolI.Query(query, [
      accountid,
      new Date(starttime),
      new Date(endtime),
    ]);

    if (result.rowCount === 0) {
      return [];
    }

    for (let row of result.rows) {
      row.targetdate = DateTime.fromJSDate(row.targetdate, {
        zone: "utc",
      })
        .setZone("Asia/Kolkata")
        .toFormat("dd LLL yyyy");

      row.creditsadded = Number(row.deltacredits > 0 ? row.deltacredits : 0);
      row.creditsconsumed = Number(
        row.deltacredits < 0 ? -row.deltacredits : 0
      );

      row.openingbalance = Number(row.closingcredits - row.deltacredits);
      row.closingbalance = Number(row.closingcredits) || 0;

      delete row.deltacredits;
    }

    return result.rows;
  }

  async getAccountVehicleCreditsHistory(accountid, vinnos, starttime, endtime) {
    let query = `
      SELECT accv.targetdate, accv.vinno, accv.createdat, COALESCE(u.displayname, 'Unknown User') as createdby, ach.deltacredits 
      FROM account_credits_consumption_vehdetail accv
      LEFT JOIN users u ON accv.createdby = u.userid
      LEFT JOIN account_credits_history ach ON accv.accountid = ach.accountid AND accv.targetdate = ach.targetdate
      WHERE accv.accountid = $1 AND accv.vinno = ANY($2) AND accv.targetdate BETWEEN $3 AND $4
      ORDER BY targetdate, createdat DESC
    `;

    let result = await this.pgPoolI.Query(query, [
      accountid,
      vinnos,
      new Date(starttime),
      new Date(endtime),
    ]);

    if (result.rowCount === 0) {
      return [];
    }

    for (let row of result.rows) {
      // Use DateTime to properly handle timezone conversion for PostgreSQL DATE type
      row.targetdate = DateTime.fromJSDate(row.targetdate, {
        zone: "utc",
      })
        .setZone("Asia/Kolkata")
        .toFormat("dd LLL yyyy");

      row.creditsadded = Number(row.deltacredits > 0 ? row.deltacredits : 0);
      row.creditsconsumed = Number(
        row.deltacredits < 0 ? -row.deltacredits : 0
      );

      delete row.deltacredits;
    }

    return result.rows;
  }

  /**
   *
   * @param {*} accountid
   * @param {*} credits - can be positive or negative
   * @param {*} updatedby
   * @returns
   */
  async updateAccountCredits(accountid, credits, updatedby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
                  UPDATE account_credits SET credits = credits + $1 WHERE accountid = $2 RETURNING credits
              `;
      let result = await txclient.query(query, [credits, accountid]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to increment account credits");
      }
      let closingcredits = result.rows[0].credits;

      query = `
                  INSERT INTO account_credits_history (accountid, targetdate, updatedat, deltacredits, closingcredits, pkginfo, txninfo, totalvehicles, subscribedvehicles, connectedvehicles, comment, updatedby) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              `;
      result = await txclient.query(query, [
        accountid,
        currtime,
        currtime,
        credits,
        closingcredits,
        {},
        {},
        0,
        0,
        0,
        "Credits added",
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to create account credits history");
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }
      return closingcredits;
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
    }
  }

  // helper function
  async getAccountAndPackageInfo(accountid) {
    try {
      let query = `
        SELECT 
          p.pkgname,
          p.pkginfo,
          aps.pkgid,
          COUNT(avs.vinno) as total_subscribed_vehicles,
          COALESCE(ac.credits, 0) as available_credits
        FROM account_package_subscription aps
        JOIN package p ON aps.pkgid = p.pkgid
        LEFT JOIN account_vehicle_subscription avs ON aps.accountid = avs.accountid AND avs.state = 1
        LEFT JOIN account_credits ac ON aps.accountid = ac.accountid
        WHERE aps.accountid = $1
        GROUP BY p.pkgname, p.pkginfo, aps.pkgid, ac.credits
      `;

      let result = await this.pgPoolI.Query(query, [accountid]);

      if (result.rowCount === 0) {
        return null;
      }

      const row = result.rows[0];
      const pkgid = row.pkgid;

      query = `
        SELECT moduleid, creditspervehicleday FROM module WHERE isenabled = true
      `;
      const allModulesResult = await this.pgPoolI.Query(query);
      const allModules = allModulesResult.rows || [];

      query = `
        SELECT moduleid FROM package_module WHERE pkgid = $1
      `;
      const pkgModulesResult = await this.pgPoolI.Query(query, [pkgid]);
      const assignedModuleIds = pkgModulesResult.rows.map(
        (row) => row.moduleid
      );

      let pkgcost = 0;
      for (let module of allModules) {
        if (assignedModuleIds.includes(module.moduleid)) {
          pkgcost += Number(module.creditspervehicleday);
        }
      }

      return {
        pkgname: row.pkgname,
        graceperiod: row.pkginfo?.graceperiod || 0,
        total_subscribed_vehicles: parseInt(row.total_subscribed_vehicles) || 0,
        available_credits: parseFloat(row.available_credits) || 0,
        total_credits_per_vehicle_day: pkgcost,
      };
    } catch (error) {
      throw new Error("Unable to retrieve account and package information");
    }
  }

  async getSharedVehicles(accountid) {
    try {
      const query = `
        SELECT DISTINCT
          tv.vinno,
          COALESCE(v.license_plate, v.vinno) as regno,
          v.modelcode,
          vm.modeldisplayname
        FROM tagged_vehicle tv
        JOIN vehicle v ON tv.vinno = v.vinno
        LEFT JOIN vehicle_model vm ON v.modelcode = vm.modelcode
        WHERE tv.srcaccountid = $1 AND tv.isactive = true
        ORDER BY tv.vinno
      `;

      let result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows || [];
    } catch (error) {
      this.logger.error("getSharedVehicles error: ", error);
      throw new Error("Unable to retrieve shared vehicles information");
    }
  }

  async getVehicleInfo(accountid, vinno) {
    try {
      const query = `
      SELECT 
        fv.vinno,
        COALESCE(v.license_plate, v.vinno) as regno,
        fv.isowner,
        fv.accvininfo,
        fv.assignedat,
        fv.updatedat,
        vm.modelvariant as vehiclevariant,
        vm.modelname as vehiclemodel,
        v.modelcode,
        vm.modeldisplayname,
        v.vehicleinfo,
        v.delivered_date,
        v.vehicle_city,
        u1.displayname as assignedby,
        u2.displayname as updatedby
      FROM fleet_vehicle fv
      JOIN vehicle v ON fv.vinno = v.vinno
      LEFT JOIN vehicle_model vm ON v.modelcode = vm.modelcode
      JOIN users u1 ON fv.assignedby = u1.userid
      JOIN users u2 ON fv.updatedby = u2.userid
      WHERE fv.accountid = $1 AND fv.vinno = $2
      LIMIT 1
    `;

      let result = await this.pgPoolI.Query(query, [accountid, vinno]);
      return result.rowCount > 0 ? result.rows[0] : null;
    } catch (error) {
      this.logger.error("getVehicleInfo error: ", error);
      throw new Error("Unable to retrieve vehicle information");
    }
  }

  async getSharedAccounts(accountid, vinno) {
    try {
      const query = `
      SELECT 
        tv.dstaccountid,
        tv.taggedat,
        tv.allow_retag,
        tv.isactive,
        da.accountname,
        da.accounttype,
        da.accountinfo,
        u.displayname as tagged_by_user,
        u.userid as tagged_by_userid
      FROM tagged_vehicle tv
      JOIN account da ON tv.dstaccountid = da.accountid
      JOIN users u ON tv.taggedby = u.userid
      WHERE tv.srcaccountid = $1 AND tv.vinno = $2 AND tv.isactive = true
      ORDER BY tv.taggedat DESC
    `;

      let result = await this.pgPoolI.Query(query, [accountid, vinno]);
      return result.rows || [];
    } catch (error) {
      this.logger.error("getSharedAccounts error: ", error);
      throw new Error("Unable to retrieve shared accounts information");
    }
  }

  async getVehiclesSharedToMe(accountid) {
    try {
      const query = `
        SELECT 
          tv.vinno,
          COALESCE(v.license_plate, v.vinno) as regno,
          v.modelcode,
          vm.modeldisplayname,
          tv.taggedat,
          tv.allow_retag,
          sa.accountname as owner_account_name,
          sa.accounttype as owner_account_type,
          sa.accountid as owner_account_id,
          u.displayname as tagged_by_user,
          u.userid as tagged_by_userid
        FROM tagged_vehicle tv
        JOIN vehicle v ON tv.vinno = v.vinno
        LEFT JOIN vehicle_model vm ON v.modelcode = vm.modelcode
        JOIN account sa ON tv.srcaccountid = sa.accountid
        JOIN users u ON tv.taggedby = u.userid
        WHERE tv.dstaccountid = $1 AND tv.isactive = true
        ORDER BY tv.taggedat DESC
      `;

      let result = await this.pgPoolI.Query(query, [accountid]);
      return result.rows || [];
    } catch (error) {
      this.logger.error("getVehiclesSharedToMe error: ", error);
      throw new Error(
        "Unable to retrieve vehicles shared to account information"
      );
    }
  }

  async getAccountInfo(accountid) {
    try {
      let query = `
        SELECT 
          a.accountid,
          a.accountname,
          a.createdat,
          a.updatedat,
          u1.displayname as createdby,
          u2.displayname as updatedby
        FROM account a
        LEFT JOIN users u1 ON a.createdby = u1.userid
        LEFT JOIN users u2 ON a.updatedby = u2.userid
        WHERE a.accountid = $1 AND a.isenabled = true AND a.isdeleted = false
      `;
      let result = await this.pgPoolI.Query(query, [accountid]);

      if (result.rowCount === 0) {
        throw new Error("Account not found");
      }

      return result.rows[0];
    } catch (error) {
      this.logger.error("getAccountInfo error:", error);
      throw new Error("Failed to get account information");
    }
  }

  async getFleetUserRoleHistory(accountid, starttime, endtime) {
    try {
      // WITH RECURSIVE fleet_hierarchy AS (
      //   SELECT fleetid, accountid, pfleetid, name
      //   FROM fleet_tree 
      //   WHERE accountid = $1
        
      //   UNION ALL
        
      //   SELECT ft.fleetid, ft.accountid, ft.pfleetid, ft.name
      //   FROM fleet_tree ft
      //   INNER JOIN fleet_hierarchy fh ON ft.pfleetid = fh.fleetid AND ft.accountid = fh.accountid
      // )
      let query = `
        SELECT a.accountname, ft.name, u.displayname as username, r.rolename as rolename, fuh.isenabled, fuh.action, fuh.updatedat, u.displayname as updatedby
        FROM fleet_user_role_history fuh
        JOIN account a ON fuh.accountid = a.accountid
        JOIN fleet_tree ft ON fuh.fleetid = ft.fleetid
        JOIN users u ON fuh.userid = u.userid
        JOIN roles r ON fuh.roleid = r.roleid
        WHERE fuh.accountid = $1 AND fuh.updatedat >= $2 AND fuh.updatedat <= $3
        GROUP BY a.accountname, ft.name, u.displayname, r.rolename,
         fuh.isenabled, fuh.action, fuh.updatedat
        ORDER BY fuh.updatedat DESC
      `;
      let result = await this.pgPoolI.Query(query, [accountid, new Date(starttime), new Date(endtime)]);
      return result.rows;
    } catch (error) {
      this.logger.error("getFleetUserRoleHistory error: ", error);
      throw new Error("Failed to get fleet user role history");
    }
  }
}
