import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import config from "../../../config/config.js";
import {
  ACCOUNT_ROLE_TYPE,
  CUSTOMER_TYPE_CORPORATE,
  CUSTOMER_TYPE_INDIVIDUAL,
  PLATFORM_ROLE_TYPE,
} from "../../../utils/constant.js";
import { EncryptPassword } from "../../../utils/eccutil.js";
import { preprocessingText } from "../../../utils/commonutil.js";
import crypto from "crypto";

export default class PUserHdlrImpl {
  constructor(
    pUserSvcI,
    userSvcI,
    accountSvcI,
    fmsAccountSvcI,
    authSvcI,
    platformSvcI,
    accountHdlr,
    logger
  ) {
    this.pUserSvcI = pUserSvcI;
    this.userSvcI = userSvcI;
    this.accountSvcI = accountSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.authSvcI = authSvcI;
    this.platformSvcI = platformSvcI;
    this.accountHdlr = accountHdlr;
    this.logger = logger;
    this.onboardingType = "onboarding";
  }

  CreateUserLogic = async (displayname, email, password, mobile, createdby) => {
    let userid = uuidv4();
    let encryptedpassword = await EncryptPassword(password);
    let user = {
      userid: userid,
      displayname: displayname,
      usertype: null,
      userinfo: {},
      isenabled: false,
      isdeleted: false,
      isemailverified: false,
      ismobileverified: false,
    };
    let userssoinfo = {
      email: email,
      password: encryptedpassword,
      mobile: mobile,
    };
    let res = await this.userSvcI.CreateUser(user, userssoinfo, createdby);
    if (!res) {
      this.logger.error("Failed to create user");
      throw new Error("Failed to create user");
    }

    // TODO: there has to be auth svc integration here

    user.email = email;
    user.mobile = mobile;
    return {
      userid: userid,
      user: user,
    };
  };

  ListPlatformUsersLogic = async (
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbydirection = preprocessingText(orderbydirection);
    let users = await this.userSvcI.GetPlatformUsers(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
    return users;
  };

  ListAccountUsersLogic = async (
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbydirection = preprocessingText(orderbydirection);
    let users = await this.userSvcI.GetAccountUsers(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
    return users;
  };

  ListUsersLogic = async (
    searchtext,
    offset,
    limit,
    download,
    orderbyfield,
    orderbydirection
  ) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbydirection = preprocessingText(orderbydirection);
    let users = await this.userSvcI.GetAllUsers(
      searchtext,
      offset,
      limit,
      download,
      orderbyfield,
      orderbydirection
    );
    return users;
  };

  InvitePlatformUserLogic = async (
    email,
    roleids,
    invitedby,
    headerReferer
  ) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let inviteid = uuidv4();
    const mahindrasso = email.includes("@mahindra.com");
    let res = mahindrasso
      ? await this.pUserSvcI.MahindrassoInviteToRootFleet(
          accountid,
          inviteid,
          email,
          invitedby,
          roleids,
          headerReferer
        )
      : await this.pUserSvcI.EmailInviteToRootFleet(
          accountid,
          inviteid,
          email,
          invitedby,
          roleids,
          headerReferer
        );
    if (!res) {
      this.logger.error("Failed to invite platform user");
      throw new Error("Failed to invite platform user");
    }
    return {
      inviteid: inviteid,
    };
  };

  //   SmsInvitePlatformUserLogic = async (
  //     mobile,
  //     roleids,
  //     invitedby,
  //     headerReferer
  //   ) => {
  //     throw new Error("Not implemented");
  //   };

  ListPlatformInvitesLogic = async (userid) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let result = await this.fmsAccountSvcI.ListInvitesOfAccount(accountid);
    if (!result) {
      this.logger.error("Failed to list invites of account");
      throw new Error("Failed to list invites of account");
    }

    const currentTime = new Date();

    for (let invite of result) {
      if (invite.invitestatus === "PENDING" && invite.expiresat) {
        const expiresAt = new Date(invite.expiresat);
        if (currentTime > expiresAt) {
          invite.invitestatus = "EXPIRED";
        }
      }
    }

    return result;
  };

  CancelPlatformInviteLogic = async (inviteid, cancelledby) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let result = await this.fmsAccountSvcI.CancelEmailInvite(
      accountid,
      inviteid,
      cancelledby
    );
    if (!result) {
      this.logger.error("Failed to cancel platform invite");
      throw new Error("Failed to cancel platform invite");
    }
    return result;
  };

  ResendPlatformInviteLogic = async (inviteid, resendedby, headerReferer) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let result = await this.pUserSvcI.ResendInvite(
      accountid,
      inviteid,
      resendedby,
      headerReferer
    );
    if (!result) {
      this.logger.error("Failed to resend platform invite");
      throw new Error("Failed to resend platform invite");
    }
    return result;
  };

  GetUserLogic = async (userid) => {
    let user = await this.userSvcI.GetUserDetails(userid);
    if (!user) {
      this.logger.error("User not found");
      throw new Error("User not found");
    }

    let userRoles = await this.pUserSvcI.GetAllUserRoles(userid);
    if (!userRoles) {
      userRoles = [];
    }

    let platformRoles = userRoles.filter(
      (role) => role.roletype === PLATFORM_ROLE_TYPE
    );
    platformRoles = platformRoles.map((role) => {
      return {
        roleid: role.roleid,
        rolename: role.rolename,
        roletype: role.roletype,
      };
    });

    let accountRoles = userRoles.filter(
      (role) => role.roletype === ACCOUNT_ROLE_TYPE
    );
    accountRoles = accountRoles.map((role) => {
      return {
        accountid: role.accountid,
        accountname: role.accountname,
        fleetid: role.fleetid,
        fleetname: role.fleetname,
        roleid: role.roleid,
        rolename: role.rolename,
        roletype: role.roletype,
      };
    });

    return {
      user: user,
      roles: {
        platform: platformRoles,
        account: accountRoles,
      },
    };
  };

  EnableUserLogic = async (userid, updatedby) => {
    let res = await this.userSvcI.EnableUser(userid, updatedby);
    if (!res) {
      this.logger.error("Failed to enable user");
      throw new Error("Failed to enable user");
    }
    return this.GetUserLogic(userid);
  };

  DisableUserLogic = async (userid, updatedby) => {
    let res = await this.userSvcI.DisableUser(userid, updatedby);
    if (!res) {
      this.logger.error("Failed to disable user");
      throw new Error("Failed to disable user");
    }
    return this.GetUserLogic(userid);
  };

  ListUserAccountsLogic = async (userid) => {
    let accounts = await this.userSvcI.GetUserAccounts(userid);
    if (!accounts) {
      accounts = [];
    }
    return accounts;
  };

  ListAssignableUserRolesLogic = async (userid) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let allRoles = await this.pUserSvcI.GetAllRoles(accountid);
    if (!allRoles) {
      allRoles = [];
    }

    let userRoles = await this.pUserSvcI.GetAllUserRoles(userid);
    if (!userRoles) {
      userRoles = [];
    }

    let assignedRolesOfRoleType = userRoles.filter(
      (role) => role.roletype === PLATFORM_ROLE_TYPE
    );
    let assignedRoles = assignedRolesOfRoleType.map((role) => role.roleid);

    allRoles = allRoles.map((role) => {
      return {
        roleid: role.roleid,
        rolename: role.rolename,
        roletype: role.roletype,
        isassigned: assignedRoles.includes(role.roleid),
      };
    });

    return { roles: allRoles };
  };

  AddUserPlatformRoleLogic = async (userid, roleids, updatedby) => {
    let res = await this.pUserSvcI.AddUserPlatformRole(
      userid,
      roleids,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to add user platform role");
      throw new Error("Failed to add user platform role");
    }
    return this.GetUserLogic(userid);
  };

  RemoveUserPlatformRoleLogic = async (userid, roleid, updatedby) => {
    if (
      roleid === "ffffffff-ffff-ffff-ffff-ffffffffffff" &&
      updatedby === userid
    ) {
      throw {
        errcode: "CANNOT_REMOVE_ADMIN_ROLE",
        message: "Cannot remove admin role",
      };
    }
    let res = await this.pUserSvcI.RemoveUserPlatformRole(
      userid,
      roleid,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to remove user platform role");
      throw new Error("Failed to remove user platform role");
    }
    return this.GetUserLogic(userid);
  };

  CreateSuperAdminLogic = async (createdby, email, password) => {
    let userid = await this.userSvcI.GetUserIdByEmail(email);
    if (userid) {
      this.logger.error("Superadmin already exists");
      throw new Error("Superadmin already exists");
    }

    userid = uuidv4();

    let encryptedPassword = await EncryptPassword(password);
    let res = await this.userSvcI.CreateSuperAdmin(
      createdby,
      userid,
      email,
      encryptedPassword
    );

    res = await this.authSvcI.CreateConsumer(userid);

    return res;
  };

  CreateUserByPlatformAdminLogic = async (
    useridtype,
    forceuseridtypeverified,
    contact,
    displayname,
    userinfo,
    createdby
  ) => {
    try {
      // Validation
      if (!useridtype || !contact || !displayname) {
        throw new Error("useridtype, contact, and displayname are required");
      }

      if (useridtype !== "email" && useridtype !== "mobile") {
        throw new Error("useridtype must be either 'email' or 'mobile'");
      }

      if (typeof forceuseridtypeverified !== "boolean") {
        throw new Error("forceuseridtypeverified must be a boolean");
      }

      // Validate contact format based on useridtype
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const indianMobileRegex = /^[6-9]\d{9}$/;

      if (useridtype === "email" && !emailRegex.test(contact)) {
        throw new Error("Invalid email format");
      }

      if (useridtype === "mobile" && !indianMobileRegex.test(contact)) {
        throw new Error(
          "Mobile must be a valid Indian mobile number (10 digits starting with 6-9)"
        );
      }

      // Validate displayname
      if (displayname.trim().length === 0) {
        throw new Error("displayname cannot be empty");
      }

      if (displayname.length > 100) {
        throw new Error("displayname is too long (maximum 100 characters)");
      }

      // Validate userinfo is an object
      if (userinfo && typeof userinfo !== "object") {
        throw new Error("userinfo must be an object");
      }

      // Check if contact already exists
      if (useridtype === "email") {
        const existingUser = await this.userSvcI.GetUserIdByEmail(contact);
        if (existingUser) {
          throw new Error("User with this email already exists");
        }
      } else {
        const existingUser = await this.userSvcI.GetUserIdByMobile(contact);
        if (existingUser) {
          throw new Error("User with this mobile number already exists");
        }
      }

      // Create the user in our metadata tables
      let res = await this.userSvcI.CreateUserByPlatformAdmin(
        useridtype,
        forceuseridtypeverified,
        contact,
        displayname,
        userinfo,
        createdby
      );

      if (!res) {
        this.logger.error("Failed to create user");
        throw new Error("Failed to create user");
      }

      // Register user with auth service
      try {
        let authres = await this.authSvcI.CreateConsumer(res.userid);

        if (authres === undefined || authres === null || !authres) {
          this.logger.error("Failed to create user in auth service");
          // Rollback by deleting all user records
          await this.userSvcI.DeleteUserRecordsByUserid(res.userid, createdby);
          throw new Error("Failed to create user in auth service");
        }

        res.token = authres?.token;
        res.refreshtoken = authres?.refreshtoken;
      } catch (error) {
        this.logger.error("Failed to register user with auth service", error);
        // Rollback by deleting all user records
        await this.userSvcI.DeleteUserRecordsByUserid(res.userid, createdby);
        throw new Error("Failed to register user with auth service");
      }

      return {
        userid: res.userid,
        contact: contact,
        useridtype: useridtype,
        displayname: displayname,
        isemailverified: res.isemailverified,
        ismobileverified: res.ismobileverified,
        needsPasswordChange: res.needsPasswordChange,
        usertoken: res.token,
      };
    } catch (err) {
      this.logger.error("Create user logic failed", err);
      throw err;
    }
  };

  AddUserToAccountLogic = async (addedby, contact, accountid) => {
    let res = await this.userSvcI.AddUserToAccount(addedby, contact, accountid);
    if (!res) {
      this.logger.error("Failed to add user to account");
      throw new Error("Failed to add user to account");
    }
    return {
      userid: res.userid,
      accountid: accountid,
      contact: contact,
      contacttype: res.contacttype,
    };
  };

  RemoveUserFromAccountLogic = async (removedby, contact, accountid) => {
    let res = await this.userSvcI.RemoveUserFromAccount(
      removedby,
      contact,
      accountid
    );
    if (!res) {
      this.logger.error("Failed to remove user from account");
      throw new Error("Failed to remove user from account");
    }
    return {
      userid: res.userid,
      accountid: accountid,
      contact: contact,
      contacttype: res.contacttype,
    };
  };

  DeleteUserLogic = async (userid, deletedby) => {
    if (userid === deletedby) {
      const error = new Error("You cannot delete yourself");
      error.errcode = "CANNOT_DELETE_SELF";
      throw error;
    }

    if (userid === "ffffffff-ffff-ffff-ffff-ffffffffffff") {
      const error = new Error("Cannot delete seed user (super admin)");
      error.errcode = "CANNOT_DELETE_SEED_USER";
      throw error;
    }

    let userDetails = await this.userSvcI.GetUserDetails(userid);
    if (!userDetails) {
      const error = new Error("User not found");
      error.errcode = "USER_NOT_FOUND";
      throw error;
    }

    if (userDetails.isdeleted) {
      const error = new Error("User is already deleted");
      error.errcode = "USER_ALREADY_DELETED";
      throw error;
    }

    let result = await this.userSvcI.DeleteUser(userid, deletedby);
    if (!result) {
      throw new Error("Failed to delete user");
    }

    try {
      await this.authSvcI.DeleteConsumer(userid);
    } catch (error) {
      this.logger.error(
        `Failed to delete consumer from auth service for user ${userid}`,
        error
      );
    }
    return result;
  };

  ResetUserPasswordLogic = async (userid, resetby) => {
    let resetByUser = await this.pUserSvcI.CheckSuperAdminRole(resetby);
    if (!resetByUser) {
      this.logger.error("Only superadmin can reset user passwords");
      throw new Error("Only superadmin can reset user passwords");
    }

    let targetUser = await this.userSvcI.GetUserDetails(userid);
    if (!targetUser) {
      this.logger.error("Target user not found");
      throw new Error("Target user not found");
    }
    
    const mahindraEmailRegex = /^[^\s@]+@mahindra.com$/;

    if(mahindraEmailRegex.test(targetUser.email)) {
      let error = new Error("Cannot reset password for Mahindra SSO users");
      error.errcode = "CANNOT_RESET_MAHINDRA_SSO_USER";
      throw error;
    }

    let result = await this.pUserSvcI.ResetUserPassword(userid, resetby);
    if (!result) {
      this.logger.error("Failed to reset user password");
      throw new Error("Failed to reset user password");
    }

    let logoutresult = await this.authSvcI.InvalidateToken(userid);
    if (!logoutresult) {
      throw new Error("Failed to logout, password reset successfully");
    }

    return {
      userid: userid,
      resetby: resetby,
      message:
        "Password reset successfully and user logged out from all devices",
    };
  };

  GetMyConsolePermissionsLogic = async (userid) => {
    try {
      let consolePerms = await this.userSvcI.GetConsolePerms(userid);

      if (!consolePerms || consolePerms.length === 0) {
        return {
          userid: userid,
          permissions: [],
        };
      }

      return {
        userid: userid,
        permissions: consolePerms,
      };
    } catch (error) {
      throw error;
    }
  };

  ListPendingUsersLogic = async (
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbyfield = preprocessingText(orderbyfield);
    orderbyfield = orderbyfield.toLowerCase();
    orderbydirection = preprocessingText(orderbydirection);
    let users = await this.pUserSvcI.ListPendingUsers(
      searchtext,
      offset,
      limit,
      orderbyfield,
      orderbydirection,
      download
    );
    if (!users) {
      users = [];
    }
    return users;
  };

  ListDoneUsersLogic = async (
    searchtext,
    offset,
    limit,
    orderbyfield,
    orderbydirection,
    download
  ) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbyfield = preprocessingText(orderbyfield);
    orderbyfield = orderbyfield.toLowerCase();
    orderbydirection = preprocessingText(orderbydirection);
    let users = await this.pUserSvcI.ListDoneUsers(
      searchtext,
      offset,
      limit,
      orderbyfield,
      orderbydirection,
      download
    );
    if (!users) {
      users = [];
    }
    return users;
  };

  GetMetadataOptionsLogic = async () => {
    try {
      let possibleValues = await this.pUserSvcI.GetMetadataOptions();

      if (!possibleValues) {
        possibleValues = [];
      }

      return possibleValues;
    } catch (error) {
      throw error;
    }
  };

  preprocessingmobile = (mobile) => {
    return mobile
      .replace(/[^0-9]/g, "") // Keep only digits
      .trim(); // Trim whitespaces
  };

  preprocessingname = (name) => {
    return name
      .toUpperCase() // Convert to uppercase
      .replace(/[^A-Z0-9\s&]/g, " ") // Replace anything other than alphabets, numbers, spaces, &, and . with space
      .replace(/\s+/g, " ") // Replace multiple whitespaces with single space
      .trim(); // Trim leading and trailing whitespaces
  };

  AddAccountToReviewPending = async (
    taskid,
    accountname,
    original_input,
    error_status,
    userid,
    reason,
    status = "REVIEWED_PENDING"
  ) => {
    try {
      const existingpendingaccount = await this.accountSvcI.GetPendingAccountReviewById(taskid);
      if (existingpendingaccount) {
        await this.accountSvcI.UpdateReviewPendingAccount(
          existingpendingaccount.accountid,
          {
            accountname: accountname,
            error_status: error_status,
            status: status,
            reason: reason,
            original_input: original_input,
          },
          userid
        );

        return {
          errcode: error_status,
          status: status,
          message:
            reason,
        }
      }
      await this.accountSvcI.AddReviewPendingAccount({
        accountid: taskid,
        accountname: accountname,
        accounttype: "customer",
        accountinfo: {},
        mobile: original_input.nemo_user_mobile,
        isenabled: false, // Disabled until reviewed
        isdeleted: false,
        original_input: original_input,
        error_status: error_status,
        status: status,
        reason: reason,
        review_data: {
          accountname: accountname,
        },
        createdby: userid,
        updatedby: userid,
      });
    } catch (error) {
      this.logger.error("Failed to add account to review pending table", error);
      // Don't throw error here as the main flow should continue
    }
  };
  AddAccountToReviewDone = async (
    taskid,
    accountname,
    account,
    original_input,
    userid,
    reason,
    review_data = {},
    status = "REVIEWED_SUCCESS"
  ) => {
    try {
      const existingdonetask =
        await this.accountSvcI.GetAccountReviewDoneByAccountName(
          accountname,
          status
        );
      const pendingaccount = await this.accountSvcI.GetPendingAccountReviewById(
        taskid
      );
      if (existingdonetask) {
        if (pendingaccount) {
          await this.accountSvcI.DeletePendingAccountReviewById(taskid);
        }
        return;
      }
      if (pendingaccount) {
        review_data = {
          accountname: pendingaccount.accountname,
          accounttype: pendingaccount.accounttype || "customer",
          accountinfo: pendingaccount.accountinfo || {},
          isenabled: pendingaccount.isenabled,
          isdeleted: pendingaccount.isdeleted || false,
          original_input: pendingaccount.original_input,
          error_status: pendingaccount.error_status,
          status: pendingaccount.status,
          reason: pendingaccount.reason,
          review_data: pendingaccount.review_data || {},
          createdat: pendingaccount.createdat,
          createdby: pendingaccount.createdby,
          updatedat: pendingaccount.updatedat,
          updatedby: pendingaccount.updatedby,
        };
      }
      await this.accountSvcI.AddReviewDoneAccount({
        accountid: taskid,
        accountname: accountname,
        accounttype: account.accounttype || "customer",
        accountinfo: account.accountinfo || {},
        isenabled: account.isenabled || true,
        isdeleted: account.isdeleted || false,
        original_input: original_input || {},
        original_status: status,
        resolution_reason: reason,
        review_data: review_data,
        reviewed_by: userid,
        createdby: userid,
        updatedby: userid,
        entrytype: this.onboardingType,
      });
      const deletependingaccount =
        await this.accountSvcI.DeletePendingAccountReviewById(taskid);
    } catch (error) {
      this.logger.error("Failed to add account to review done table", error);
      // Don't throw error here as the main flow should continue
    }
  };

  AddUserToReviewDone = async (
    taskid,
    user,
    createdby,
    original_input = {},
    review_data = {}
  ) => {
    try {
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        review_data = {
          displayname: pendinguser.displayname,
          usertype: pendinguser.usertype,
          mobile: pendinguser.mobile,
          email: pendinguser.email,
          address: pendinguser.address,
          city: pendinguser.city,
          country: pendinguser.country,
          pincode: pendinguser.pincode,
          dateofbirth: pendinguser.dateofbirth,
          gender: pendinguser.gender,
          vehiclemobile: pendinguser.vehiclemobile,
          userinfo: pendinguser.userinfo,
          isenabled: pendinguser.isenabled,
          isdeleted: pendinguser.isdeleted,
          isemailverified: pendinguser.isemailverified,
          ismobileverified: pendinguser.ismobileverified,
          acceptedterms: pendinguser.acceptedterms,
          original_input: pendinguser.original_input,
          error_status: pendinguser.error_status,
          status: pendinguser.status,
          reason: pendinguser.reason,
          review_data: pendinguser.review_data || {},
          createdat: pendinguser.createdat,
          createdby: pendinguser.createdby,
          updatedat: pendinguser.updatedat,
          updatedby: pendinguser.updatedby,
        };
      }
      await this.pUserSvcI.AddReviewDoneUser({
        userid: taskid,
        displayname: user.displayname,
        usertype: user.usertype,
        mobile: original_input.nemo_user_mobile,
        email: original_input.customercontactemail,
        address: original_input.customeraddress,
        city: original_input.customeraddresscity,
        country: original_input.customeraddresscountry,
        pincode: original_input.customeraddresspincode,
        dateofbirth: original_input.customerdateofbirth,
        gender: original_input.customergender,
        vehiclemobile: original_input.customercontactmobile,
        userinfo: user.userinfo,
        isenabled: user.isenabled !== undefined ? user.isenabled : true, // Default to true
        isdeleted: user.isdeleted !== undefined ? user.isdeleted : false, // Default to false
        isemailverified:
          user.isemailverified !== undefined ? user.isemailverified : false, // Default to false
        ismobileverified:
          user.ismobileverified !== undefined ? user.ismobileverified : false, // Default to false
        acceptedterms: user.acceptedterms,
        original_input: original_input,
        original_status: "USER_CREATION_SUCCESS",
        resolution_reason: "User onboarded successfully",
        review_data: review_data,
        entrytype: this.onboardingType,
        reviewed_by: createdby,
        createdby: createdby,
        updatedby: createdby,
      });
      const deletependinguser =
        await this.pUserSvcI.DeletePendingUserReviewById(taskid);
    } catch (error) {
      this.logger.error("Failed to add user to review done table", error);
      // Don't throw error here as the main flow should continue
    }
  };

  AddUserToReviewPending = async (
    taskid,
    user,
    createdby,
    reason,
    usertype,
    original_input = {},
    review_data = {},
    error_status = "USER_CREATION"
  ) => {
    try {
      await this.pUserSvcI.AddReviewPendingUser({
        userid: taskid,
        displayname: user.displayname,
        usertype: usertype,
        mobile: original_input.nemo_user_mobile,
        email: original_input.customercontactemail,
        address: original_input.customeraddress,
        city: original_input.customeraddresscity,
        country: original_input.customeraddresscountry,
        pincode: original_input.customeraddresspincode,
        dateofbirth: original_input.customerdateofbirth,
        gender: original_input.customergender,
        vehiclemobile: original_input.customercontactmobile,
        userinfo: user.userinfo,
        isenabled: user.isenabled,
        isdeleted: user.isdeleted,
        isemailverified: user.isemailverified,
        ismobileverified: user.ismobileverified,
        acceptedterms: user.acceptedterms,
        original_input: original_input,
        error_status: error_status,
        status: "USER_CREATION_PENDING",
        reason: reason,
        review_data: review_data,
        createdby: createdby,
        updatedby: createdby,
      });
    } catch (error) {
      this.logger.error("Failed to add user to review pending table", error);
      // Don't throw error here as the main flow should continue
    }
  };

  AddUserInfo = async (
    userid,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customerdateofbirth,
    customergender,
    createdby
  ) => {
    const adduserinfo = await this.pUserSvcI.AddUserInfo(
      userid,
      {
        address: customeraddress,
        addresscity: customeraddresscity,
        addresscountry: customeraddresscountry,
        addresspincode: customeraddresspincode,
        dateofbirth: customerdateofbirth,
        gender: customergender,
      },
      createdby
    );
    if (!adduserinfo) {
      this.logger.error("Failed to add user info");
      throw new Error("Failed to add user info");
    }
  };

  TaskCreateAccount = async (
    taskid,
    accountname,
    userid,
    original_input,
    accountcategory = "individual"
  ) => {
    try {
      const accountRes =
        await this.accountHdlr.accountHdlrImpl.CreateAccountLogic(
          accountname,
          {},
          true,
          userid,
          accountcategory
        );
      if (!accountRes) {
        // Add account to review pending table
        const pendingaccount =
          await this.accountSvcI.GetPendingAccountReviewById(taskid);
        if (pendingaccount) {
          await this.accountSvcI.UpdateReviewPendingAccount(
            pendingaccount.accountid,
            {
              accountname: accountname,
              review_data: { accountname: accountname },
              error_status: "ACCOUNT_CREATION",
              status: "PENDING_ACCOUNT_CREATION",
              reason: "Account creation failed.",
              original_input: original_input,
            },
            userid
          );
        } else {
          await this.AddAccountToReviewPending(
            taskid,
            accountname,
            original_input,
            "ACCOUNT_CREATION",
            userid,
            `Account creation failed.`,
            "PENDING_ACCOUNT_CREATION"
          );
        }
        return {
          errcode: "ACCOUNT_CREATION_FAILED",
          status: "PENDING_ACCOUNT_CREATION",
          message: "Account creation failed.",
        };
      }
      await this.AddAccountToReviewDone(
        taskid,
        accountname,
        accountRes,
        original_input,
        userid,
        "Account created successfully",
        {},
        "ACCOUNT_CREATION_SUCCESS"
      );
      return accountRes;
    } catch (error) {
      this.logger.error("Failed to create account task", error);
      const pendingaccount = await this.accountSvcI.GetPendingAccountReviewById(
        taskid
      );
      if (pendingaccount) {
        await this.accountSvcI.UpdateReviewPendingAccount(
          pendingaccount.accountid,
          {
            accountname: accountname,
            review_data: { accountname: accountname },
            error_status: "ACCOUNT_CREATION",
            status: "PENDING_ACCOUNT_CREATION",
            reason: "Account creation failed.",
            original_input: original_input,
          },
          userid
        );
      } else {
        await this.AddAccountToReviewPending(
          taskid,
          accountname,
          original_input,
          "ACCOUNT_CREATION",
          userid,
          `Account creation failed.`,
          "PENDING_ACCOUNT_CREATION"
        );
      }
      return {
        errcode: "ACCOUNT_CREATION_FAILED",
        status: "PENDING_ACCOUNT_CREATION",
        message: `Account creation failed: ${error.message}`,
      };
    }
  };

  TaskCreateUser = async (
    taskid,
    usertype,
    userid,
    original_input,
    usermobile,
    username,
    useremail,
    review_data,
    accountid
  ) => {
    try {
      let user = null;
      if (usertype === null) {
        user = await this.CreateFmsUserLogic(
          username,
          useremail,
          usermobile,
          userid
        );
      } else {
        user = await this.CreateUserByPlatformAdminLogic(
          usertype,
          true,
          usertype === "mobile" ? usermobile : useremail,
          username,
          { email: useremail, mobile: usermobile },
          userid
        );
      }
      if (!user) {
        const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(
          taskid
        );
        if (pendinguser) {
          await this.pUserSvcI.UpdateReviewPendingUser(
            pendinguser.userid,
            {
              displayname: username,
              userinfo: { mobile: usermobile, email: useremail },
              review_data: review_data,
              error_status: "USER_CREATION",
              reason: "User creation failed.",
              original_input: original_input,
            },
            userid
          );
        } else {
          await this.AddUserToReviewPending(
            taskid,
            {
              displayname: username,
              userinfo: { mobile: usermobile, email: useremail },
              isenabled: true,
              isdeleted: false,
              isemailverified: false,
              ismobileverified: false,
              acceptedterms: {},
            },
            userid,
            `User creation failed.`,
            usertype,
            original_input,
            review_data,
            "USER_CREATION"
          );
        }
        return {
          accountid: accountid,
          errcode: "USER_CREATION_FAILED",
          status: "PENDING_USER_CREATION",
          message: "Account created successfully. User creation failed.",
        };
      }
      return user;
    } catch (error) {
      this.logger.error("Failed to create user task", error);
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.pUserSvcI.UpdateReviewPendingUser(
          pendinguser.userid,
          {
            displayname: username,
            userinfo: { mobile: usermobile, email: useremail },
            review_data: review_data,
            error_status: "USER_CREATION",
            reason: "User creation failed.",
            original_input: original_input,
          },
          userid
        );
      } else {
        await this.AddUserToReviewPending(
          taskid,
          {
            displayname: username,
            userinfo: { mobile: usermobile, email: useremail },
            isenabled: true,
            isdeleted: false,
            isemailverified: false,
            ismobileverified: false,
            acceptedterms: {},
          },
          userid,
          `User creation failed.`,
          usertype,
          original_input,
          review_data,
          "USER_CREATION"
        );
      }
      return {
        accountid: accountid,
        errcode: "USER_CREATION_FAILED",
        status: "PENDING_USER_CREATION",
        message: `Account created successfully. User creation failed: ${error.message}`,
      };
    }
  };

  async handleUserInfoUpdate(
    userid,
    userinfotabledata,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customerdateofbirth,
    customergender,
    createdby
  ) {
    if (userinfotabledata) {
      const userinfotableupdatefields = {};
      if (userinfotabledata.address !== customeraddress) {
        userinfotableupdatefields.address = customeraddress;
      }
      if (userinfotabledata.addresscity !== customeraddresscity) {
        userinfotableupdatefields.addresscity = customeraddresscity;
      }
      if (userinfotabledata.addresscountry !== customeraddresscountry) {
        userinfotableupdatefields.addresscountry = customeraddresscountry;
      }
      if (userinfotabledata.addresspincode !== customeraddresspincode) {
        userinfotableupdatefields.addresspincode = customeraddresspincode;
      }
      if (userinfotabledata.dateofbirth !== customerdateofbirth) {
        userinfotableupdatefields.dateofbirth = customerdateofbirth;
      }
      if (userinfotabledata.gender !== customergender) {
        userinfotableupdatefields.gender = customergender;
      }
      if (Object.keys(userinfotableupdatefields).length > 0) {
        const updateuserinfo = await this.pUserSvcI.UpdateUserInfo(
          userid,
          userinfotableupdatefields,
          createdby
        );
        if (!updateuserinfo) {
          // Do nothing
        }
      }
    } else {
      const userinfotablecreatefields = {};
      if (customeraddress) {
        userinfotablecreatefields.address = customeraddress;
      }
      if (customeraddresscity) {
        userinfotablecreatefields.addresscity = customeraddresscity;
      }
      if (customeraddresscountry) {
        userinfotablecreatefields.addresscountry = customeraddresscountry;
      }
      if (customeraddresspincode) {
        userinfotablecreatefields.addresspincode = customeraddresspincode;
      }
      if (customerdateofbirth) {
        userinfotablecreatefields.dateofbirth = customerdateofbirth;
      }
      if (customergender) {
        userinfotablecreatefields.gender = customergender;
      }
      if (Object.keys(userinfotablecreatefields).length > 0) {
        const createuserinfo = await this.pUserSvcI.AddUserInfo(
          userid,
          userinfotablecreatefields,
          createdby
        );
        if (!createuserinfo) {
          // Do nothing
        }
      }
    }
  }

  async handleUserAdditionToAccount(
    createdbyuserid,
    contact,
    accountid,
    taskid,
    accountname,
    original_input,
    userid,
    userrole = null
  ) {
    const existingcontact = await this.userSvcI.CheckMobileExists(contact);

    const isUserAddedToAccount = await this.pUserSvcI.checkIsUserAddedToAccount(
      existingcontact,
      accountid
    );
    if (isUserAddedToAccount) {
      return null;
    }
    let adduser = null;
    if (userrole) {
      // when userrole is provided, add user to account with role
      adduser = await this.userSvcI.AddUserToAccountWithRole(
        userid,
        accountid,
        userrole,
        createdbyuserid
      );
    } else {
      adduser = await this.AddUserToAccountLogic(
        createdbyuserid,
        contact,
        accountid
      );
    }
    if (!adduser) {
      const pendingaccount = await this.accountSvcI.GetPendingAccountReviewById(
        taskid
      );
      if (pendingaccount) {
        await this.accountSvcI.UpdateReviewPendingAccount(
          pendingaccount.accountid,
          {
            error_status: "USER_ASSIGNMENT",
            status: "PENDING_USER_ASSIGNMENT",
            reason:
              "User assignment failed. User already exists in another account.",
            original_input: original_input,
          },
          userid
        );
        return {
          userid: createdbyuserid,
          accountid: accountid,
          errcode: "USER_ASSIGNMENT_FAILED",
          status: "PENDING_USER_ASSIGNMENT",
          message:
            "Account and user created successfully. User assignment failed. User already exists in another account.",
        };
      } else {
        await this.AddAccountToReviewPending(
          taskid,
          accountname,
          original_input,
          "USER_ASSIGNMENT",
          userid,
          `User assignment failed.`,
          "PENDING_USER_ASSIGNMENT"
        );
      }
      return {
        userid: createdbyuserid,
        accountid: accountid,
        errcode: "USER_ASSIGNMENT_FAILED",
        status: "PENDING_USER_ASSIGNMENT",
        message:
          "Account and user created successfully. User assignment failed.",
      };
    }
    return null; // Success
  }

  async handleServiceOnboarding(
    vin,
    vehiclemobile,
    accountname,
    taskid,
    original_input,
    userid,
    accountid
  ) {
    try {
      const payloaddata = {
        vinno: vin,
        mobileno: vehiclemobile,
      };
      const url = `${config.serviceConfig.url}${config.serviceConfig.onboardingPath}`;
      const response = await axios.post(url, payloaddata, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (response.status !== 200) {
        const pendingaccount =
          await this.accountSvcI.GetPendingAccountReviewById(taskid);
        if (pendingaccount) {
          await this.accountSvcI.UpdateReviewPendingAccount(
            pendingaccount.accountid,
            {
              accountname: accountname,
              error_status: "SERVICE_ONBOARDING",
              status: "PENDING_SERVICE_ONBOARDING",
              reason: "Service onboarding failed.",
              original_input: original_input,
            },
            userid
          );
        } else {
          await this.AddAccountToReviewPending(
            taskid,
            accountname,
            original_input,
            "SERVICE_ONBOARDING",
            userid,
            `Service onboarding failed.`,
            "PENDING_SERVICE_ONBOARDING"
          );
        }
        return {
          accountid: accountid,
          errcode: "SERVICE_ONBOARDING_FAILED",
          status: "PENDING_SERVICE_ONBOARDING",
          message: "Service onboarding failed.",
        };
      }
      return null; // Success
    } catch (error) {
      if (
        error.response.data.err.errcode &&
        (error.response.data.err.errcode === "VEHICLE_ALREADY_ONBOARDED" ||
          error.response.data.err.errcode === "VEHICLE_ONBOARDING_IN_PROCESS")
      ) {
        return null; // Success
      }
      return {
        accountid: accountid,
        errcode: "SERVICE_ONBOARDING_FAILED",
        status: "PENDING_SERVICE_ONBOARDING",
        message: `Service onboarding failed: ${error.response.data.msg}.`,
      };
    }
  }

  // Helper function to handle vehicle addition
  async handleVehicleAddition(
    accountid,
    vin,
    licenseplate,
    vehiclemobile,
    userid,
    taskid,
    accountname,
    original_input
  ) {
    let vehicleExists = await this.platformSvcI.CheckVehicleExists(vin);
    if (vehicleExists) {
      const isVehicleAddedToAccount =
        await this.pUserSvcI.checkIsVehicleAddedToAccount(vin);
      const isVehicleAddedToSameAccount = isVehicleAddedToAccount
        ? isVehicleAddedToAccount.accountid === accountid
        : false;

      let addvehicle = null;
      if (!isVehicleAddedToAccount) {
        addvehicle =
          await this.accountHdlr.accountHdlrImpl.AddVehicleToAccountLogic(
            accountid,
            {
              vinno: vin,
              regno: licenseplate,
              isowner: true,
              accvininfo: {},
            },
            userid
          );
      }
      if (!addvehicle && !isVehicleAddedToSameAccount) {
        const pendingaccount =
          await this.accountSvcI.GetPendingAccountReviewById(taskid);
        if (pendingaccount) {
          await this.accountSvcI.UpdateReviewPendingAccount(
            pendingaccount.accountid,
            {
              accountname: accountname,
              error_status: "VEHICLE_ASSIGNMENT",
              status: "PENDING_VEHICLE_ASSIGNMENT",
              reason:
                "Vehicle assignment failed. Vehicle already exists in another account.",
              original_input: original_input,
            },
            userid
          );
        } else {
          await this.AddAccountToReviewPending(
            taskid,
            accountname,
            original_input,
            "VEHICLE_ASSIGNMENT",
            userid,
            `Vehicle assignment failed. Vehicle already exists in another account.`,
            "PENDING_VEHICLE_ASSIGNMENT"
          );
        }
        return {
          accountid: accountid,
          errcode: "VEHICLE_ASSIGNMENT_FAILED",
          status: "PENDING_VEHICLE_ASSIGNMENT",
          message:
            "Vehicle assignment failed. Vehicle already exists in another account.",
        };
      }
      // Update vehicle mobile
      let checkandcreatecity = await this.platformSvcI.CheckAndCreateCity(
        original_input.customeraddresscity
      );
      if (!checkandcreatecity) {
        checkandcreatecity = original_input.customeraddresscity;
      }
      const updatevehicle = await this.platformSvcI.UpdateVehicleCity(
        vin,
        checkandcreatecity,
        userid
      );
      if (!updatevehicle) {
        // Do nothing
      }
      const serviceResult = await this.handleServiceOnboarding(
        vin,
        vehiclemobile,
        accountname,
        taskid,
        original_input,
        userid,
        accountid
      );
      if (serviceResult) return serviceResult;

      return null; // Success
    } else {
      const pendingaccount = await this.accountSvcI.GetPendingAccountReviewById(
        taskid
      );
      if (pendingaccount) {
        await this.accountSvcI.UpdateReviewPendingAccount(
          pendingaccount.accountid,
          {
            accountname: accountname,
            error_status: "VEHICLE_ASSIGNMENT",
            status: "PENDING_VEHICLE_ASSIGNMENT",
            reason: "Vehicle assignment failed. Vehicle not found.",
            original_input: original_input,
          },
          userid
        );
      } else {
        await this.AddAccountToReviewPending(
          taskid,
          accountname,
          original_input,
          "VEHICLE_ASSIGNMENT",
          userid,
          `Vehicle assignment failed. Vehicle not found.`,
          "PENDING_VEHICLE_ASSIGNMENT"
        );
      }
      return {
        accountid: accountid,
        errcode: "VEHICLE_ASSIGNMENT_FAILED",
        status: "PENDING_VEHICLE_ASSIGNMENT",
        message: "Vehicle assignment failed. Vehicle not found.",
      };
    }
  }

  async handleIndividualCustomerOnboarding(
    taskid,
    accountname,
    userid,
    original_input,
    existingmobile,
    usermobile,
    processedcustomername,
    customercontactemail,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customerdateofbirth,
    customergender,
    vehiclemobile,
    vin,
    licenseplate,
    accountcategory = "individual"
  ) {
    const accountRes = await this.TaskCreateAccount(
      taskid,
      accountname,
      userid,
      original_input,
      accountcategory
    );
    const accountid = accountRes.accountid;
    const account = accountRes.account;

    // Create user
    let user = null;
    if (existingmobile === null) {
      user = await this.TaskCreateUser(
        taskid,
        "mobile",
        userid,
        original_input,
        usermobile,
        processedcustomername,
        customercontactemail,
        {
          address: customeraddress,
          city: customeraddresscity,
          country: customeraddresscountry,
          pincode: customeraddresspincode,
          email: customercontactemail,
          vehiclemobile: vehiclemobile,
          dateofbirth: customerdateofbirth,
          gender: customergender,
          displayname: processedcustomername,
          mobile: usermobile,
        },
        accountid
      );
      // Add user info
      if (user) {
        await this.AddUserInfo(
          user.userid,
          customeraddress,
          customeraddresscity,
          customeraddresscountry,
          customeraddresspincode,
          customerdateofbirth,
          customergender,
          userid
        );
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    } else {
      user = await this.userSvcI.GetUserDetails(existingmobile);
      const userinfotabledata = await this.pUserSvcI.GetUserInfo(user.userid);
      await this.handleUserInfoUpdate(
        user.userid,
        userinfotabledata,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customerdateofbirth,
        customergender,
        userid
      );
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    }

    // Add user to account
    const userAdditionResult = await this.handleUserAdditionToAccount(
      userid,
      usermobile,
      accountid,
      taskid,
      accountname,
      original_input,
      user.userid
    );
    if (userAdditionResult) return userAdditionResult;

    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      accountRes,
      original_input,
      userid,
      "User assignment successful",
      {},
      "USER_ASSIGNMENT_SUCCESS"
    );

    // Handle vehicle addition
    const vehicleResult = await this.handleVehicleAddition(
      accountid,
      vin,
      licenseplate,
      vehiclemobile,
      userid,
      taskid,
      accountname,
      original_input
    );
    if (vehicleResult) return vehicleResult;

    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      accountRes,
      original_input,
      userid,
      "Vehicle assignment successful",
      {},
      "VEHICLE_ASSIGNMENT_SUCCESS"
    );

    return {
      userid: user.userid,
      accountid: accountid,
      status: "ONBOARDED_SUCCESS",
      message:
        "Account and User created. User and Vehicle assigned to Account.",
    };
  }

  // Function to handle existing individual account
  async handleExistingIndividualAccount(
    taskid,
    existingaccount,
    existingmobile,
    usermobile,
    processedcustomername,
    customercontactemail,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customerdateofbirth,
    customergender,
    vehiclemobile,
    vin,
    licenseplate,
    userid,
    original_input,
    accountname
  ) {
    let user = null;
    if (existingmobile === null) {
      user = await this.TaskCreateUser(
        taskid,
        "mobile",
        userid,
        original_input,
        usermobile,
        processedcustomername,
        customercontactemail,
        {
          address: customeraddress,
          city: customeraddresscity,
          country: customeraddresscountry,
          pincode: customeraddresspincode,
          email: customercontactemail,
          vehiclemobile: vehiclemobile,
          dateofbirth: customerdateofbirth,
          gender: customergender,
          displayname: processedcustomername,
          mobile: usermobile,
        },
        existingaccount.accountid
      );
      // Add user info
      if (user) {
        await this.AddUserInfo(
          user.userid,
          customeraddress,
          customeraddresscity,
          customeraddresscountry,
          customeraddresspincode,
          customerdateofbirth,
          customergender,
          userid
        );
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    } else {
      user = await this.userSvcI.GetUserDetails(existingmobile);
      const userinfotabledata = await this.pUserSvcI.GetUserInfo(user.userid);
      await this.handleUserInfoUpdate(
        user.userid,
        userinfotabledata,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customerdateofbirth,
        customergender,
        userid
      );

      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    }

    // Add user to account
    const userAdditionResult = await this.handleUserAdditionToAccount(
      userid,
      usermobile,
      existingaccount.accountid,
      taskid,
      accountname,
      original_input,
      user.userid
    );
    if (userAdditionResult) return userAdditionResult;
    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      existingaccount,
      original_input,
      userid,
      "User assignment successful",
      {},
      "USER_ASSIGNMENT_SUCCESS"
    );

    // Handle vehicle addition
    const vehicleResult = await this.handleVehicleAddition(
      existingaccount.accountid,
      vin,
      licenseplate,
      vehiclemobile,
      userid,
      taskid,
      accountname,
      original_input
    );
    if (vehicleResult) return vehicleResult;

    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      existingaccount,
      original_input,
      userid,
      "Vehicle assignment successful",
      {},
      "VEHICLE_ASSIGNMENT_SUCCESS"
    );

    return {
      userid: user.userid,
      accountid: existingaccount.accountid,
      status: "ONBOARDED_SUCCESS",
      message:
        "Account and User created. User and Vehicle assigned to Account.",
    };
  }

  // Function to handle corporate customer onboarding
  async handleCorporateCustomerOnboarding(
    taskid,
    accountname,
    userid,
    original_input,
    existingmobile,
    existingemail,
    usermobile,
    processedcustomername,
    customercontactemail,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customerdateofbirth,
    customergender,
    vehiclemobile,
    vin,
    licenseplate,
    accountid,
    userrole,
    accountcategory = "corporate"
  ) {
    let account = null;
    let action = null;
    if (accountid) {
      account = await this.platformSvcI.GetAccountById(accountid);
      if (account) {
        const accountreviewdone =
          await this.accountSvcI.GetAccountReviewDoneByAccountName(
            account.accountname,
            "ACCOUNT_CREATION_SUCCESS"
          );
        if (!accountreviewdone) {
          await this.AddAccountToReviewDone(
            taskid,
            account.accountname,
            account,
            original_input,
            userid,
            "Account created successfully",
            {},
            "ACCOUNT_CREATION_SUCCESS"
          );
        }
      }
    } else {
      account = await this.platformSvcI.GetAccountByName(accountname);
      if (account) {
        accountid = account.accountid;
      } else {
        const accountRes = await this.TaskCreateAccount(
          taskid,
          accountname,
          userid,
          original_input,
          accountcategory
        );
        accountid = accountRes.accountid;
        account = accountRes.account;
      }
    }
    original_input.nemo3_account_id = accountid;

    // Handle vehicle addition
    const vehicleResult = await this.handleVehicleAddition(
      accountid,
      vin,
      licenseplate,
      vehiclemobile,
      userid,
      taskid,
      accountname,
      original_input
    );
    if (vehicleResult) return vehicleResult;
    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      account,
      original_input,
      userid,
      "Vehicle assignment successful",
      {},
      "VEHICLE_ASSIGNMENT_SUCCESS"
    );

    const manualreview = await this.handleManualreviewCases(
      original_input,
      existingmobile,
      existingemail,
      userid,
      taskid
    );
    if (manualreview) {
      return manualreview;
    }

    // Create user
    let user = null;
    if (existingmobile !== null && existingemail !== null) {
      user = await this.userSvcI.GetUserDetails(existingemail);
      const userinfotabledata = await this.pUserSvcI.GetUserInfo(user.userid);
      await this.handleUserInfoUpdate(
        user.userid,
        userinfotabledata,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customerdateofbirth,
        customergender,
        userid
      );
      action = "USER_ALREADY_EXISTS";
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    } else if (existingmobile !== null && existingemail === null) {
      user = await this.userSvcI.GetUserDetails(existingmobile);
      const userinfotabledata = await this.pUserSvcI.GetUserInfo(user.userid);
      await this.handleUserInfoUpdate(
        user.userid,
        userinfotabledata,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customerdateofbirth,
        customergender,
        userid
      );
      action = "USER_ALREADY_EXISTS";
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
    } else {
      user = await this.TaskCreateUser(
        taskid,
        null, //usertype
        userid,
        original_input,
        usermobile,
        processedcustomername,
        customercontactemail,
        {
          address: customeraddress,
          city: customeraddresscity,
          country: customeraddresscountry,
          pincode: customeraddresspincode,
          email: customercontactemail,
          vehiclemobile: vehiclemobile,
          dateofbirth: customerdateofbirth,
          gender: customergender,
          displayname: processedcustomername,
          mobile: usermobile,
        },
        accountid
      );
      // Add user info
      if (user) {
        await this.AddUserInfo(
          user.userid,
          customeraddress,
          customeraddresscity,
          customeraddresscountry,
          customeraddresspincode,
          customerdateofbirth,
          customergender,
          userid
        );
        await this.AddUserToReviewDone(
          taskid,
          user,
          userid,
          original_input,
          {}
        );
      }
      action = "USER_CREATED";
    }

    // Add user to account
    const userAdditionResult = await this.handleUserAdditionToAccount(
      userid,
      usermobile,
      accountid,
      taskid,
      accountname,
      original_input,
      user.userid,
      userrole
    );
    if (userAdditionResult) return userAdditionResult;
    await this.AddAccountToReviewDone(
      taskid,
      accountname,
      account,
      original_input,
      userid,
      "User assignment successful",
      {},
      "USER_ASSIGNMENT_SUCCESS"
    );

    return {
      userid: user.userid,
      accountid: accountid,
      userCreationAction: action,
      status: "ONBOARDED_SUCCESS",
      message:
        "Account and User created. User and Vehicle assigned to Account.",
    };
  }

  convertDateFormat = (dateString) => {
    if (!dateString) return null;

    try {
      // Parse DD/MM/YY format and convert to YYYY-MM-DD
      const parts = dateString.split("/");
      if (parts.length === 3) {
        const day = parts[0];
        const month = parts[1];
        const year = parts[2];

        // Convert 2-digit year to 4-digit year
        const fullYear = year.length === 2 ? `20${year}` : year;

        // Return in ISO format YYYY-MM-DD
        return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
      }

      return dateString; // Return as-is if not in expected format
    } catch (error) {
      this.logger.error("Date conversion error:", error);
      return null;
    }
  };

  // Main function refactored to use helper functions
  OnboardUserAccountLogic = async (
    userid,
    corporatetype,
    customeraddress,
    customeraddresscity,
    customeraddresscountry,
    customeraddresspincode,
    customercontactemail,
    customercontactmobile,
    customerdateofbirth,
    customergender,
    customername,
    customertype,
    licenseplate,
    vin,
    nemo_user_mobile,
    type,
    taskid = null,
    accountname = null,
    nemo3_account_id = null,
    userrole = "viewer"
  ) => {
    let accountcategory = "individual";
    this.onboardingType = type;
    const processedcustomername = this.preprocessingname(customername);
    const vehiclemobile = this.preprocessingmobile(customercontactmobile);
    const usermobile = this.preprocessingmobile(nemo_user_mobile);
    customeraddresscity = preprocessingText(customeraddresscity);
    let existingaccount = null;
    if (nemo3_account_id) {
      existingaccount = await this.platformSvcI.GetAccountById(
        nemo3_account_id
      );
    }
    if (accountname === null) {
      if (existingaccount) {
        accountname = existingaccount.accountname;
      } else {
        accountname = `${processedcustomername} ${usermobile}`;
      }
    }
    let pendingaccount = null;
    if (taskid === null) {
      let existingtask = null;
      existingtask =
        await this.accountSvcI.GetPendingAccountReviewByAccountName(
          processedcustomername,
          vin
        );
      if (existingtask) {
        taskid = existingtask;
      } else {
        existingtask =
          await this.accountSvcI.GetPendingAccountReviewByAccountName(
            accountname,
            vin
          );
        if (existingtask) {
          taskid = existingtask;
        } else {
          const existingusertask =
            await this.pUserSvcI.GetPendingUserReviewByUserName(
              processedcustomername,
              vin
            );
          if (existingusertask) {
            taskid = existingusertask;
          } else {
            taskid = uuidv4();
          }
        }
      }
    } else {
      pendingaccount = await this.accountSvcI.GetPendingAccountReviewById(
        taskid
      );
    }

    const original_input = {
      corporatetype: corporatetype,
      customertype: customertype,
      customeraddress: customeraddress,
      customeraddresscity: customeraddresscity,
      customeraddresscountry: customeraddresscountry,
      customeraddresspincode: customeraddresspincode,
      customercontactemail: customercontactemail,
      customercontactmobile: vehiclemobile,
      customerdateofbirth: customerdateofbirth
        ? this.convertDateFormat(customerdateofbirth)
        : null,
      customergender: customergender,
      customername: processedcustomername,
      licenseplate: licenseplate,
      vin: vin,
      nemo_user_mobile: usermobile,
      nemo3_account_id: nemo3_account_id,
      userrole: userrole,
    };

    if (customertype.toLowerCase() === CUSTOMER_TYPE_INDIVIDUAL) {
      accountcategory = "individual";
      const existingmobile = await this.userSvcI.CheckMobileExists(usermobile);
      if (existingaccount === null) {
        existingaccount = await this.platformSvcI.GetAccountByName(accountname);
        if (existingaccount) {
          accountname = existingaccount.accountname;
        }
      }

      if (existingaccount === null) {
        if (
          existingmobile === null ||
          (pendingaccount &&
            pendingaccount.status === "DUPLICATE_ACCOUNT_CREATION" &&
            pendingaccount.error_status === "ACCOUNT_CREATION" &&
            type === "review")
        ) {
          return await this.handleIndividualCustomerOnboarding(
            taskid,
            accountname,
            userid,
            original_input,
            existingmobile,
            usermobile,
            processedcustomername,
            customercontactemail,
            customeraddress,
            customeraddresscity,
            customeraddresscountry,
            customeraddresspincode,
            customerdateofbirth,
            customergender,
            vehiclemobile,
            vin,
            licenseplate,
            accountcategory
          );
        } else {
          await this.AddAccountToReviewPending(
            taskid,
            accountname,
            original_input,
            "ACCOUNT_CREATION",
            userid,
            `Duplicate account creation when User is already present with for the given contact onboarding failed.`,
            "DUPLICATE_ACCOUNT_CREATION"
          );

          const user = await this.userSvcI.GetUserDetails(existingmobile);

          return {
            userid: user.userid,
            errcode: "DUPLICATE_ACCOUNT_CREATION",
            status: "DUPLICATE_ACCOUNT_CREATION",
            message: "Duplicate account creation.",
          };
        }
      } else if (existingaccount !== null) {
        return await this.handleExistingIndividualAccount(
          taskid,
          existingaccount,
          existingmobile,
          usermobile,
          processedcustomername,
          customercontactemail,
          customeraddress,
          customeraddresscity,
          customeraddresscountry,
          customeraddresspincode,
          customerdateofbirth,
          customergender,
          vehiclemobile,
          vin,
          licenseplate,
          userid,
          original_input,
          accountname
        );
      }
    } else if (customertype.toLowerCase() === CUSTOMER_TYPE_CORPORATE) {
      accountcategory = "corporate";
      const existingmobile = await this.userSvcI.CheckMobileExists(usermobile);
      const existingemail = await this.userSvcI.CheckEmailExists(
        customercontactemail
      );
      return await this.handleCorporateCustomerOnboarding(
        taskid,
        accountname,
        userid,
        original_input,
        existingmobile,
        existingemail,
        usermobile,
        processedcustomername,
        customercontactemail,
        customeraddress,
        customeraddresscity,
        customeraddresscountry,
        customeraddresspincode,
        customerdateofbirth,
        customergender,
        vehiclemobile,
        vin,
        licenseplate,
        nemo3_account_id,
        userrole,
        accountcategory
      );
    }
  };

  // Composite Onboard API Logic
  CompositeOnboardAPILogic = async ({
    userid,
    taskid,
    tasktype,
    updatedfields,
  }) => {
    try {
      if (tasktype === "accountreview") {
        const pendingaccount =
          await this.accountSvcI.GetPendingAccountReviewById(taskid);
        if (pendingaccount) {
          return await this.handleAccountReview(
            taskid,
            pendingaccount,
            userid,
            updatedfields
          );
        }
      } else if (tasktype === "userreview") {
        const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(
          taskid
        );
        if (pendinguser) {
          return await this.handleUserReviewError(
            taskid,
            pendinguser,
            userid,
            updatedfields
          );
        }
      }
      return {
        errcode: "INVALID_TASK_TYPE",
        status: "INVALID_TASK_TYPE",
        message: "Invalid task type or task not found",
      };
    } catch (error) {
      this.logger.error("CompositeOnboardAPILogic failed", error);
      throw error;
    }
  };

  // Handle ACCOUNT_CREATION error
  async handleAccountReview(taskid, pendingaccount, userid, updatedfields) {
    const original_input = pendingaccount.original_input;
    const accountname =
      updatedfields.accountname !== pendingaccount.accountname
        ? updatedfields.accountname
        : pendingaccount.accountname;

    return await this.OnboardUserAccountLogic(
      userid,
      original_input.corporatetype,
      original_input.customeraddress,
      original_input.customeraddresscity,
      original_input.customeraddresscountry,
      original_input.customeraddresspincode,
      original_input.customercontactemail,
      original_input.customercontactmobile,
      original_input.customerdateofbirth,
      original_input.customergender,
      original_input.customername,
      original_input.customertype,
      original_input.licenseplate,
      original_input.vin,
      original_input.nemo_user_mobile,
      "review",
      taskid,
      accountname,
      original_input.nemo3_account_id,
      original_input.userrole
    );
  }
  // Handle USER_REVIEW error
  async handleUserReviewError(taskid, pendinguser, userid, updatedfields) {
    let nemo3_account_id = null;
    const original_input = pendinguser.original_input;
    const address =
      updatedfields.address !== original_input.customeraddress
        ? updatedfields.address
        : original_input.customeraddress;
    const city =
      updatedfields.city !== original_input.customeraddresscity
        ? updatedfields.city
        : original_input.customeraddresscity;
    const country =
      updatedfields.country !== original_input.customeraddresscountry
        ? updatedfields.country
        : original_input.customeraddresscountry;
    const pincode =
      updatedfields.pincode !== original_input.customeraddresspincode
        ? updatedfields.pincode
        : original_input.customeraddresspincode;
    const email =
      updatedfields.email !== original_input.customercontactemail
        ? updatedfields.email
        : original_input.customercontactemail;
    const vehiclemobile =
      updatedfields.vehiclemobile !== original_input.customercontactmobile
        ? updatedfields.vehiclemobile
        : original_input.customercontactmobile;
    const dateofbirth =
      updatedfields.dateofbirth !== original_input.customerdateofbirth
        ? updatedfields.dateofbirth
        : original_input.customerdateofbirth;
    const gender =
      updatedfields.gender !== original_input.customergender
        ? updatedfields.gender
        : original_input.customergender;
    const displayname =
      updatedfields.displayname !== original_input.customername
        ? updatedfields.displayname
        : original_input.customername;
    const mobile =
      updatedfields.mobile !== original_input.nemo_user_mobile
        ? updatedfields.mobile
        : original_input.nemo_user_mobile;
    if (
      updatedfields.nemo3_account_id !== null &&
      updatedfields.nemo3_account_id !== undefined
    ) {
      nemo3_account_id = updatedfields.nemo3_account_id;
    } else {
      nemo3_account_id = original_input.nemo3_account_id;
    }

    const accountname = `${displayname} ${mobile}`;

    return await this.OnboardUserAccountLogic(
      userid,
      original_input.corporatetype,
      address,
      city,
      country,
      pincode,
      email,
      vehiclemobile,
      dateofbirth,
      gender,
      displayname,
      original_input.customertype,
      original_input.licenseplate,
      original_input.vin,
      mobile,
      "review",
      taskid,
      accountname,
      nemo3_account_id,
      original_input.userrole
    );
  }

  RetryOnboardLogic = async (userid, retrytype) => {
    try {
      if (retrytype === "user") {
        return await this.handleUserRetry(userid);
      } else if (retrytype === "account") {
        return await this.handleAccountRetry(userid);
      }
      return true;
    } catch (error) {
      this.logger.error("RetryUserOnboardLogic failed", error);
      throw error;
    }
  };

  handleUserRetry = async (userid) => {
    try {
      let pendingreviews = await this.pUserSvcI.ListPendingUserReviews();
      for (const review of pendingreviews) {
        const original_input = review.original_input;
        try {
          await this.OnboardUserAccountLogic(
            userid,
            original_input.corporatetype,
            original_input.customeraddress,
            original_input.customeraddresscity,
            original_input.customeraddresscountry,
            original_input.customeraddresspincode,
            original_input.customercontactemail,
            original_input.customercontactmobile,
            original_input.customerdateofbirth,
            original_input.customergender,
            original_input.customername,
            original_input.customertype,
            original_input.licenseplate,
            original_input.vin,
            original_input.nemo_user_mobile,
            "retry",
            review.userid,
            null,
            original_input.nemo3_account_id,
            original_input.userrole
          );
        } catch (error) {
          this.logger.error("RetryUserOnboardLogic failed", error);
          continue;
        }
      }
      return true;
    } catch (error) {
      this.logger.error("RetryUserOnboardLogic failed", error);
      throw error;
    }
  };

  handleAccountRetry = async (userid) => {
    try {
      let pendingreviews = await this.accountSvcI.ListPendingAccountReviews();
      for (const review of pendingreviews) {
        const original_input = review.original_input;
        try {
          await this.OnboardUserAccountLogic(
            userid,
            original_input.corporatetype,
            original_input.customeraddress,
            original_input.customeraddresscity,
            original_input.customeraddresscountry,
            original_input.customeraddresspincode,
            original_input.customercontactemail,
            original_input.customercontactmobile,
            original_input.customerdateofbirth,
            original_input.customergender,
            original_input.customername,
            original_input.customertype,
            original_input.licenseplate,
            original_input.vin,
            original_input.nemo_user_mobile,
            "retry",
            review.accountid,
            review.accountname,
            original_input.nemo3_account_id,
            original_input.userrole
          );
        } catch (error) {
          this.logger.error("RetryAccountOnboardLogic failed", error);
          continue;
        }
      }
      return true;
    } catch (error) {
      this.logger.error("RetryAccountOnboardLogic failed", error);
      throw error;
    }
  };

  GetUserAccountListLogic = async (contact, usertype) => {
    try {
      return await this.pUserSvcI.GetUserAccountList(contact, usertype);
    } catch (error) {
      this.logger.error("GetUserAccountListLogic error:", error);
      throw error;
    }
  };

  handleManualreviewCases = async (
    original_input,
    existingmobile,
    existingemail,
    userid,
    taskid
  ) => {
    const review_data = {
      address: original_input.customeraddress,
      city: original_input.customeraddresscity,
      country: original_input.customeraddresscountry,
      pincode: original_input.customeraddresspincode,
      email: original_input.customercontactemail,
      vehiclemobile: original_input.customercontactmobile,
      dateofbirth: original_input.customerdateofbirth,
      gender: original_input.customergender,
      displayname: original_input.customername,
      mobile: original_input.nemo_user_mobile,
    };
    let message = null;
    let error_status = null;
    let needreview = false;

    let user = null;
    if (existingemail !== null) {
      user = await this.userSvcI.GetUserDetails(existingemail);
    } else if (existingmobile !== null) {
      user = await this.userSvcI.GetUserDetails(existingmobile);
    }
    if (
      existingemail !== null &&
      existingmobile !== null &&
      existingemail !== existingmobile
    ) {
      message = "Email and Mobile No. is already mapped to different users.";
      error_status = "MOBILE_ALREADY_EXISTS_&_EMAIL_ALREADY_EXISTS";
      needreview = true;
    } else if (
      existingemail !== null &&
      existingmobile !== null &&
      user.displayname !== original_input.customername
    ) {
      message = "Different customer Name already exists for this user";
      error_status = "NAME_MISMATCH";
      needreview = true;
    } else if (
      existingemail === null &&
      existingmobile !== null &&
      user.displayname !== original_input.customername
    ) {
      message = "Mobile No. already exists with a different customer Name.";
      error_status = "NAME_MISMATCH";
      needreview = true;
    } else if (
      existingemail !== null &&
      existingmobile === null &&
      user.displayname === original_input.customername
    ) {
      message = "Email ID already exists with same customer Name.";
      error_status = "EMAIL_ALREADY_EXISTS_&_MOBILE_MISMATCH";
      needreview = true;
    } else if (
      existingemail !== null &&
      existingmobile === null &&
      user.displayname !== original_input.customername
    ) {
      message = "Email ID already exists with a different customer Name.";
      error_status = "NAME_MISMATCH";
      needreview = true;
    }

    if (needreview) {
      const pendinguser = await this.pUserSvcI.GetPendingUserReviewById(taskid);
      if (pendinguser) {
        await this.pUserSvcI.UpdateReviewPendingUser(
          pendinguser.userid,
          {
            displayname: original_input.customername,
            userinfo: {
              mobile: original_input.nemo_user_mobile,
              email: original_input.customercontactemail,
            },
            review_data: review_data,
            error_status: error_status,
            reason: message,
            original_input: original_input,
          },
          userid
        );
      } else {
        await this.AddUserToReviewPending(
          taskid,
          {
            displayname: original_input.customername,
            userinfo: {
              mobile: original_input.nemo_user_mobile,
              email: original_input.customercontactemail,
            },
            isenabled: false,
            isdeleted: false,
            isemailverified: false,
            ismobileverified: false,
            acceptedterms: {},
          },
          userid,
          message,
          null,
          original_input,
          review_data,
          error_status
        );
      }
      return {
        accountid: original_input.accountid,
        errcode: error_status,
        status: "PENDING_USER_CREATION",
        message: message,
      };
    }
    return null;
  };

  CreateFmsUserLogic = async (
    displayname,
    email,
    mobile,
    createdby,
    accountid = null
  ) => {
    try {
      let userid = uuidv4();
      const password = "Nemo@123";
      let hashedpassword = crypto
        .createHash("sha256")
        .update(password)
        .digest("hex");
      let encryptedpassword = await EncryptPassword(hashedpassword);
      let user = {
        userid: userid,
        displayname: displayname,
        usertype: null,
        userinfo: { email: email, mobile: mobile },
        isenabled: true,
        isdeleted: false,
        isemailverified: false,
        ismobileverified: false,
      };
      let userssoinfo = {
        email: email,
        password: encryptedpassword,
        mobile: mobile,
      };
      let res = await this.userSvcI.CreateFmsUser(
        user,
        userssoinfo,
        createdby,
        accountid
      );
      if (!res) {
        this.logger.error("Failed to create user");
        throw new Error("Failed to create user");
      }

      // TODO: there has to be auth svc integration here
      //Register user with auth service
      try {
        let authres = await this.authSvcI.CreateConsumer(user.userid);

        if (authres === undefined || authres === null || !authres) {
          this.logger.error("Failed to create user in auth service");
          // Rollback by deleting all user records
          await this.userSvcI.DeleteUserRecordsByUserid(user.userid, createdby);
          throw new Error("Failed to create user in auth service");
        }

        user.token = authres?.token;
        user.refreshtoken = authres?.refreshtoken;
      } catch (error) {
        this.logger.error("Failed to register user with auth service", error);
        // Rollback by deleting all user records
        await this.userSvcI.DeleteUserRecordsByUserid(user.userid, createdby);
        throw new Error("Failed to register user with auth service");
      }

      return {
        userid: user.userid,
        contact: { email: email, mobile: mobile },
        displayname: displayname,
        isemailverified: user.isemailverified,
        ismobileverified: user.ismobileverified,
        needsPasswordChange: user.needsPasswordChange,
        usertoken: user.token,
        refreshtoken: user.refreshtoken,
      };
    } catch (error) {
      this.logger.error("CreateFmsUserLogic error:", error);
      throw error;
    }
  };

  UserDetailsByErrorCodeLogic = async (mobile, email) => {
    try {
      return await this.pUserSvcI.UserDetailsByErrorCode(mobile, email);
    } catch (error) {
      this.logger.error("UserDetailsByErrorCodeLogic error:", error);
      throw error;
    }
  };
}
