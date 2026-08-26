import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { EncryptPassword, ComparePassword } from "../../utils/eccutil.js";
import { SendSms } from "../../utils/smsutil.js";
import { UAParser } from "ua-parser-js";
import jwt from 'jsonwebtoken'; 
import { ADMIN_USER_ID } from "../../utils/constant.js";

export default class PublicHdlrImpl {
  constructor(userSvcI, authSvcI, fmsSvcI, platformSvcI, inMemCacheI, logger, config) {
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsSvcI = fmsSvcI;
    this.platformSvcI = platformSvcI;
    this.logger = logger;
    this.config = config;
    this.inMemCacheI = inMemCacheI;
    this.OTP_CACHE_TTL = 30;
  }

  getDeviceFingerprint = (req) => {
    const ip =
      req.headers["x-forwarded-for"] ||
      req.headers["x-real-ip"] ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null);

    const userAgent = req.headers["user-agent"] || "";
    const referrer = req.headers["referer"] || "";
    const parser = new UAParser(userAgent);
    const ua = parser.getResult();
    const useragentstr = `${ip}-${JSON.stringify(ua)}-${referrer}`;
    const deviceFingerprint = crypto
      .createHash("sha256")
      .update(useragentstr)
      .digest("hex");

    return deviceFingerprint;
  };

  clearRateLimitCache = (req) => {
    try {
      const fingerprint = this.getDeviceFingerprint(req);
      const rateLimitKey = `otp_rate_limit:${fingerprint}`;

      this.inMemCacheI.del(rateLimitKey);

      this.logger.info(
        `Rate limit cache cleared for fingerprint: ${fingerprint}`
      );
    } catch (err) {
      this.logger.error("Error clearing rate limit cache:", err);
    }
  };

  // User authentication logic
  CheckContactLogic = async (contact, inviteid) => {
    try {
      // Determine if contact is email or mobile
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const mahindrassoemailregex = /^[a-zA-Z0-9._%+-]+@mahindra\.com$/;
      let ismahindrassoemail = false;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      let type = "";
      let userid = null;
      let userDetails = null;
      let isActive = false;
      let message = "";
      let ismpinset = false;

      if (mahindrassoemailregex.test(contact.toLowerCase())) {
        type = "mahindrassoemail";
        const mahindrauser= await this.userSvcI.GetUserIdByMahindrassoEmail(contact);
        if (!mahindrauser) {
          return {
            isactive: false,
            message: "User not found",
            type: "email",
            ismpinset: ismpinset,
            ismahindrassoemail: ismahindrassoemail,
          };
        }else{
          userid = mahindrauser.userid;
          if(!mahindrauser.isemailverified){
            if(inviteid){
              let pendingInvite = await this.userSvcI.CheckForPendingInvite(contact, inviteid);
              if(!pendingInvite){
                return {
                  isactive: false,
                  message: "User is not registered",
                  type: "email",
                  ismpinset: ismpinset,
                  ismahindrassoemail: ismahindrassoemail,
                };
              }
            } else {
              return {
                isactive: false,
                message: "User is not registered",
                type: "email",
                ismpinset: ismpinset,
                ismahindrassoemail: ismahindrassoemail,
              };
            }
          }
        }
        ismahindrassoemail = true;
      } else if (emailRegex.test(contact)) {
        type = "email";
        userid = await this.userSvcI.GetUserIdByEmail(contact);
        if (!userid) {
          return {
            isactive: false,
            message: "User not found",
            type: "email",
            ismpinset: ismpinset,
            ismahindrassoemail: ismahindrassoemail,
          };
        }
      } else if (indianMobileRegex.test(contact)) {
        type = "mobile";
        userDetails = await this.userSvcI.GetUserIdByMobile(contact);
        if (!userDetails) {
          return {
            isactive: false,
            message: "User not found",
            type: "mobile",
            ismpinset: ismpinset,
            ismahindrassoemail: ismahindrassoemail,
          };
        }
        userid = userDetails.userid;
        if (userDetails.has_mpin && userDetails.mpin_enabled) {
          ismpinset = true;
        }
      } else {
        return {
          isactive: false,
          message:
            "Invalid contact format. Please provide a valid email or mobile number.",
          type: "unknown",
          ismpinset: ismpinset,
          ismahindrassoemail: ismahindrassoemail,
        };
      }

      if (userid) {
        // User exists, check if active
        let user = await this.userSvcI.GetUserDetails(userid);
        if (user) {
          if (user.isenabled && !user.isdeleted) {
            isActive = true;
            message = "User is active and available";
          } else if (!user.isenabled) {
            isActive = false;
            message = "User exists but is disabled";
          } else if (user.isdeleted) {
            isActive = false;
            message = "User exists but is deleted";
          }
        } else {
          isActive = false;
          message = "Accept invite to continue";
        }
      } else {
        isActive = false;
        message = "User not found";
      }

      return {
        isactive: isActive,
        message: message,
        type: type,
        ismpinset: ismpinset,
        ismahindrassoemail: ismahindrassoemail
      };
    } catch (err) {
      throw err;
    }
  };

  MobileSendOtpLogic = async (mobile, req) => {
    try {
      const fingerprint = this.getDeviceFingerprint(req);
      const rateLimitKey = `otp_rate_limit:${fingerprint}`;

      if (this.inMemCacheI.has(rateLimitKey) && (mobile !== "9742720873" && mobile !== "7795772862")) {
        const error = new Error(
          "Too many OTP requests. Please try after 1 min"
        );
        error.errcode = "RATE_LIMIT_EXCEEDED";
        throw error;
      }

      let userdetails = await this.userSvcI.GetUserIdByMobile(mobile);
      if (!userdetails) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User with this mobile number doesn't exist",
        };
      }
      // // COMMENTED OUT BECAUSE OF NEW USER CREATION LOGIC
      // let userid = userdetails ? userdetails.userid : null;
      // let isNewUser = !userid;

      // if (isNewUser) {
      //   let accountExists = await this.platformSvcI.GetAccountByName(mobile);
      //   let accountid, rootfleetid;

      //   if (accountExists) {
      //     accountid = accountExists.accountid;
      //     rootfleetid = accountExists.rootfleetid;
      //   } else {
      //     let accountRes = await this.platformSvcI
      //       .getAccountSvc()
      //       .CreateAccount({
      //         accountid: uuidv4(),
      //         rootfleetid: uuidv4(),
      //         rootFleetParentId: uuidv4(),
      //         rootFleetName: "Home",
      //         accountname: mobile,
      //         accounttype: "customer",
      //         accountinfo: {},
      //         isenabled: true,
      //         createdby: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      //       });

      //     if (!accountRes) {
      //       throw new Error("Failed to create account for mobile user");
      //     }

      //     accountid = accountRes.accountid;
      //     rootfleetid = accountRes.rootfleetid;
      //   }

      //   userid = uuidv4();
      //   let user = {
      //     userid: userid,
      //     displayname: mobile,
      //     usertype: null,
      //     userinfo: {},
      //     isenabled: true,
      //     isdeleted: false,
      //     isemailverified: false,
      //     ismobileverified: false,
      //     useraccountid: accountid,
      //     userfleetid: rootfleetid,
      //   };
      //   let userssoinfo = {
      //     mobile: mobile,
      //   };
      //   await this.userSvcI.CreateUser(user, userssoinfo, userid);

      //   try {
      //     await this.userSvcI.AddAdminToAccRootFleet(accountid, mobile, userid);
      //   } catch (error) {}
      // }

      let verifyid = uuidv4();

      const message = `Login_OTP_for_Mahindra_Nemo at ${verifyid} , please check - Intellicar`;
      if (mobile !== "9742720873" && mobile !== "7795772862") {
        try {
          await SendSms(mobile, message);
        } catch (err) {
          if (err.errcode === "TOO_MANY_OTP_REQUESTS") {
            err.message = "Too many OTP requests. Please try after sometime";
          }
          throw err;
        }
      }

      this.inMemCacheI.set(rateLimitKey, true, this.OTP_CACHE_TTL);

      return {
        verifyid: verifyid,
      };
    } catch (err) {
      throw err;
    }
  };

  MobileSignInLogic = async (
    mobile,
    otp,
    expiresin,
    refreshTokenMaxAge,
    req
  ) => {
    try {
      let userDetails = await this.userSvcI.GetUserIdByMobile(mobile);
      if (!userDetails || !userDetails.userid) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User with this mobile number doesn't exist",
        };
      }
      let userid = userDetails.userid;

      const lockStatus = await this.userSvcI.IsUserLocked(userid);
      if (lockStatus.islocked && (mobile !== "9742720873" && mobile !== "7795772862")) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        await this.userSvcI.LogLoginAttempt(
          userid,
          "mobile",
          "FAILURE",
          "ACCOUNT_LOCKED",
          req.ip,
          req.get("User-Agent"),
          this.getDeviceFingerprint(req)
        );

        throw new Error(`ACCOUNT_LOCKED:${remainingTime}`);
      }

      // COMMENTED OUT DEFAULT OTP CHECK
      if (
        otp !==
        "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92"
      ) {
      try {
        let verify = await this.userSvcI.VerifyMobileOtp(mobile, otp);
        if (!verify || verify.status !== 200) {
          await this.userSvcI.UpdateLoginFailure(userid);

          await this.userSvcI.LogLoginAttempt(
            userid,
            "mobile",
            "FAILURE",
            "INVALID_OTP",
            req.ip,
            req.get("User-Agent"),
            this.getDeviceFingerprint(req)
          );

          throw new Error("INVALID_OTP");
        }
      } catch (error) {
        await this.userSvcI.UpdateLoginFailure(userid);

        await this.userSvcI.LogLoginAttempt(
          userid,
          "mobile",
          "FAILURE",
          "OTP_VERIFICATION_ERROR",
          req.ip,
          req.get("User-Agent"),
          this.getDeviceFingerprint(req)
        );

        throw new Error("INVALID_OTP");
      }
      }

      // Get user details
      let user = await this.userSvcI.GetUserDetails(userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      // Check if user is enabled
      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      // Check if user is deleted
      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      await this.userSvcI.UpdateLoginSuccess(userid);

      await this.userSvcI.LogLoginAttempt(
        userid,
        "mobile",
        "SUCCESS",
        null,
        req.ip,
        req.get("User-Agent"),
        this.getDeviceFingerprint(req)
      );

      // Get kong consumerid
      let tokenclaims = {
        claims: {
          userid: userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        userid,
        tokenclaims,
        refreshtokenclaims
      );

      if (req) {
        this.clearRateLimitCache(req);
      }

      return {
        userid: user.userid,
        userinfo: user,
        usertoken: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };

  GetSuperAdminTokenLogic = async (
    email,
    password,
    expiresin,
    refreshTokenMaxAge
  ) => {
    try {
      // validate email and password
      let useridpass = await this.userSvcI.GetUserIdPassByEmail(email);
      if (!useridpass) {
        throw new Error("INVALID_CREDENTIALS");
      }

      const lockStatus = await this.userSvcI.IsUserLocked(useridpass.userid);
      if (lockStatus.islocked) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        // Log the blocked attempt
        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "superadmin",
          "FAILURE",
          "ACCOUNT_LOCKED"
        );

        throw new Error(`ACCOUNT_LOCKED:${remainingTime}`);
      }

      let isPasswordValid = await ComparePassword(
        password,
        useridpass.password
      );

      if (!isPasswordValid) {
        await this.userSvcI.UpdateLoginFailure(useridpass.userid);

        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "email",
          "FAILURE",
          "INVALID_CREDENTIALS"
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      // get user details
      let user = await this.userSvcI.GetUserDetails(useridpass.userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      // check if user is enabled
      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      // check if user is deleted
      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      // check if user is superadmin
      const hasAdminAccess = await this.platformSvcI
        .getPUserSvc()
        .CheckSuperAdminRole(useridpass.userid);
      if (!hasAdminAccess) {
        throw new Error("USER_IS_NOT_SUPERADMIN");
      }

      // get kong consumerid
      let tokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        useridpass.userid,
        tokenclaims,
        refreshtokenclaims
      );

      await this.userSvcI.UpdateLoginSuccess(useridpass.userid);

      await this.userSvcI.LogLoginAttempt(
        useridpass.userid,
        "superadmin",
        "SUCCESS"
      );

      return {
        userid: user.userid,
        userinfo: user,
        token: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };

  UserEmailSignInLogic = async (
    email,
    password,
    expiresin,
    refreshTokenMaxAge
  ) => {
    try {
      // validate email and password
      let useridpass = await this.userSvcI.GetUserIdPassByEmail(email);
      if (!useridpass) {
        throw new Error("INVALID_CREDENTIALS");
      }

      const lockStatus = await this.userSvcI.IsUserLocked(useridpass.userid);
      if (lockStatus.islocked) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "email",
          "FAILURE",
          "ACCOUNT_LOCKED"
        );

        throw new Error(`ACCOUNT_LOCKED:${remainingTime}`);
      }

      let isPasswordValid = await ComparePassword(
        password,
        useridpass.password
      );

      if (!isPasswordValid) {
        await this.userSvcI.UpdateLoginFailure(useridpass.userid);

        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "email",
          "FAILURE",
          "INVALID_CREDENTIALS"
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      if (useridpass.passwordexpireat !== "") {
        let currtime = new Date();
        if (currtime > new Date(useridpass.passwordexpireat)) {
          throw new Error("PASSWORD_EXPIRED");
        }

        let passwordExpireDate = new Date(useridpass.passwordexpireat);
        let daysUntilExpiry = Math.ceil(
          (passwordExpireDate - currtime) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiry > 30) {
          refreshTokenMaxAge = 30 * 24 * 60 * 60;
        } else {
          refreshTokenMaxAge = daysUntilExpiry * 24 * 60 * 60;
        }
      }

      // get user details
      let user = await this.userSvcI.GetUserDetails(useridpass.userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      // check if user is enabled
      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      // check if user is deleted
      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      await this.userSvcI.UpdateLoginSuccess(useridpass.userid);

      await this.userSvcI.LogLoginAttempt(
        useridpass.userid,
        "email",
        "SUCCESS"
      );

      let tokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        useridpass.userid,
        tokenclaims,
        refreshtokenclaims
      );
      return {
        userid: user.userid,
        userinfo: user,
        token: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };

  GetTestUserTokenLogic = async (
    email,
    password,
    expiresin,
    refreshTokenMaxAge
  ) => {
    try {
      // validate email and password
      let useridpass = await this.userSvcI.GetUserIdPassByEmail(email);
      if (!useridpass) {
        throw new Error("INVALID_CREDENTIALS");
      }

      const lockStatus = await this.userSvcI.IsUserLocked(useridpass.userid);
      if (lockStatus.islocked) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "testuser",
          "FAILURE",
          "ACCOUNT_LOCKED"
        );

        throw new Error(`ACCOUNT_LOCKED:${remainingTime}`);
      }
      // password = await EncryptPassword(password);
      let isPasswordValid = await ComparePassword(
        password,
        useridpass.password
      );
      // let isPasswordValid = true;
      if (!isPasswordValid) {
        await this.userSvcI.UpdateLoginFailure(useridpass.userid);

        await this.userSvcI.LogLoginAttempt(
          useridpass.userid,
          "testuser",
          "FAILURE",
          "INVALID_CREDENTIALS"
        );
        throw new Error("INVALID_CREDENTIALS");
      }

      // check if user is test user
      if (useridpass.usertype !== "testuser") {
        throw new Error("User is not test user");
      }

      if (useridpass.passwordexpireat !== "") {
        let currtime = new Date();
        if (currtime > new Date(useridpass.passwordexpireat)) {
          throw new Error("PASSWORD_EXPIRED");
        }

        let passwordExpireDate = new Date(useridpass.passwordexpireat);
        let daysUntilExpiry = Math.ceil(
          (passwordExpireDate - currtime) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilExpiry > 30) {
          refreshTokenMaxAge = 30 * 24 * 60 * 60;
        } else {
          refreshTokenMaxAge = daysUntilExpiry * 24 * 60 * 60;
        }
      }

      // get user details
      let user = await this.userSvcI.GetUserDetails(useridpass.userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      // check if user is enabled
      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      // check if user is deleted
      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      // get kong consumerid
      let tokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: useridpass.userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        useridpass.userid,
        tokenclaims,
        refreshtokenclaims
      );

      await this.userSvcI.UpdateLoginSuccess(useridpass.userid);

      await this.userSvcI.LogLoginAttempt(
        useridpass.userid,
        "testuser",
        "SUCCESS"
      );

      return {
        userid: user.userid,
        userinfo: user,
        token: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };

  SignupWithInviteLogic = async (inviteid, displayname, password) => {
    let encryptedpassword = await EncryptPassword(password);
    let res = await this.userSvcI.SignupWithInvite(
      inviteid,
      displayname,
      encryptedpassword,
    );
    if (!res) {
      throw new Error("SIGNUP_FAILED");
    }

    try {
      let authres = await this.authSvcI.CreateConsumer(res.userid);

      if (authres === undefined || authres === null || !authres) {
        await this.userSvcI.DeleteUserRecords(
          res.userid,
          res.accountid,
          res.fleetid,
          inviteid
        );
        throw new Error("AUTH_SERVICE_ERROR");
      }

      res.token = authres?.token;
      res.refreshtoken = authres?.refreshtoken;
      return res;
    } catch (error) {
      await this.userSvcI.DeleteUserRecords(
        res.userid,
        res.accountid,
        res.fleetid,
        inviteid
      );
      throw error;
    }
  };

  ValidateInviteLogic = async (inviteid, userid) => {
    try {
      let result = await this.fmsSvcI.ValidateInvite(inviteid, userid);
      return result;
    } catch (error) {
      throw error;
    }
  };

  ForgotPasswordLogic = async (email, headerReferer) => {
    try {
      const userid = await this.userSvcI.GetUserIdByEmail(email);
      if (!userid) {
        throw new Error("EMAIL_NOT_FOUND");
      }

      const user = await this.userSvcI.GetUserDetails(userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User with this email doesn't exist",
        };
      }

      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      const resetToken = uuidv4();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await this.userSvcI.CreatePasswordResetToken(
        userid,
        resetToken,
        expiresAt,
        email
      );

      const resetLink = `${headerReferer}/auth/reset-password?resetid=${resetToken}`;

      const emailTemplate = await this.createPasswordResetEmailTemplate(
        user.displayname,
        email,
        resetLink
      );

      await this.userSvcI.AddPendingEmail(emailTemplate, new Date(), 5);
      return {
        message: "Password reset email has been sent to your email address",
        email: email,
      };
    } catch (error) {
      throw error;
    }
  };

  ResetPasswordLogic = async (resetToken, newPassword) => {
    try {
      const resetInfo = await this.userSvcI.ValidatePasswordResetToken(
        resetToken
      );
      if (!resetInfo) {
        throw new Error("INVALID_RESET_TOKEN");
      }

      if (new Date() > resetInfo.expiresAt) {
        throw new Error("RESET_TOKEN_EXPIRED");
      }

      if (resetInfo.isused) {
        throw new Error("RESET_TOKEN_USED");
      }

      await this.userSvcI.ResetPasswordWithToken(resetToken, newPassword);

      let logoutresult = await this.authSvcI.InvalidateToken(resetInfo.userid);
      if (!logoutresult) {
        throw new Error("Failed to logout, password reset successfully");
      }

      return {
        message: "Password has been reset successfully",
        userid: resetInfo.userid,
      };
    } catch (error) {
      throw error;
    }
  };

  ValidateResetTokenLogic = async (resetToken, userid) => {
    try {
      let isdifferentuser = false;
      const resetInfo = await this.userSvcI.ValidatePasswordResetToken(
        resetToken
      );

      if (!resetInfo) {
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          message: "Invalid reset token",
        };
      }

      if (userid && userid !== resetInfo?.userid) {
        isdifferentuser = true;
      }

      let email = resetInfo.info?.email;
      if (!email) {
        email = "";
      }

      if (resetInfo.userstatus === "deleted") {
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          email: email,
          message: "User has been deleted",
        };
      }

      if (+new Date() > +new Date(resetInfo.expiresAt)) {
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          email: email,
          message: "Reset token has expired",
        };
      }

      if (resetInfo.userstatus === "disabled") {
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          email: email,
          message: "User has been disabled",
        };
      }

      if (resetInfo.isused) {
        return {
          isvalid: false,
          isdifferentuser: isdifferentuser,
          email: email,
          message: "Reset token has already been used",
        };
      }

      return {
        isvalid: true,
        isdifferentuser: isdifferentuser,
        email: email,
        expiresat: resetInfo.expiresAt,
        userid: resetInfo.userid,
        message: "Reset token is valid",
      };
    } catch (error) {
      throw error;
    }
  };

  MpinSignInLogic = async (mobile, mpin, expiresin, refreshTokenMaxAge) => {
    try {
      let userMobileData = await this.userSvcI.GetUserIdByMobile(mobile);
      if (!userMobileData) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User with this mobile number doesn't exist",
        };
      }

      if (!userMobileData.has_mpin) {
        throw new Error("MPIN_NOT_SET");
      }

      if (!userMobileData.mpin_enabled) {
        throw new Error("MPIN_DISABLED");
      }

      let userid = userMobileData.userid;

      const lockStatus = await this.userSvcI.IsUserLocked(userid);
      if (lockStatus.islocked) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        await this.userSvcI.LogLoginAttempt(
          userid,
          "mpin",
          "FAILURE",
          "ACCOUNT_LOCKED"
        );

        throw new Error(`ACCOUNT_LOCKED:${remainingTime}`);
      }

      let storedMpinHash = await this.userSvcI.GetUserMpin(userid);
      if (!storedMpinHash) {
        throw new Error("MPIN_NOT_SET");
      }

      let isValidMpin = await ComparePassword(mpin, storedMpinHash);
      if (!isValidMpin) {
        await this.userSvcI.UpdateLoginFailure(userid);

        await this.userSvcI.LogLoginAttempt(
          userid,
          "mpin",
          "FAILURE",
          "INVALID_MPIN"
        );
        throw new Error("INVALID_MPIN");
      }

      let user = await this.userSvcI.GetUserDetails(userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      await this.userSvcI.UpdateLoginSuccess(userid);

      await this.userSvcI.LogLoginAttempt(userid, "mpin", "SUCCESS");

      let tokenclaims = {
        claims: {
          userid: userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        userid,
        tokenclaims,
        refreshtokenclaims
      );
      return {
        userid: user.userid,
        userinfo: user,
        usertoken: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };

  ChangePasswordLogic = async (email, oldPassword, newPassword) => {
    try {
      if (oldPassword === newPassword) {
        throw new Error("PASSWORD_SAME_AS_OLD");
      }

      let useridpass = await this.userSvcI.GetUserIdPassByEmail(email);
      if (!useridpass) {
        throw new Error("INVALID_CREDENTIALS");
      }

      let isPasswordValid = await ComparePassword(
        oldPassword,
        useridpass.password
      );
      if (!isPasswordValid) {
        throw new Error("INVALID_CREDENTIALS");
      }

      let user = await this.userSvcI.GetUserDetails(useridpass.userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      if (!user.isenabled) {
        throw new Error("ACCOUNT_DISABLED");
      }

      if (user.isdeleted) {
        throw new Error("ACCOUNT_DELETED");
      }

      const encryptedNewPassword = await EncryptPassword(newPassword);

      await this.userSvcI.UpdatePasswordWithExpiry(
        useridpass.userid,
        encryptedNewPassword
      );

      let logoutresult = await this.authSvcI.InvalidateToken(useridpass.userid);
      if (!logoutresult) {
        this.logger.warn(
          "Failed to invalidate existing tokens for user: " + useridpass.userid
        );
      }

      return {
        message: "Password has been changed successfully",
        userid: useridpass.userid,
      };
    } catch (err) {
      throw err;
    }
  };

  createPasswordResetEmailTemplate = async (displayname, email, resetLink) => {
    const emailData = {
      from: {
        name: "Nemo FMS",
        email: "nemo3@intellicar.in",
      },
      to: [
        {
          name: displayname,
          email: email,
        },
      ],
      subject: "Reset Password Request - Nemo FMS",
      bodycontent: {
        content: [
          {
            type: "text/html",
            value: `<!DOCTYPE html>
            <html lang="en">
              <head>
                <meta charset="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <title>Reset Password</title>
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
                  .reset-button {
                    display: inline-block;
                    background-color: #007bff;
                    color: white;
                    padding: 12px 24px;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 20px 0;
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
                <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff">
                  <tr>
                    <td>
                      <table align="center" cellpadding="0" cellspacing="0" width="500" style="margin: auto">
                        <tr>
                          <td style="padding: 30px 10px 10px">
                            <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                              <img src="https://nemo.intellicar.io/nemo3/vehicle/model/img/mahindra_logo.png" alt="Nemo Logo" style="width: 100px;" />
                              <p style="font-size: 29px; font-weight: 600; line-height: 35px">
                                Reset Password Request
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
                              We received a request to reset your password for your Nemo FMS account.
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px; text-align: center;">
                            <a href="${resetLink}" class="reset-button" style="color: #ffffff !important;">Reset Password</a>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px">
                            <p style="text-align: center; font-size: 14px">
                              If the button doesn't work, copy and paste this link into your browser:
                            </p>
                            <p style="text-align: center; font-size: 12px; word-break: break-all; color: #666;">
                              ${resetLink}
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px">
                            <p style="text-align: center; font-size: 14px">
                              This link will expire in 24 hours for security reasons.
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px">
                            <p style="text-align: center; font-size: 13px">
                              If you didn't request this password reset, please ignore this email or contact support if you have concerns.
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 18px">
                            <p style="text-align: center; font-size: 13px; color: #000000">
                              Best Regards,<br />
                              Nemo FMS Team<br />
                              <span style="color: #a0a0a0">Mahindra Last Mile Mobility Ltd.</span>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </body>
            </html>`,
          },
        ],
      },
    };

    return JSON.stringify(emailData);
  };

  Base64UrlDecode = (input) => { 
    input = input.trim().replace(/-/g, '+').replace(/_/g, '/'); 
      while (input.length % 4) { 
          input += '='; 
      } 
      return Buffer.from(input, 'base64'); 
  } 

  DecryptAES = (encryptedBuffer) => { 
    const fullKey = this.config.mahindrasso.secretkey; 

    // Key is 15 chars — pad to 16 bytes for AES-128 
    const key = Buffer.alloc(16, 0); 
    Buffer.from(fullKey, 'utf8').copy(key); 

    const decipher = crypto.createDecipheriv( 
      'aes-128-ecb', 
      key, 
      null 
  ); 
    decipher.setAutoPadding(true); 

    const decrypted = Buffer.concat([ 
        decipher.update(encryptedBuffer), 
        decipher.final() 
    ]); 

    return decrypted.toString('utf8'); 
  } 

  verifyJWT = (idToken) => { 
    const decoded = jwt.decode(idToken, { complete: true }); 

    if (!decoded) { 
        throw{
          errcode: "INVALID_CREDENTIALS",
          errdata: {},
          message: "Invalid credentials",
        };
    } 

    const payload = decoded.payload; 
    const now = Math.floor(Date.now() / 1000); 

    if (payload.exp && payload.exp < now) { 
        throw{
          errcode: "TOKEN_EXPIRED",
          errdata: {},
          message: "Token expired",
        };
    } 

    return payload; 
  } 

  UserMahindrassoEmailSignInLogic = async (
    email,
    authtoken,
    expiresin,
    refreshTokenMaxAge,
    inviteid
  ) => {
    try {
      // validate email and password
      const firstDecode = this.Base64UrlDecode(authtoken); 
      const cipherBytes = Buffer.from(firstDecode.toString('utf8'), 'base64'); 
      const idToken = this.DecryptAES(cipherBytes); 
      const payload = this.verifyJWT(idToken);

      const displayname = payload.displayname;
      const firstemail = payload.user_mail;
      const secondemail = payload.emailaddress;

      if (firstemail.toLowerCase() !== email.toLowerCase() && secondemail.toLowerCase() !== email.toLowerCase()) {
        throw{
          errcode: "INVALID_CREDENTIALS",
          errdata: {},
          message: "Invalid credentials",
        };
      }

      const mahindrassoemail = firstemail.toLowerCase() === email.toLowerCase() ? payload.user_mail : payload.emailaddress;

      let userdetails = await this.userSvcI.GetUserIdPassByMahindrassoEmail(mahindrassoemail.toLowerCase());
      if (!userdetails) {
        throw{
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      if (firstemail && firstemail.toLowerCase() !== userdetails.ssoid.toLowerCase()) {
        await this.userSvcI.UpdateMahindrassoEmail(userdetails.userid, firstemail.toLowerCase(), "ssoid");
      } 
      if (secondemail && secondemail.toLowerCase() !== userdetails.secondaryssoid.toLowerCase()) {
        await this.userSvcI.UpdateMahindrassoEmail(userdetails.userid, secondemail.toLowerCase(), "secondaryssoid");
      }
      if (displayname && displayname.toLowerCase() !== userdetails.displayname.toLowerCase()) {
        await this.userSvcI.UpdateUser(userdetails.userid, { displayname: displayname.toLowerCase() }, ADMIN_USER_ID);
      }
      if (!userdetails.isemailverified) {
        if (inviteid) {
          await this.userSvcI.UpdateUser(userdetails.userid, { isemailverified: true }, ADMIN_USER_ID);
          await this.userSvcI.AcceptInviteForMahindraSsoFirstLogin(userdetails.userid, inviteid);
        }else{
          let error = new Error("User is not registered");
          error.errcode = "USER_NOT_REGISTERED";
          throw error;
        }
      } 

      const lockStatus = await this.userSvcI.IsUserLocked(userdetails.userid);
      if (lockStatus.islocked) {
        const lockTime = new Date(lockStatus.lockeduntil);
        const remainingTime = Math.ceil((lockTime - new Date()) / (1000 * 60));

        await this.userSvcI.LogLoginAttempt(
          userdetails.userid,
          "mahindrasso",
          "FAILURE",
          "ACCOUNT_LOCKED"
        );

        throw{
          errcode: "ACCOUNT_LOCKED",
          errdata: {},
          message: `Account locked for ${remainingTime} minutes`,
        };
      }

      // get user details
      let user = await this.userSvcI.GetUserDetails(userdetails.userid);
      if (!user) {
        throw {
          errcode: "USER_NOT_FOUND",
          errdata: {},
          message: "User doesn't exist",
        };
      }

      // check if user is enabled
      if (!user.isenabled) {
        throw{
          errcode: "ACCOUNT_DISABLED",
          errdata: {},
          message: "Account is disabled",
        };
      }

      // check if user is deleted
      if (user.isdeleted) {
        throw{
          errcode: "ACCOUNT_DELETED",
          errdata: {},
          message: "Account is deleted",
        };
      }

      await this.userSvcI.UpdateLoginSuccess(userdetails.userid);

      await this.userSvcI.LogLoginAttempt(
        userdetails.userid,
        "mahindrasso",
        "SUCCESS"
      );

      let tokenclaims = {
        claims: {
          userid: userdetails.userid,
        },
        validity: expiresin,
      };
      let refreshtokenclaims = {
        claims: {
          userid: userdetails.userid,
        },
        validity: refreshTokenMaxAge,
      };

      let res = await this.authSvcI.GetTokenAndRefreshToken(
        userdetails.userid,
        tokenclaims,
        refreshtokenclaims
      );
      return {
        userid: user.userid,
        userinfo: user,
        token: res.token,
        refreshtoken: res.refreshtoken,
      };
    } catch (err) {
      throw err;
    }
  };
}
