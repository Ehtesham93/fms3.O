import {
  EMAIL_PWD_SSO,
  FLEET_INVITE_STATUS,
  FLEET_INVITE_TYPE,
  PLATFORM_ACCOUNT_ID,
  MAHINDRA_SSO
} from "../../utils/constant.js";
import { markInviteAsExpired } from "../../utils/inviteUtil.js";

export default class FmsSvcDB {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
  }

  async getUserAccounts(userid) {
    try {
      let query = `
            SELECT distinct uf.accountid, a.accountname, a.accounttype, a.accountinfo, a.isenabled, a.createdat, a.createdby, a.updatedat, a.updatedby, af.fleetid as rootfleetid
            FROM user_fleet uf
            JOIN account a ON uf.accountid = a.accountid AND a.isenabled = true AND a.isdeleted = false
            LEFT JOIN account_fleet af ON uf.accountid = af.accountid AND af.isroot = true
            WHERE uf.userid = $1 AND uf.accountid != $2 ORDER BY a.accountname
        `;
      let result = await this.pgPoolI.Query(query, [
        userid,
        PLATFORM_ACCOUNT_ID,
      ]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve user accounts`);
    }
  }

  async getUserAccountFleets(accountid, userid) {
    try {
      let query = `
            select * from get_all_fleets_path_from_root($1, $2)
        `;

      let result = await this.pgPoolI.Query(query, [accountid, userid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve user accounts fleets`);
    }
  }

  async getAllWebModulesInfo(accountid) {
    try {
      let query = `
            select pm.moduleid, m.modulename, m.moduletype, m.modulecode, m.moduleinfo, m.isenabled, m.createdat, m.createdby, m.updatedat from account_package_subscription aps, package_module pm, module m where aps.pkgid=pm.pkgid and pm.moduleid=m.moduleid and aps.accountid=$1 ORDER BY m.createdat;
        `;
      let result = await this.pgPoolI.Query(query, [accountid]);
      if (result.rowCount === 0) {
        return null;
      }
      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve web modules`);
    }
  }

  async listInvitesOfUser(userid) {
    try {
      let email = null;
      let mobile = null;
      let mahindrasso = null;

      let query = `
            SELECT ssoid FROM user_sso WHERE userid = $1 AND ssotype = $2
        `;
      let result = await this.pgPoolI.Query(query, [userid, EMAIL_PWD_SSO]);
      if (result.rowCount === 1) {
        email = result.rows[0].ssoid;
      } else {
        query = `
            SELECT ssoid FROM email_pwd_sso WHERE userid = $1
        `;
        result = await this.pgPoolI.Query(query, [userid]);
        if (result.rowCount === 1) {
          email = result.rows[0].ssoid;
        }
      }

      query = `
            SELECT ssoid FROM user_sso WHERE userid = $1 AND ssotype = $2
        `;
      result = await this.pgPoolI.Query(query, [userid, MAHINDRA_SSO]);
      if (result.rowCount === 1) {
        mahindrasso = result.rows[0].ssoid;
      } else {
        query = `
            SELECT ssoid FROM mahindra_sso WHERE userid = $1
        `;
        result = await this.pgPoolI.Query(query, [userid]);
        if (result.rowCount === 1) {
          mahindrasso = result.rows[0].ssoid;
        }
      }

      query = `
            SELECT ssoid FROM mobile_sso WHERE userid = $1
        `;
      result = await this.pgPoolI.Query(query, [userid]);
      if (result.rowCount === 1) {
        mobile = result.rows[0].ssoid;
      }

      if (!email && !mobile && !mahindrasso) {
        return null;
      }

      let invitesQuery = `
            SELECT 
                fip.inviteid, fip.accountid, fip.fleetid, 
                fip.contact, fip.roleid, fip.invitetype, fip.invitestatus, 
                fip.createdat as invitedat, u1.displayname as invitedby, fip.updatedat as updatedat, u2.displayname as updatedby,
                a.accountname, ft.name as fleetname,
                fip.expiresat,
                r.rolename
            FROM fleet_invite_pending fip
            JOIN account a ON fip.accountid = a.accountid
            JOIN fleet_tree ft ON fip.accountid = ft.accountid AND fip.fleetid = ft.fleetid
            JOIN roles r ON fip.accountid = r.accountid AND fip.roleid = r.roleid
            LEFT JOIN users u1 ON fip.createdby = u1.userid
            LEFT JOIN users u2 ON fip.updatedby = u2.userid
            WHERE fip.contact = $1 OR fip.contact = $2 OR fip.contact = $3
            
            UNION ALL
            
            SELECT 
                fid.inviteid, fid.accountid, fid.fleetid, 
                fid.contact, fid.roleid, fid.invitetype, fid.invitestatus, 
                fid.createdat as inviteacceptedat, u1.displayname as invitedby, fid.updatedat as updatedat, u2.displayname as updatedby,
                a.accountname, ft.name as fleetname,
                fid.updatedat as expiresat,
                r.rolename
            FROM fleet_invite_done fid
            JOIN account a ON fid.accountid = a.accountid
            JOIN fleet_tree ft ON fid.accountid = ft.accountid AND fid.fleetid = ft.fleetid
            JOIN roles r ON fid.accountid = r.accountid AND fid.roleid = r.roleid
            LEFT JOIN users u1 ON fid.createdby = u1.userid
            LEFT JOIN users u2 ON fid.updatedby = u2.userid
            WHERE fid.contact = $1 OR fid.contact = $2 OR fid.contact = $3
            
            ORDER BY invitedat DESC
        `;

      result = await this.pgPoolI.Query(invitesQuery, [email, mobile, mahindrasso]);

      // Convert the flat result to the expected format with info object
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
        invite.isexternal = false;
        delete invite.contact;
        delete invite.roleid;
        delete invite.rolename;
      }

      return result.rows;
    } catch (error) {
      throw new Error(`Failed to retrieve invites`);
    }
  }

  async validateInvite(inviteid, userid) {
    let currtime = new Date();
    let emailForInvalidReason = "Different email";
    let isdifferentuser = false;

    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      this.logger.error("Failed to start transaction", err);
      return {
        isvalid: false,
        email: emailForInvalidReason,
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
          email: emailForInvalidReason,
          invalidreason: "Invalid invite id",
          isdifferentuser: isdifferentuser,
        };
      }

      let invite = result.rows[0];
      emailForInvalidReason = invite.contact || emailForInvalidReason;
      const inviteemail = invite.contact;

      const mahindrassoemailregex = /^[a-zA-Z0-9._%+-]+@mahindra\.com$/;
      let isuseralreadyexists = false;
      let inviteuserid = null;
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
          email: emailForInvalidReason,
          invalidreason: "Invite is no longer valid state",
          isdifferentuser: isdifferentuser,
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
          email: emailForInvalidReason,
          invalidreason:
            "Invite is not an email invite. currently only email invites are supported",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      const inviteexpiresat = invite.expiresat;

      if (new Date(inviteexpiresat) < currtime) {
        this.logger.info(
          `fmssvc_db.validateInvite: markInviteAsExpired: accountid: ${invite.accountid}, fleetid: ${invite.fleetid}, inviteid: ${invite.inviteid}`
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
          email: emailForInvalidReason,
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
          email: emailForInvalidReason,
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
          email: emailForInvalidReason,
          invalidreason: "Invited fleet not found",
          isdifferentuser: isdifferentuser,
          firstlogin: firstlogin,
        };
      }

      const fleetname = result.rows[0].name;

      let commiterr = await this.pgPoolI.TxCommit(txclient);
      if (commiterr) {
        this.logger.error("Failed to commit transaction", commiterr);
        return {
          isvalid: false,
          email: emailForInvalidReason,
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
        email: emailForInvalidReason,
        invalidreason: "Unknown error",
        isdifferentuser: isdifferentuser,
        firstlogin: firstlogin,
      };
    }
  }
}
