import UserSvcDB from "./usersvc_db.js";
import axios from "axios";
import config from "../../config/config.js";

export default class UserSvc {
  constructor(pgPoolI, config, logger) {
    this.pgPoolI = pgPoolI;
    this.config = config;
    this.logger = logger;
    this.userSvcDB = new UserSvcDB(pgPoolI, config, logger);
  }

  async IsValidUser(userid) {
    let user = await this.userSvcDB.getUserDetails(userid);
    return user && user.userid;
  }

  async getUserName(userid) {
    return await this.userSvcDB.getUserName(userid);
  }

  async CreateSuperAdmin(createdby, userid, email, password) {
    return await this.userSvcDB.createSuperAdmin(
      createdby,
      userid,
      email,
      password
    );
  }

  async GetUserIdByEmail(email) {
    return await this.userSvcDB.getUserIdByEmail(email);
  }

  async GetUserIdPassByEmail(email) {
    return await this.userSvcDB.getUserIdPassByEmail(email);
  }

  async GetUserDetails(userid) {
    return await this.userSvcDB.getUserDetails(userid);
  }

  async GetRolePerms(accountid, fleetid, userid) {
    return await this.userSvcDB.getRolePermsForAccFleet(
      accountid,
      fleetid,
      userid
    );
  }

  async GetConsolePerms(userid) {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    return await this.userSvcDB.getRolePermsForAcc(accountid, userid);
  }

  async IsPlatformUser(userid) {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let roles = await this.userSvcDB.getPlatformUserRoles(accountid, userid);
    return roles && roles.length > 0;
  }

  async GetUserRoles(accountid, fleetid, userid) {
    return await this.userSvcDB.getUserRoles(accountid, fleetid, userid);
  }

  async CreateUser(user, userssoinfo, createdby) {
    return await this.userSvcDB.createUser(user, userssoinfo, createdby);
  }

  async CreateFmsUser(user, userssoinfo, createdby, accountid) {
    return await this.userSvcDB.createFmsUser(
      user,
      userssoinfo,
      createdby,
      accountid
    );
  }

  async AddUserToAccountWithRole(userid, accountid, role, createdbyuserid) {
    return await this.userSvcDB.addUserToAccountWithRole(
      userid,
      accountid,
      role,
      createdbyuserid
    );
  }

  async GetAllUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    return await this.userSvcDB.getAllUsers(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
  }

  async GetPlatformUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    return await this.userSvcDB.getAccountFleetUsers(
      accountid,
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
  }

  async GetAccountUsers(
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) {
    let platformaccountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    return await this.userSvcDB.getNonPlatformUsers(
      platformaccountid,
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
  }

  async GetUserAccounts(userid) {
    return await this.userSvcDB.getUserAccounts(userid);
  }

  async EnableUser(userid, updatedby) {
    return await this.userSvcDB.enableUser(userid, updatedby);
  }

  async DisableUser(userid, updatedby) {
    return await this.userSvcDB.disableUser(userid, updatedby);
  }

  async SignupWithInvite(inviteid, displayname, encryptedpassword, userid) {
    return await this.userSvcDB.signupWithInvite(
      inviteid,
      displayname,
      encryptedpassword,
      userid
    );
  }

  async DeleteUserRecords(userid, accountid, fleetid, inviteid) {
    return await this.userSvcDB.deleteUserRecords(
      userid,
      accountid,
      fleetid,
      inviteid
    );
  }

  async AcceptInvite(inviteid, userid) {
    return await this.userSvcDB.acceptInvite(inviteid, userid);
  }

  async RejectInvite(inviteid, userid) {
    return await this.userSvcDB.rejectInvite(inviteid, userid);
  }

  async AddUserToAccount(addedby, contact, accountid, fleetid, roleids) {
    return await this.userSvcDB.addUserToAccount(
      addedby,
      contact,
      accountid,
      fleetid,
      roleids
    );
  }

  async RemoveUserFromAccount(removedby, contact, accountid) {
    return await this.userSvcDB.removeUserFromAccount(
      removedby,
      contact,
      accountid
    );
  }

  async CreateUserByPlatformAdmin(
    useridtype,
    forceuseridtypeverified,
    contact,
    displayname,
    userinfo,
    createdby
  ) {
    return await this.userSvcDB.createUserByPlatformAdmin(
      useridtype,
      forceuseridtypeverified,
      contact,
      displayname,
      userinfo,
      createdby
    );
  }

  async DeleteUserRecordsByUserid(userid, deletedby) {
    return await this.userSvcDB.deleteUserRecordsByUserid(userid, deletedby);
  }

  async GetUserIdByMobile(mobile) {
    return await this.userSvcDB.getUserIdByMobile(mobile);
  }

  async CreateMobileVerify(verifyid, userid, otp, expiresat, info) {
    return await this.userSvcDB.createMobileVerify(
      verifyid,
      userid,
      otp,
      expiresat,
      info
    );
  }

  async VerifyMobileOtp(mobile, otp) {
    const otpVerifyUrl = `${config.mobileotpsvc.rooturl}${config.mobileotpsvc.verifyotppath}`;
    const otpVerifyHeaders = {
      "Content-Type": "application/json",
    };
    const otpVerifyBody = {
      mobilenumber: mobile,
      otp: otp,
    };

    let verifyRes;
    try {
      verifyRes = await axios.post(otpVerifyUrl, otpVerifyBody, {
        headers: otpVerifyHeaders,
      });
    } catch (err) {
      try {
        const errorResponse = err.response?.data;

        if (errorResponse?.data?.errcode && errorResponse?.data?.errmsg) {
          const { errcode, errmsg } = errorResponse.data;
          throw new Error(`${errcode}: ${errmsg}`);
        } else if (errorResponse?.errcode && errorResponse?.errmsg) {
          const { errcode, errmsg } = errorResponse;
          throw new Error(`${errcode}: ${errmsg}`);
        } else {
          throw new Error(
            "OTP verification failed: " + (err.message || "Unknown error")
          );
        }
      } catch (parseError) {
        throw new Error(
          "OTP verification failed: " + (err.message || "Unknown error")
        );
      }
    }

    if (
      !verifyRes.data ||
      verifyRes.data.err !== null ||
      verifyRes.data.msg !== "OTP verified successfully"
    ) {
      throw new Error("INVALID_OTP");
    }

    return verifyRes;
  }

  async SetUserDefaults(userid, accountid, recursive, lat, lng, mapzoom) {
    return await this.userSvcDB.setUserDefaults(
      userid,
      accountid,
      recursive,
      lat,
      lng,
      mapzoom
    );
  }

  async GetUserInfo(userid) {
    return await this.userSvcDB.getUserInfo(userid);
  }

  async CreatePasswordResetToken(userid, resetToken, expiresAt, email) {
    return await this.userSvcDB.createPasswordResetToken(
      userid,
      resetToken,
      expiresAt,
      email
    );
  }

  async ValidatePasswordResetToken(resetToken) {
    return await this.userSvcDB.validatePasswordResetToken(resetToken);
  }

  async ResetPasswordWithToken(resetToken, newPassword) {
    return await this.userSvcDB.resetPasswordWithToken(resetToken, newPassword);
  }

  async AddPendingEmail(emailTemplate, nextAttempt, nRetriesPending) {
    return await this.userSvcDB.addPendingEmail(
      emailTemplate,
      nextAttempt,
      nRetriesPending
    );
  }

  async DeleteUser(userid, deletedby) {
    return await this.userSvcDB.deleteUser(userid, deletedby);
  }

  async RecoverUser(userid, recoveredby) {
    return await this.userSvcDB.recoverUser(userid, recoveredby);
  }

  async CheckMobileExists(mobile) {
    return await this.userSvcDB.checkMobileExists(mobile);
  }

  async CheckUserHasMobile(userid) {
    return await this.userSvcDB.checkUserHasMobile(userid);
  }

  async VerifyAndAddMobile(userid, otp, mobile) {
    const otpVerifyUrl = `${config.mobileotpsvc.rooturl}${config.mobileotpsvc.verifyotppath}`;
    const otpVerifyHeaders = {
      "Content-Type": "application/json",
    };
    const otpVerifyBody = {
      mobilenumber: mobile,
      otp: otp,
    };

    let verifyRes;
    try {
      verifyRes = await axios.post(otpVerifyUrl, otpVerifyBody, {
        headers: otpVerifyHeaders,
      });
    } catch (err) {
      try {
        const errorResponse = err.response?.data;

        if (errorResponse?.data?.errcode && errorResponse?.data?.errmsg) {
          const { errcode, errmsg } = errorResponse.data;
          throw new Error(`${errcode}: ${errmsg}`);
        } else if (errorResponse?.errcode && errorResponse?.errmsg) {
          const { errcode, errmsg } = errorResponse;
          throw new Error(`${errcode}: ${errmsg}`);
        } else {
          throw new Error(
            "OTP verification failed: " + (err.message || "Unknown error")
          );
        }
      } catch (parseError) {
        throw new Error(
          "OTP verification failed: " + (err.message || "Unknown error")
        );
      }
    }

    if (
      !verifyRes.data ||
      verifyRes.data.err !== null ||
      verifyRes.data.msg !== "OTP verified successfully"
    ) {
      const error = new Error("INVALID_OTP");
      error.errcode = "INVALID_OTP";
      throw error;
    }

    return await this.userSvcDB.verifyAndAddMobile(userid, otp, mobile);
  }

  async CreateEmailVerify(verifyid, userid, email, expiresat) {
    return await this.userSvcDB.createEmailVerify(
      verifyid,
      userid,
      email,
      expiresat
    );
  }

  async VerifyAndAddEmail(userid, verifyid, password) {
    return await this.userSvcDB.verifyAndAddEmail(userid, verifyid, password);
  }

  async CheckEmailExists(email) {
    return await this.userSvcDB.checkEmailExists(email);
  }

  async CheckUserHasEmail(userid) {
    return await this.userSvcDB.checkUserHasEmail(userid);
  }

  async UpdateDisplayName(userid, displayname) {
    return await this.userSvcDB.updateDisplayName(userid, displayname);
  }

  async ValidateEmailVerification(userid, verifyid) {
    return await this.userSvcDB.validateEmailVerification(userid, verifyid);
  }

  async GetAcceptedTerms(userid) {
    return await this.userSvcDB.getAcceptedTerms(userid);
  }

  async PutAcceptedTerms(userid, acceptedterms) {
    return await this.userSvcDB.putAcceptedTerms(userid, acceptedterms);
  }

  async GetSosContacts() {
    return await this.userSvcDB.getSosContacts();
  }

  async SetMpin(userid, encryptedMpin, isenabled) {
    return await this.userSvcDB.setMpin(userid, encryptedMpin, isenabled);
  }

  async GetUserMpin(userid) {
    return await this.userSvcDB.getUserMpin(userid);
  }

  async GetDocuments() {
    return await this.userSvcDB.getDocuments();
  }

  async GetBanners(category) {
    return await this.userSvcDB.getBanners(category);
  }

  async UpdatePasswordWithExpiry(userid, newPassword) {
    return await this.userSvcDB.updatePasswordWithExpiry(userid, newPassword);
  }

  // ==========================================
  // Feedback / Rating Feature - Service Layer
  // New Redis + PostgreSQL scheduling model
  // ==========================================

  async GetLatestRatingFeedback(userid, appName) {
    return await this.userSvcDB.getLatestRatingFeedback(userid, appName);
  }

  async GetLatestRatingFeedbackSchedule(userid, appName) {
    return await this.userSvcDB.getLatestRatingFeedbackSchedule(userid, appName);
  }

  async AddUserFeedback(data) {
    return await this.userSvcDB.addUserFeedback(data);
  }

  async GetRatingPromptCache(cacheKey) {
    return await this.userSvcDB.getRatingPromptCache(cacheKey);
  }

  async SetRatingPromptCache(cacheKey, value, ttlSeconds) {
    return await this.userSvcDB.setRatingPromptCache(
      cacheKey,
      value,
      ttlSeconds
    );
  }

  async DeleteRatingPromptCache(cacheKey) {
    return await this.userSvcDB.deleteRatingPromptCache(cacheKey);
  }

  async CheckUserLoginSecurity(userid) {
    return await this.userSvcDB.checkUserLoginSecurity(userid);
  }

  async UpdateLoginSuccess(userid) {
    return await this.userSvcDB.updateLoginSuccess(userid);
  }

  async UpdateLoginFailure(userid) {
    return await this.userSvcDB.updateLoginFailure(userid);
  }

  async IsUserLocked(userid) {
    return await this.userSvcDB.isUserLocked(userid);
  }

  async UnlockUser(userid) {
    return await this.userSvcDB.unlockUser(userid);
  }

  async LogLoginAttempt(
    userid,
    ssotype,
    loginattempt,
    failurereason = null,
    ipaddress = null,
    useragent = null,
    devicefingerprint = null
  ) {
    return await this.userSvcDB.logLoginAttempt(
      userid,
      ssotype,
      loginattempt,
      failurereason,
      ipaddress,
      useragent,
      devicefingerprint
    );
  }

  async GetUserLoginAuditHistory(userid, limit = 50) {
    return await this.userSvcDB.getUserLoginAuditHistory(userid, limit);
  }

  async GetFailedLoginsBySSO(ssotype, hoursBack = 24) {
    return await this.userSvcDB.getFailedLoginsBySSO(ssotype, hoursBack);
  }

  async UpdateUser(userid, updateFields, updatedby) {
    return await this.userSvcDB.updateUser(userid, updateFields, updatedby);
  }

  async GetUserIdPassByMahindrassoEmail(email) {
    return await this.userSvcDB.getUserIdPassByMahindrassoEmail(email);
  }

  async GetUserIdByMahindrassoEmail(email) {
    return await this.userSvcDB.getUserIdByMahindrassoEmail(email);
  }

  async UpdateMahindrassoEmail(userid, email, column) {
    return await this.userSvcDB.updateMahindrassoEmail(userid, email, column);
  }

  async CheckForMahindraSsoUser(userid) {
    return await this.userSvcDB.checkForMahindraSsoUser(userid);
  }

  async CheckForPendingInvite(email, inviteid) {
    return await this.userSvcDB.checkForPendingInvite(email, inviteid);
  }

  async AcceptInviteForMahindraSsoFirstLogin(userid, inviteid) {
    return await this.userSvcDB.acceptInviteForMahindraSsoFirstLogin(
      userid,
      inviteid
    );
  }
}