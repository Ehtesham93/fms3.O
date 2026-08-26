import PpUserSvcDB from "./pusersvc_db.js";
import { PLATFORM_ACCOUNT_ID } from "../../../utils/constant.js";

export default class PUserSvc {
  constructor(pgPoolI, logger) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.pUserSvcDB = new PpUserSvcDB(pgPoolI, logger);
  }

  async EmailInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    return await this.pUserSvcDB.triggerEmailInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roleids,
      headerReferer
    );
  }

  async MahindrassoInviteToRootFleet(
    accountid,
    inviteid,
    email,
    invitedby,
    roleids,
    headerReferer
  ) {
    return await this.pUserSvcDB.triggerMahindrassoInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roleids,
      headerReferer
    );
  }
  
  async ResendInvite(accountid, inviteid, invitedby, headerReferer) {
    return await this.pUserSvcDB.resendInvite(
      accountid,
      inviteid,
      invitedby,
      headerReferer
    );
  }

  async GetAllUserRoles(userid) {
    return await this.pUserSvcDB.getAllUserRoles(userid);
  }

  async GetAllRoles(accountid) {
    return await this.pUserSvcDB.getAllRoles(accountid);
  }

  async AddUserPlatformRole(userid, roleids, updatedby) {
    const rootFleetId = await this.pUserSvcDB.getRootFleetId(
      PLATFORM_ACCOUNT_ID
    );
    if (!rootFleetId) {
      throw new Error("Platform account root fleet not found");
    }

    return await this.pUserSvcDB.addUserRole(
      PLATFORM_ACCOUNT_ID,
      rootFleetId,
      userid,
      roleids,
      updatedby
    );
  }

  async RemoveUserPlatformRole(userid, roleid, updatedby) {
    const rootFleetId = await this.pUserSvcDB.getRootFleetId(
      PLATFORM_ACCOUNT_ID
    );
    if (!rootFleetId) {
      throw new Error("Platform account root fleet not found");
    }

    return await this.pUserSvcDB.removeUserRole(
      PLATFORM_ACCOUNT_ID,
      rootFleetId,
      userid,
      roleid,
      updatedby
    );
  }

  async ResetUserPassword(userid, resetby) {
    return await this.pUserSvcDB.resetUserPassword(userid, resetby);
  }

  async CheckSuperAdminRole(userid) {
    return await this.pUserSvcDB.checkSuperAdminRole(userid);
  }

  async ListPendingUsers(searchtext, offset, limit, orderbyfield, orderbydirection, download) {
    return await this.pUserSvcDB.listPendingUsers(searchtext, offset, limit, orderbyfield, orderbydirection, download);
  }

  async ListDoneUsers(searchtext, offset, limit, orderbyfield, orderbydirection, download) {
    return await this.pUserSvcDB.listDoneUsers(searchtext, offset, limit, orderbyfield, orderbydirection, download);
  }
  async AddReviewDoneUser(userData) {
    return await this.pUserSvcDB.addReviewDoneUser(userData);
  }

  async AddReviewPendingUser(userData) {
    return await this.pUserSvcDB.addReviewPendingUser(userData);
  }

  async AddUserInfo(userid, userinfo, createdby) {
    return await this.pUserSvcDB.addUserInfo(userid, userinfo, createdby);
  }

  async GetMetadataOptions() {
    return await this.pUserSvcDB.getMetadataOptions();
  }

  async GetUserInfo(userid) {
    return await this.pUserSvcDB.getUserInfo(userid);
  }

  async GetPendingUserReviewById(userid) {
    return await this.pUserSvcDB.getPendingUserReviewById(userid);
  }

  async GetPendingUserReviewByUserName(displayname, vin) {
    return await this.pUserSvcDB.getPendingUserReviewByUserName(displayname, vin);
  }

  async DeletePendingUserReviewById(userid) {
    return await this.pUserSvcDB.deletePendingUserReviewById(userid);
  }
  async UpdateReviewPendingUser(userid, updateFields, updatedby) {
    return await this.pUserSvcDB.updateReviewPendingUser(
      userid,
      updateFields,
      updatedby
    );
  }

  async UpdateUserInfo(userid, userinfo, updatedby) {
    return await this.pUserSvcDB.updateUserInfo(userid, userinfo, updatedby);
  }

  async checkIsUserAddedToAccount(userid, accountid) {
    return await this.pUserSvcDB.checkIsUserAddedToAccount(userid, accountid);
  }

  async checkIsVehicleAddedToAccount(vinno) {
    return await this.pUserSvcDB.checkIsVehicleAddedToAccount(vinno);
  }

  async DiscardUserReview(createdBy, taskid) {
    return await this.pUserSvcDB.discardUserReview(createdBy, taskid);
  }

  async ListPendingUserReviews() {
    return await this.pUserSvcDB.listPendingUserReviews();
  }

  async GetUserAccountList(contact, usertype) {
    return await this.pUserSvcDB.getUserAccountList(contact, usertype);
  }
  async UserDetailsByErrorCode(mobile, email) {
    return await this.pUserSvcDB.getUserDetailsByMobileOrEmail(mobile, email);
  }
}
