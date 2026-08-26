import {
  FLEET_INVITE_EXPIRY_TIME,
  FLEET_INVITE_STATUS,
  FLEET_INVITE_TYPE,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_ROLE_TYPE,
} from "../../../utils/constant.js";
import { EncryptPassword, Sha256hash } from "../../../utils/eccutil.js";
import {
  getInviteEmailTemplate,
  isRedundantInvite,
  markInviteAsExpired,
  updateInviteExpiryAndSendEmail,
} from "../../../utils/inviteUtil.js";
import {v4 as uuidv4} from "uuid";
export default class PUserSvcDB {
  /**
   *
   * @param {PgPool} pgPoolI
   */
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
  }

  generateRandomPassword() {
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const specialChars = "@-_";
    const allChars = uppercase + lowercase + numbers + specialChars;

    let password = "";

    password += uppercase[Math.floor(Math.random() * uppercase.length)];
    password += lowercase[Math.floor(Math.random() * lowercase.length)];
    password += numbers[Math.floor(Math.random() * numbers.length)];
    password += specialChars[Math.floor(Math.random() * specialChars.length)];

    for (let i = 4; i < 12; i++) {
      password += allChars[Math.floor(Math.random() * allChars.length)];
    }

    return password
      .split("")
      .sort(() => Math.random() - 0.5)
      .join("");
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
      throw new Error("Failed to retrieve username");
    }
  }

  // Note: this function is same as accountsvc_db.triggerEmailInviteToRootFleet
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
          `pusersvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
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
              `pusersvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
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
            `pusersvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
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
            success: true,
            inviteid: inviteToUpdate.inviteid,
            isUpdated: true,
          };
        }
      }

      this.logger.info(
        `pusersvc_db.triggerEmailInviteToRootFleet: Sending new invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
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
        success: true,
        inviteid: inviteid,
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
          `pusersvc_db.triggerEmailInviteToRootFleet: Redundant invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
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
              `pusersvc_db.triggerEmailInviteToRootFleet: markInviteAsExpired: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${row.inviteid}`
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
            `pusersvc_db.triggerEmailInviteToRootFleet: updateInviteExpiry: accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteToUpdate.inviteid}, roleid: ${inviteToUpdate.roleid}, currtime: ${currtime}`
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
        `pusersvc_db.triggerEmailInviteToRootFleet: Sending new invite. accountid: ${accountid}, fleetid: ${fleetid}, inviteid: ${inviteid}, email: ${email}, roleids: ${roleids}, invitedby: ${invitedby}, headerReferer: ${headerReferer}`
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
          `pusersvc_db.resendInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${inviteid}`
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

  async getAllUserRoles(userid) {
    try {
      let query = ` select a.accountid, a.accountname, r.roleid, r.rolename, r.roletype from fleet_user_role fur, account a, roles r where fur.accountid = a.accountid and fur.accountid = r.accountid and fur.roleid = r.roleid and r.isenabled = $1 and fur.userid = $2`;
      let result = await this.pgPoolI.Query(query, [true, userid]);
      if (result.rowCount === 0) {
        return null;
      } // TODO: resume

      const processedRows = result.rows.map((row) => {
        if (row.accountid === PLATFORM_ACCOUNT_ID) {
          return {
            ...row,
            roletype: PLATFORM_ROLE_TYPE,
          };
        }
        return row;
      });

      return processedRows;
    } catch (error) {
      throw new Error("Failed to retrieve user roles");
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

  async addUserRole(accountid, fleetid, userid, roleids, updatedby) {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    let currtime = new Date();
    try {
      let values = [];
      if (roleids.length > 0) {
        const placeholders = roleids
          .map((roleid, index) => {
            const startIndex = index * 6 + 1;
            values.push(
              userid,
              accountid,
              fleetid,
              roleid,
              currtime,
              updatedby
            );
            return `($${startIndex}, $${startIndex + 1}, $${startIndex + 2}, $${
              startIndex + 3
            }, $${startIndex + 4}, $${startIndex + 5})`;
          })
          .join(",");

        let query = `
                INSERT INTO fleet_user_role (userid, accountid, fleetid, roleid, assignedat, assignedby) VALUES ${placeholders}
                ON CONFLICT (userid, accountid, fleetid, roleid) DO NOTHING
            `;
        let result = await txclient.query(query, values);
        if (result.rowCount !== roleids.length) {
          this.logger.error("Some roles were not added", {
            userid: userid,
            accountid: accountid,
            fleetid: fleetid,
            roleids: roleids,
            updatedby: updatedby,
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
            true,
            "ADD",
            currtime,
            updatedby,
          ]);
          if (result.rowCount !== 1) {
            throw new Error("Failed to add log to fleet_user_role_history");
          }
        }
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return true;
    } catch (error) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw new Error("Failed to add user role");
    }
  }

  async removeUserRole(accountid, fleetid, userid, roleid, updatedby) {
    let currtime = new Date();
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let query = `
        DELETE FROM fleet_user_role WHERE userid = $1 AND accountid = $2 AND fleetid = $3 AND roleid = $4
      `;
      let result = await txclient.query(query, [
        userid,
        accountid,
        fleetid,
        roleid,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to remove user role");
      }

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
        updatedby,
      ]);
      if (result.rowCount !== 1) {
        throw new Error("Failed to add log to fleet_user_role_history");
      }

      query = `
        SELECT COUNT(*) as count FROM fleet_user_role 
        WHERE userid = $1 AND accountid = $2 AND fleetid = $3
      `;
      result = await txclient.query(query, [userid, accountid, fleetid]);

      const remainingRoles = parseInt(result.rows[0].count);

      if (remainingRoles === 0) {
        query = `
          DELETE FROM user_fleet WHERE userid = $1 AND accountid = $2 AND fleetid = $3
        `;
        result = await txclient.query(query, [userid, accountid, fleetid]);
        if (result.rowCount !== 1) {
          throw new Error("Failed to remove user from fleet");
        }
      }

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        throw commiterr;
      }

      return true;
    } catch (error) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw new Error("Failed to remove user role");
    }
  }

  async resetUserPassword(userid, resetby) {
    let currtime = new Date();

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }

    try {
      let newPassword = this.generateRandomPassword();
      let hashedPassword = await this.hashPassword(newPassword);
      const encryptedPassword = await this.encryptPassword(hashedPassword);

      let query = `
        SELECT ssoid FROM email_pwd_sso WHERE userid = $1
      `;
      let result = await txclient.query(query, [userid]);
      if (result.rowCount === 0) {
        throw new Error("User email not found");
      }
      const userEmail = result.rows[0].ssoid;

      query = `
        UPDATE email_pwd_sso 
        SET password = $1, updatedat = $2 
        WHERE userid = $3
      `;
      result = await txclient.query(query, [
        encryptedPassword,
        currtime,
        userid,
      ]);

      if (result.rowCount !== 1) {
        throw new Error("Failed to update user password");
      }

      query = `
        SELECT displayname FROM users WHERE userid = $1 AND isdeleted = false
      `;
      result = await txclient.query(query, [userid]);
      if (result.rowCount !== 1) {
        throw new Error("User not found");
      }
      const displayname = result.rows[0].displayname;

      query = `
        SELECT displayname FROM users WHERE userid = $1 AND isdeleted = false
      `;
      result = await txclient.query(query, [resetby]);
      if (result.rowCount !== 1) {
        throw new Error("Reset by user not found");
      }
      const resetByDisplayname = result.rows[0].displayname;

      let emailTemplate = await this.getPasswordResetEmailTemplate(
        displayname,
        userEmail,
        newPassword,
        resetByDisplayname
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

      return true;
    } catch (e) {
      let rollbackerr = await this.pgPoolI.TxRollback(txclient);
      if (rollbackerr) {
        throw rollbackerr;
      }
      throw e;
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

  async checkSuperAdminRole(userid) {
    try {
      const platformAccountId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      const superAdminRoleId = "ffffffff-ffff-ffff-ffff-ffffffffffff";
      let query = `
        SELECT COUNT(*) as count 
        FROM fleet_user_role 
        WHERE accountid = $1 AND roleid = $2 AND userid = $3
      `;

      let result = await this.pgPoolI.Query(query, [
        platformAccountId,
        superAdminRoleId,
        userid,
      ]);

      return result.rows[0].count > 0;
    } catch (error) {
      this.logger.error("Error checking super admin role", error);
      return false;
    }
  }

  async listPendingUsers(
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
        WITH user_list AS (
          SELECT rpu.userid
          FROM reviewpendinguser rpu
          WHERE (
            upper(rpu.displayname) LIKE '%' || upper($1) || '%' OR
            upper(rpu.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rpu.email) LIKE '%' || upper($1) || '%' OR
            upper(rpu.status) LIKE '%' || upper($1) || '%' OR
            upper(rpu.gender) LIKE '%' || upper($1) || '%' OR
            upper(rpu.vehiclemobile) LIKE '%' || upper($1) || '%'
          )
          ORDER BY rpu.${orderbyfield} ${orderbydirection}
          ${offsetquery} ${limitquery}
        )
        SELECT 
          rpu.userid, 
          rpu.displayname, 
          rpu.usertype, 
          rpu.mobile,
          rpu.email,
          rpu.address,
          rpu.city,
          rpu.country,
          rpu.pincode,
          rpu.dateofbirth,
          rpu.gender,
          rpu.vehiclemobile,
          rpu.userinfo, 
          rpu.isenabled, 
          rpu.isdeleted, 
          rpu.isemailverified, 
          rpu.ismobileverified, 
          rpu.acceptedterms, 
          rpu.original_input,
          rpu.error_status,
          rpu.status, 
          rpu.reason, 
          rpu.review_data, 
          rpu.createdat, 
          u1.displayname as createdby, 
          rpu.updatedat, 
          u2.displayname as updatedby,
          a.accountname as nemo3_account_name,
          rpu.original_input->>'nemo3_account_id' as nemo3_account_id
        FROM reviewpendinguser rpu
        JOIN user_list ul ON rpu.userid = ul.userid
        JOIN users u1 ON rpu.createdby = u1.userid
        JOIN users u2 ON rpu.updatedby = u2.userid
        LEFT JOIN account a ON a.accountid = (rpu.original_input->>'nemo3_account_id')::uuid
        ORDER BY rpu.${orderbyfield} ${orderbydirection}
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
        const countcquery = `WITH user_list AS (
          SELECT rpu.userid
          FROM reviewpendinguser rpu
          WHERE (
            upper(rpu.displayname) LIKE '%' || upper($1) || '%' OR
            upper(rpu.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rpu.email) LIKE '%' || upper($1) || '%' OR
            upper(rpu.status) LIKE '%' || upper($1) || '%' OR
            upper(rpu.gender) LIKE '%' || upper($1) || '%' OR
            upper(rpu.vehiclemobile) LIKE '%' || upper($1) || '%'
          )
        ) SELECT COUNT(*) FROM user_list`;
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
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: Math.ceil(totalcount / limit),
        };
      }
      const nextOffset =
        result.rows.length < limit ? 0 : offset + result.rows.length;
      const previousOffset = offset - limit < 0 ? 0 : offset - limit;
      if (download) {
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
      throw new Error(`Failed to list pending users: ${error.message}`);
    }
  }

  async listDoneUsers(
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
        WITH user_list AS (
          SELECT rdu.userid, rdu.reviewed_at
          FROM reviewdoneuser rdu
          WHERE (
            upper(rdu.displayname) LIKE '%' || upper($1) || '%' OR
            upper(rdu.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rdu.email) LIKE '%' || upper($1) || '%' OR
            upper(rdu.gender) LIKE '%' || upper($1) || '%' OR
            upper(rdu.vehiclemobile) LIKE '%' || upper($1) || '%'
          )
          ORDER BY rdu.${orderbyfield} ${orderbydirection}
          ${offsetquery} ${limitquery}
        )
        SELECT 
          rdu.userid, 
          rdu.displayname, 
          rdu.usertype, 
          rdu.mobile,
          rdu.email,
          rdu.address,
          rdu.city,
          rdu.country,
          rdu.pincode,
          rdu.dateofbirth,
          rdu.gender,
          rdu.vehiclemobile,
          rdu.userinfo, 
          rdu.isenabled, 
          rdu.isdeleted, 
          rdu.isemailverified, 
          rdu.ismobileverified, 
          rdu.acceptedterms, 
          rdu.original_input,
          rdu.original_status as status, 
          rdu.resolution_reason as reason, 
          rdu.review_data,
          rdu.reviewed_at, 
          u1.displayname as reviewed_by,
          rdu.updatedat, 
          u3.displayname as updatedby
        FROM reviewdoneuser rdu
        JOIN user_list ul ON rdu.userid = ul.userid AND rdu.reviewed_at = ul.reviewed_at
        JOIN users u1 ON rdu.reviewed_by = u1.userid
        JOIN users u3 ON rdu.updatedby = u3.userid
        ORDER BY rdu.${orderbyfield} ${orderbydirection}
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
        const countcquery = `WITH user_list AS (
          SELECT rdu.userid
          FROM reviewdoneuser rdu
          WHERE (
            upper(rdu.displayname) LIKE '%' || upper($1) || '%' OR
            upper(rdu.mobile) LIKE '%' || upper($1) || '%' OR
            upper(rdu.email) LIKE '%' || upper($1) || '%' OR
            upper(rdu.gender) LIKE '%' || upper($1) || '%' OR
            upper(rdu.vehiclemobile) LIKE '%' || upper($1) || '%'
          )
        ) SELECT COUNT(*) FROM user_list`;
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
          limit: totalcount,
          hasmore: false,
          totalcount: totalcount,
          totalpages: Math.ceil(totalcount / limit),
        };
      }
      if (download) {
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
        totalpages: Math.ceil(totalcount / limit),
        totalcount: totalcount,
      };
    } catch (error) {
      throw new Error(`Failed to list done users: ${error.message}`);
    }
  }

  async getPasswordResetEmailTemplate(
    displayname,
    email,
    password,
    resetByDisplayname
  ) {
    try {
      let subject = `Nemo Platform - Password Reset`;
      let body = `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title></title>
          <link
            href="https://fonts.googleapis.com/css2?family=Georama:wght@400;600&display=swap"
            rel="stylesheet"
          />
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: "Georama", sans-serif;
              background-color: #ffffff;
            }
          
            a[x-apple-data-detectors],
            #MessageViewBody a {
              color: inherit !important;
              text-decoration: none !important;
            }
          
            p {
              margin: 0;
              line-height: 1.6;
            }
          
            @media (max-width: 520px) {
              .row-content {
                width: 100% !important;
              }
          
              .stack .column {
                display: block;
                width: 100%;
              }
            }
          </style>
        </head>
          
        <body>
          <table
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="background-color: #ffffff"
          >
            <tr>
              <td>
                <table
                  align="center"
                  cellpadding="0"
                  cellspacing="0"
                  width="500"
                  style="margin: auto"
                >
                  <tr>
                    <td style="padding: 30px 10px 10px">
                      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <img src="https://nemo.intellicar.io/nemo3/vehicle/model/img/mahindra_logo.png" alt="Nemo Logo" style="width: 100px;" />
                        <p
                          style="font-size: 29px; font-weight: 600; line-height: 35px"
                        >
                          Password Reset Notification
                        </p>
                      </div>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        Hello <strong>${displayname}</strong>,
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        Your password for the NEMO Platform has been reset by <strong>${resetByDisplayname}</strong>.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        Your new password is: <strong style="background-color: #f0f0f0; padding: 5px 10px; border-radius: 3px; font-family: monospace;">${password}</strong>
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        Please log in with this new password and change it immediately for security purposes.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 13px">
                        If you did not request this password reset, please contact your system administrator immediately.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 18px">
                      <p style="text-align: center; font-size: 13px; color: #000000">
                        Best Regards,<br />
                        Nemo Platform Team<br />
                        <span style="color: #a0a0a0"
                          >Mahindra Last Mile Mobility Ltd.</span
                        >
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>`;

      let emailTemplate = {
        from: {
          name: "Nemo",
          email: "nemo3@intellicar.in",
        },
        to: [
          {
            name: displayname,
            email: email,
          },
        ],
        subject: subject,
        bodycontent: {
          content: [
            {
              type: "text/html",
              value: body,
            },
          ],
        },
      };

      let jsonTemplate = JSON.stringify(emailTemplate);

      return jsonTemplate;
    } catch (error) {
      throw new Error("Failed to generate password reset email template");
    }
  }

  async encryptPassword(password) {
    return await EncryptPassword(password);
  }

  async hashPassword(password) {
    return Sha256hash(password);
  }

  async getMetadataOptions() {
    try {
      // Execute all queries in parallel using Promise.all
      const [
        cityResult,
        dealerResult,
        colourResult,
        fueltypeResult,
        tgu_modelResult,
        tgu_sw_versionResult,
      ] = await Promise.all([
        this.pgPoolI.Query("SELECT citycode, cityname FROM city"),
        this.pgPoolI.Query("SELECT dealercode, dealername FROM dealer"),
        this.pgPoolI.Query("SELECT colorcode, colorname from color"),
        this.pgPoolI.Query("SELECT fueltypecode, fueltypename FROM fueltype"),
        this.pgPoolI.Query(
          "SELECT tgu_model_code, tgu_model_name FROM tgu_model"
        ),
        this.pgPoolI.Query(
          "SELECT tgu_sw_version_code, tgu_sw_version_name FROM tgu_sw_version"
        ),
      ]);

      return {
        city: cityResult.rows.map((row) => ({
          citycode: row.citycode,
          cityname: row.cityname,
        })),
        dealer: dealerResult.rows.map((row) => ({
          dealercode: row.dealercode,
          dealername: row.dealername,
        })),
        colour: colourResult.rows.map((row) => ({
          colorcode: row.colorcode,
          colorname: row.colorname,
        })),
        fueltype: fueltypeResult.rows.map((row) => ({
          fueltypecode: row.fueltypecode,
          fueltypename: row.fueltypename,
        })),
        tgu_model: tgu_modelResult.rows.map((row) => ({
          tgu_model_code: row.tgu_model_code,
          tgu_model_name: row.tgu_model_name,
        })),
        tgu_sw_version: tgu_sw_versionResult.rows.map((row) => ({
          tgu_sw_version_code: row.tgu_sw_version_code,
          tgu_sw_version_name: row.tgu_sw_version_name,
        })),
        gender: [
          { gender_code: "Male", gender_name: "Male" },
          { gender_code: "Female", gender_name: "Female" },
          { gender_code: "Other", gender_name: "Other" },
        ],
      };
    } catch (error) {
      throw new Error("Failed to get vehicle metadata options");
    }
  }

  async addReviewDoneUser(userData) {
    try {
      const currtime = new Date();

      const query = `
        INSERT INTO reviewdoneuser (
          userid,
          displayname,
          usertype,
          mobile,
          email,
          address,
          city,
          country,
          pincode,
          dateofbirth,
          gender,
          vehiclemobile,
          userinfo,
          isenabled,
          isdeleted,
          isemailverified,
          ismobileverified,
          acceptedterms,
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
      `;

      const values = [
        userData.userid,
        userData.displayname,
        userData.usertype || null,
        userData.mobile,
        userData.email,
        userData.address,
        userData.city,
        userData.country,
        userData.pincode,
        userData.dateofbirth,
        userData.gender,
        userData.vehiclemobile,
        userData.userinfo || {},
        userData.isenabled,
        userData.isdeleted,
        userData.isemailverified,
        userData.ismobileverified,
        userData.acceptedterms || {},
        userData.original_input,
        userData.original_status || "APPROVED",
        userData.resolution_reason || "User created successfully",
        userData.review_data || {},
        userData.entrytype || "onboarding",
        currtime, // reviewed_at
        userData.reviewed_by,
        currtime, // createdat
        userData.createdby,
        currtime, // updatedat
        userData.updatedby,
      ];

      const result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to insert review done user");
      }

      return true;
    } catch (error) {
      this.logger.error(`addReviewDoneUser error: ${error}`);
      throw new Error("Unable to add review done user");
    }
  }

  async addReviewPendingUser(userData) {
    const currtime = new Date();
    const query = `
      INSERT INTO reviewpendinguser (
        userid,
        displayname,
        usertype,
        mobile,
        email,
        address,
        city,
        country,
        pincode,
        dateofbirth,
        gender,
        vehiclemobile,
        userinfo,
        isenabled,
        isdeleted,
        isemailverified,
        ismobileverified,
        acceptedterms,
        original_input,
        error_status,
        status,
        reason,
        review_data,
        discard,
        createdat,
        createdby,
        updatedat,
        updatedby
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
    `;
    const values = [
      userData.userid,
      userData.displayname,
      userData.usertype,
      userData.mobile,
      userData.email,
      userData.address,
      userData.city,
      userData.country,
      userData.pincode,
      userData.dateofbirth,
      userData.gender,
      userData.vehiclemobile,
      userData.userinfo,
      userData.isenabled,
      userData.isdeleted,
      userData.isemailverified,
      userData.ismobileverified,
      userData.acceptedterms,
      userData.original_input,
      userData.error_status,
      userData.status,
      userData.reason,
      userData.review_data,
      userData.discard || false, // discard flag
      currtime,
      userData.createdby,
      currtime,
      userData.updatedby,
    ];
    const result = await this.pgPoolI.Query(query, values);
    return result.rowCount === 1;
  }
  catch(error) {
    this.logger.error(`addReviewPendingUser error: ${error}`);
    throw new Error("Unable to add review pending user");
  }

  async addUserInfo(userid, userinfo, createdby) {
    try {
      const currtime = new Date();

      const query = `
        INSERT INTO user_info (
          userid,
          address,
          addresscity,
          addresscountry,
          addresspincode,
          dateofbirth,
          gender,
          createdat,
          createdby,
          updatedat,
          updatedby
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        )
      `;

      const values = [
        userid,
        userinfo.address,
        userinfo.addresscity,
        userinfo.addresscountry,
        userinfo.addresspincode,
        userinfo.dateofbirth,
        userinfo.gender,
        currtime,
        createdby,
        currtime,
        createdby,
      ];

      const result = await this.pgPoolI.Query(query, values);

      if (result.rowCount !== 1) {
        throw new Error("Failed to insert user info");
      }

      return true;
    } catch (error) {
      this.logger.error("Error in addUserInfo:", error);
      throw error;
    }
  }

  async getUserInfo(userid) {
    try {
      const query = `SELECT * FROM user_info WHERE userid = $1`;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in getUserInfo:", error);
      throw error;
    }
  }
  async updateUserInfo(userid, userinfo, updatedby) {
    try {
      const currtime = new Date();

      const fields = Object.keys(userinfo);
      if (fields.length === 0) {
        return null; // No fields to update
      }

      const setClause = fields
        .map((field, index) => `${field} = $${index + 1}`)
        .join(", ");
      const finalSetClause = `${setClause}, updatedat = $${
        fields.length + 1
      }, updatedby = $${fields.length + 2}`;
      const values = [
        ...fields.map((field) => userinfo[field]),
        currtime,
        updatedby,
        userid,
      ];
      const query = `UPDATE user_info SET ${finalSetClause} WHERE userid = $${
        fields.length + 3
      }`;
      const result = await this.pgPoolI.Query(query, values);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in updateUserInfo:", error);
      throw error;
    }
  }

  async getPendingUserReviewById(userid) {
    try {
      const query = `SELECT * FROM reviewpendinguser WHERE userid = $1`;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in getPendingUserReviewById:", error);
      throw error;
    }
  }

  async getPendingUserReviewByUserName(displayname, vin) {
    try {
      const query = `SELECT DISTINCT(userid) FROM reviewpendinguser WHERE displayname = $1 AND original_input->>'vin' = $2`;
      const result = await this.pgPoolI.Query(query, [displayname, vin]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows[0].userid;
    } catch (error) {
      this.logger.error("Error in getPendingUserReviewByUserName:", error);
      throw error;
    }
  }

  async updateReviewPendingUser(userid, updateFields, updatedby) {
    try {
      const currtime = new Date();
      updateFields.updatedat = currtime;
      updateFields.updatedby = updatedby;

      const setClause = Object.keys(updateFields)
        .map((key, index) => `${key} = $${index + 1}`)
        .join(", ");

      const values = [...Object.values(updateFields), userid];
      const query = `UPDATE reviewpendinguser SET ${setClause} WHERE userid = $${values.length}`;

      const result = await this.pgPoolI.Query(query, values);
      return result.rowCount > 0; // Return boolean for success/failure
    } catch (error) {
      this.logger.error("Error in updateReviewPendingUser:", error);
      throw error;
    }
  }

  async deletePendingUserReviewById(userid) {
    try {
      const query = `DELETE FROM reviewpendinguser WHERE userid = $1`;
      const result = await this.pgPoolI.Query(query, [userid]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in deletePendingUserReviewById:", error);
      throw error;
    }
  }
  async checkIsUserAddedToAccount(userid, accountid) {
    try {
      const query = `SELECT * FROM user_fleet WHERE userid = $1 AND accountid = $2`;
      const result = await this.pgPoolI.Query(query, [userid, accountid]);
      // ✅ FIX: Return boolean
      return result.rows.length > 0;
    } catch (error) {
      this.logger.error("Error in checkIsUserAddedToAccount:", error);
      throw error;
    }
  }

  async checkIsVehicleAddedToAccount(vinno) {
    try {
      const query = `SELECT accountid, fleetid FROM fleet_vehicle WHERE vinno = $1 AND isowner = true`;
      const result = await this.pgPoolI.Query(query, [vinno]);
      return result.rows[0];
    } catch (error) {
      this.logger.error("Error in checkIsVehicleAddedToAccount:", error);
      throw error;
    }
  }

  async discardUserReview(createdBy, taskid) {
    try {
      const existingUser = await this.pgPoolI.Query(
        `SELECT * FROM reviewpendinguser WHERE userid = $1`,
        [taskid]
      );
      if (existingUser.rows.length === 0) {
        throw new Error("User review not found");
      }

      const currtime = new Date();

      const query = `
        INSERT INTO reviewdoneuser (
          userid,
          displayname,
          usertype,
          mobile,
          email,
          address,
          city,
          country,
          pincode,
          dateofbirth,
          gender,
          vehiclemobile,
          userinfo,
          isenabled,
          isdeleted,
          isemailverified,
          ismobileverified,
          acceptedterms,
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
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
        )
      `;

      const values = [
        existingUser.rows[0].userid,
        existingUser.rows[0].displayname,
        existingUser.rows[0].usertype || null,
        existingUser.rows[0].mobile,
        existingUser.rows[0].email,
        existingUser.rows[0].address,
        existingUser.rows[0].city,
        existingUser.rows[0].country,
        existingUser.rows[0].pincode,
        existingUser.rows[0].dateofbirth,
        existingUser.rows[0].gender,
        existingUser.rows[0].vehiclemobile,
        existingUser.rows[0].userinfo || {},
        existingUser.rows[0].isenabled,
        existingUser.rows[0].isdeleted,
        existingUser.rows[0].isemailverified,
        existingUser.rows[0].ismobileverified,
        existingUser.rows[0].acceptedterms || {},
        existingUser.rows[0].original_input,
        "REVIEW_DISCARDED_BY_ADMIN",
        "User discarded by admin",
        existingUser.rows[0] || {},
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
        query = `DELETE FROM reviewpendinguser WHERE userid = $1`;
        result = await this.pgPoolI.Query(query, [taskid]);
        if (result.rowCount > 0) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger.error("Error in discardUserReview:", error);
      throw error;
    }
  }

  async listPendingUserReviews() {
    try {
      let query = `SELECT * FROM reviewpendinguser ORDER BY updatedat ASC LIMIT 100`;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to list pending user reviews: ${error.message}`);
    }
  }

  async getUserAccountList(contact, usertype) {
    try {
      if (usertype !== "email" && usertype !== "mobile") {
        throw new Error("Invalid usertype. Must be 'email' or 'mobile'");
      }

      // Validate contact format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      if (usertype === "email" && !emailRegex.test(contact)) {
        throw new Error("Invalid email format");
      }

      if (usertype === "mobile" && !indianMobileRegex.test(contact)) {
        throw new Error(
          "Invalid mobile format. Must be a valid Indian mobile number"
        );
      }

      if (usertype === "email") {
        let query = `
          SELECT uf.accountid, a.accountname FROM user_fleet uf
            JOIN account a ON uf.accountid = a.accountid
            JOIN fleet_tree ft ON uf.fleetid = ft.fleetid
            JOIN email_pwd_sso es ON es.userid = uf.userid
            WHERE es.ssoid = $1 AND a.isenabled = true AND a.isdeleted = false ORDER BY a.accountname
        `;
        let result = await this.pgPoolI.Query(query, [contact]);
        if (result.rowCount > 0) {
          return result.rows;
        }
      } else {
        let query = `
          SELECT uf.accountid, a.accountname FROM user_fleet uf
            JOIN account a ON uf.accountid = a.accountid
            JOIN fleet_tree ft ON uf.fleetid = ft.fleetid
            JOIN mobile_sso ms ON ms.userid = uf.userid
            WHERE ms.ssoid = $1 AND a.isenabled = true AND a.isdeleted = false ORDER BY a.accountname
        `;
        let result = await this.pgPoolI.Query(query, [contact]);
        if (result.rowCount > 0) {
          return result.rows;
        }
      }
    } catch (error) {
      this.logger.error("getUserAccountList error:", error);
      throw new Error("Failed to get user account list");
    }
  }

  async getUserDetailsByMobileOrEmail(mobile, email) {
    try {
      const mobileQuery = `SELECT u.userid, ms.ssoid as mobile, us.ssoid as email, u.displayname, ui.addresspincode
                           FROM users u 
                           JOIN mobile_sso ms ON u.userid = ms.userid 
                           JOIN user_sso us ON u.userid = us.userid and us.ssotype = 'EMAIL_PWD'
                           JOIN user_info ui ON u.userid = ui.userid
                           WHERE ms.ssoid = $1`;
      const mobileResult = await this.pgPoolI.Query(mobileQuery, [mobile]);
      const emailQuery = `SELECT u.userid, eps.ssoid as email, us.ssoid as mobile, u.displayname, ui.addresspincode
                          FROM users u 
                          JOIN email_pwd_sso eps ON u.userid = eps.userid 
                          JOIN user_sso us ON u.userid = us.userid and us.ssotype = 'MOBILE'
                          JOIN user_info ui ON u.userid = ui.userid
                          WHERE eps.ssoid = $1`;
      const emailResult = await this.pgPoolI.Query(emailQuery, [email]);
      if (mobileResult.rowCount > 0 && emailResult.rowCount > 0) {
        const mobileUserAssignedToAccount = await this.pgPoolI.Query(
          `select a.accountname, a.accountid from account a 
          join user_fleet uf on uf.accountid = a.accountid where uf.userid = $1`,
          [mobileResult.rows[0].userid]
        );
        const emailUserAssignedToAccount = await this.pgPoolI.Query(
          `select a.accountname, a.accountid from account a 
          join user_fleet uf on uf.accountid = a.accountid where uf.userid = $1`,
          [emailResult.rows[0].userid]
        );
        return {
          mobileUser: {
            userid: mobileResult.rows[0].userid,
            email: mobileResult.rows[0].email,
            mobile: mobileResult.rows[0].mobile,
            displayname: mobileResult.rows[0].displayname,
            addresspincode: mobileResult.rows[0].addresspincode,
            mobileUserAssignedToAccount: mobileUserAssignedToAccount.rows,
          },
          emailUser: {
            userid: emailResult.rows[0].userid,
            email: emailResult.rows[0].email,
            mobile: emailResult.rows[0].mobile,
            displayname: emailResult.rows[0].displayname,
            addresspincode: emailResult.rows[0].addresspincode,
            emailUserAssignedToAccount: emailUserAssignedToAccount.rows,
          },
        };
      } else if (mobileResult.rowCount > 0 && emailResult.rowCount === 0) {
        const mobileUserAssignedToAccount = await this.pgPoolI.Query(
          `select a.accountname, a.accountid from account a 
          join user_fleet uf on uf.accountid = a.accountid where uf.userid = $1`,
          [mobileResult.rows[0].userid]
        );
        return {
          mobileUser: {
            userid: mobileResult.rows[0].userid,
            email: mobileResult.rows[0].email,
            mobile: mobileResult.rows[0].mobile,
            displayname: mobileResult.rows[0].displayname,
            mobileUserAssignedToAccount: mobileUserAssignedToAccount.rows,
          },
        };
      } else if (mobileResult.rowCount === 0 && emailResult.rowCount > 0) {
        const emailUserAssignedToAccount = await this.pgPoolI.Query(
          `select a.accountname, a.accountid from account a 
          join user_fleet uf on uf.accountid = a.accountid where uf.userid = $1`,
          [emailResult.rows[0].userid]
        );
        return {
          emailUser: {
            userid: emailResult.rows[0].userid,
            email: emailResult.rows[0].email,
            mobile: emailResult.rows[0].mobile,
            addresspincode: emailResult.rows[0].addresspincode,
            displayname: emailResult.rows[0].displayname,
            emailUserAssignedToAccount: emailUserAssignedToAccount.rows,
          },
        };
      } else if (mobileResult.rowCount === 0 && emailResult.rowCount === 0) {
        let error = new Error("User not found");
        error.errcode = "USER_NOT_FOUND";
        error.errdata = {
          mobile: mobile,
          email: email,
        };
        throw error;
      }
    } catch (error) {
      this.logger.error("Error in getUserDetailsByMobileOrEmail:", error);
      throw error;
    }
  }
}
