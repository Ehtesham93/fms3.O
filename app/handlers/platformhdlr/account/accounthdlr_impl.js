import { v4 as uuidv4 } from "uuid";
import { EmailMobileValidation } from "../../../utils/commonutil.js";
import {
  CUSTOMER_ACCOUNT_TYPE,
  PLATFORM_ACCOUNT_ID,
  PLATFORM_ACCOUNT_TYPE,
  PLATFORM_ROOT_FLEET_ID,
  PLATFORM_ROOT_FLEET_PARENT_ID,
  ROOT_FLEET_NAME,
} from "../../../utils/constant.js";
import { publishVehicleUpdate } from "../../../utils/redisnotification.js";

import { preprocessingText } from "../../../utils/commonutil.js";

export default class AccountHdlrImpl {
  constructor(
    accountSvcI,
    userSvcI,
    authSvcI,
    fmsAccountSvcI,
    platformSvcI,
    redisSvc,
    logger
  ) {
    this.accountSvcI = accountSvcI;
    this.userSvcI = userSvcI;
    this.authSvcI = authSvcI;
    this.fmsAccountSvcI = fmsAccountSvcI;
    this.platformSvcI = platformSvcI;
    this.redisSvc = redisSvc;
    this.logger = logger;
  }

  CreateAccountLogic = async (
    accountname,
    accountinfo,
    isenabled = true,
    createdby,
    mobile,
    accountid = null,
    accountcategory = "individual"
  ) => {
    let rootfleetid = null;
    let rootfleetparentid = null;
    let accounttype = CUSTOMER_ACCOUNT_TYPE;
    let rootfleetname = ROOT_FLEET_NAME;

    if (!accountid) {
      accountid = uuidv4();
      rootfleetid = uuidv4();
      rootfleetparentid = uuidv4();
    }

    if (accountid === PLATFORM_ACCOUNT_ID) {
      rootfleetid = PLATFORM_ROOT_FLEET_ID;
      rootfleetparentid = PLATFORM_ROOT_FLEET_PARENT_ID;
      accounttype = PLATFORM_ACCOUNT_TYPE;
    }

    let account = {
      accountid: accountid,
      rootfleetid: rootfleetid,
      rootFleetParentId: rootfleetparentid,
      rootFleetName: rootfleetname,
      accountname: accountname,
      accounttype: accounttype,
      accountinfo: accountinfo,
      isenabled: isenabled,
      createdby: createdby,
      accountcategory: accountcategory,
    };

    let accountinfovalidation = EmailMobileValidation(accountinfo);

    if (!accountinfovalidation.isvalid) {
      this.logger.error(accountinfovalidation.message);
      throw new Error(accountinfovalidation.message);
    }

    let res = await this.accountSvcI.CreateAccount(account);
    if (!res) {
      this.logger.error("Failed to create account");
      throw new Error("Failed to create account");
    }
    delete account.rootfleetid;
    delete account.rootFleetParentId;
    delete account.rootFleetName;
    return {
      accountid: accountid,
      account: account,
    };
  };

  ListAccountsLogic = async (searchtext, offset, limit) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    let accounts = await this.accountSvcI.GetAllAccounts(PLATFORM_ACCOUNT_ID, offset, limit, searchtext.toUpperCase());
    return accounts;
  };

  GetAccountOverviewLogic = async (accountid) => {
    let account = await this.accountSvcI.GetAccountOverview(accountid);
    if (!account) {
      this.logger.error("Account not found");
      throw new Error("Account not found");
    }
    return { accountid: accountid, overview: account };
  };

  GetAccountSummaryLogic = async (searchtext, offset, limit, download, orderbyfield, orderbydirection) => {
    searchtext = preprocessingText(searchtext);
    orderbydirection = preprocessingText(orderbydirection);
    const getsummary = await this.accountSvcI.GetAccountSummary(searchtext, offset, limit, download, orderbyfield, orderbydirection);
    return getsummary;
  };

  GetAllAccountUsersLogic = async (searchtext, offset, limit, download) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    const getallaccountusers = await this.accountSvcI.GetAllAccountUsers(searchtext, offset, limit, download);
    return getallaccountusers;
  };


  GetAllLoggedInAccountUsersLogic = async (searchtext, offset, limit, download, orderbyfield, orderbydirection) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    const getallloggedinaccountusers = await this.accountSvcI.GetAllLoggedInAccountUsers(searchtext, offset, limit, download, orderbyfield, orderbydirection);
    return getallloggedinaccountusers;
  };

  UpdateAccountLogic = async (accountid, updateFields, updatedby) => {
    const allowedFields = ["accountname", "accountinfo", "isenabled", "mobile", "accountcategory"];

    const fieldsToUpdate = {};
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        fieldsToUpdate[key] = value;
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      throw new Error("No valid fields provided for update");
    }

    let emailmobilevalidation = EmailMobileValidation(
      fieldsToUpdate.accountinfo
    );

    if (!emailmobilevalidation.isvalid) {
      this.logger.error(emailmobilevalidation.message);
      throw new Error(emailmobilevalidation.message);
    }

    let res = await this.accountSvcI.UpdateAccount(
      accountid,
      fieldsToUpdate,
      updatedby
    );

    if (!res) {
      this.logger.error("Failed to update account");
      throw new Error("Failed to update account");
    }

    return { accountid: accountid, updatedFields: Object.keys(fieldsToUpdate) };
  };

  DeleteAccountLogic = async (accountid, deletedby) => {
    const accountInfo = await this.accountSvcI.GetAccountInfo(accountid);
    if (!accountInfo) {
      throw {
        errcode: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
      };
    }

    if (accountInfo.isdeleted) {
      throw {
        errcode: "ACCOUNT_ALREADY_DELETED",
        message: "Account is already deleted",
      };
    }

    const vehicleCount =
      await this.accountSvcI.GetAccountVehicleCount(accountid);
    if (vehicleCount > 0) {
      throw {
        errcode: "ACCOUNT_HAS_VEHICLES",
        message: `Cannot delete account. ${vehicleCount} vehicle(s) are still assigned to this account. Please remove all vehicles before deleting the account.`,
      };
    }

    let res = await this.accountSvcI.DeleteAccount(accountid, deletedby);
    if (!res) {
      this.logger.error("Failed to delete account");
      throw new Error("Failed to delete account");
    }

    return {
      accountid: accountid,
      accountname: res.accountname,
      deletedat: res.deletedat,
      deletedby: res.deletedby,
    };
  };

  AddAdminToAccRootFleetLogic = async (accountid, contact, updatedby) => {
    const accountInfo = await this.accountSvcI.GetAccountInfo(accountid);
    if (!accountInfo) {
      throw {
        errcode: "ACCOUNT_NOT_FOUND",
        message: "Account not found",
      };
    }

    if (accountInfo.isdeleted) {
      throw {
        errcode: "ACCOUNT_ALREADY_DELETED",
        message: "Account is already deleted",
      };
    }

    let res = await this.accountSvcI.AddAdminToAccRootFleet(
      accountid,
      contact,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to add admin to account root fleet");
      throw new Error("Failed to add admin to account root fleet");
    }
    return this.GetAccountUsersLogic(accountid);
  };

  GetAccountUsersLogic = async (accountid) => {
    let users = await this.accountSvcI.GetAccountUsersInfoWithRoles(accountid);
    if (!users) {
      users = [];
    }

    return { accountid: accountid, users: users };
  };

  RemoveUserFromAccountLogic = async (accountid, userid, updatedby) => {
    let res = await this.accountSvcI.RemoveUserFromAccount(
      accountid,
      userid,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to remove user from account");
      throw new Error("Failed to remove user from account");
    }
    return this.GetAccountUsersLogic(accountid);
  };

  GetAccountPkgsLogic = async (accountid) => {
    let defaultPkgs = await this.accountSvcI.GetDefaultAccountPkgs();
    if (!defaultPkgs) {
      defaultPkgs = [];
    }
    let customPkgs = await this.accountSvcI.GetCustomAccountPkgs(accountid);
    if (!customPkgs) {
      customPkgs = [];
    }

    // Get subscription info to determine which package is currently subscribed
    let subscription = await this.accountSvcI.GetSubscriptionInfo(accountid);
    let activepkgid = subscription?.pkgid;

    // Calculate total credits for default packages
    for (let pkg of defaultPkgs) {
      let totalcredits = 0;
      if (pkg.modules && pkg.modules.length > 0) {
        for (let module of pkg.modules) {
          totalcredits += Number(module.creditspervehicleday);
        }
      }
      pkg.totalcredits = totalcredits;

      // Add subscription information
      pkg.issubscribed = pkg.pkgid === activepkgid;
      if (pkg.issubscribed && subscription) {
        pkg.subscriptioninfo = {
          startdate: subscription.subscriptioninfo.startdate,
          enddate: subscription.subscriptioninfo.enddate,
        };
      }
    }

    // Calculate total credits for custom packages
    for (let pkg of customPkgs) {
      let totalcredits = 0;
      if (pkg.modules && pkg.modules.length > 0) {
        for (let module of pkg.modules) {
          totalcredits += Number(module.creditspervehicleday);
        }
      }
      pkg.totalcredits = totalcredits;

      // Add subscription information
      pkg.issubscribed = pkg.pkgid === activepkgid;
      if (pkg.issubscribed && subscription) {
        pkg.subscriptioninfo = {
          startdate: subscription.subscriptioninfo.startdate,
          enddate: subscription.subscriptioninfo.enddate,
        };
      }
    }

    return {
      accountid: accountid,
      defaultpkgs: defaultPkgs,
      custompkgs: customPkgs,
    };
  };

  GetUnassignedCustomPkgsLogic = async (accountid) => {
    let customPkgs = await this.accountSvcI.GetUnassignedCustomPkgs(accountid);
    if (!customPkgs) {
      customPkgs = [];
    }
    let subscription = await this.accountSvcI.GetSubscriptionInfo(accountid);
    let activepkgid = subscription?.pkgid;

    for (let pkg of customPkgs) {
      // Get package modules with credits information
      let pkgWithModules = await this.accountSvcI.GetPkgInfoWithModules(
        pkg.pkgid
      );

      if (pkgWithModules && pkgWithModules.modules) {
        pkg.modules = pkgWithModules.modules;
        pkg.totalcredits = pkgWithModules.pkgcredits || 0;
      } else {
        pkg.modules = [];
        pkg.totalcredits = 0;
      }

      // Add subscription information
      pkg.issubscribed = pkg.pkgid === activepkgid;
      if (pkg.issubscribed && subscription) {
        pkg.subscriptioninfo = {
          startdate: subscription.subscriptioninfo.startdate,
          enddate: subscription.subscriptioninfo.enddate,
        };
      }
    }

    return {
      accountid: accountid,
      custompkgs: customPkgs,
    };
  };

  AddCustomPkgToAccountLogic = async (accountid, pkgids, updatedby) => {
    let res = await this.accountSvcI.AddCustomPkgToAccount(
      accountid,
      pkgids,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to add custom package to account");
      throw new Error("Failed to add custom package to account");
    }
    return this.GetAccountPkgsLogic(accountid);
  };

  RemoveCustomPkgFromAccountLogic = async (accountid, pkgid, updatedby) => {
    let res = await this.accountSvcI.RemoveCustomPkgFromAccount(
      accountid,
      pkgid,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to remove custom package from account");
      throw new Error("Failed to remove custom package from account");
    }

    return this.GetAccountPkgsLogic(accountid);
  };

  MahindrassoInviteToRootFleetLogic = async (
    accountid,
    email,
    invitedby,
    roles,
    headerReferer
  ) => {
    let inviteid = uuidv4();
    let res = await this.accountSvcI.MahindrassoInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roles,
      headerReferer
    );
    if (!res) {
      this.logger.error("Failed to create invite email");
      throw new Error("Failed to create invite email");
    }
    return {
      accountid: accountid,
      fleetid: res.fleetid,
      roles: roles,
      inviteid: res.inviteid,
      contact: email,
    };
  };

  EmailInviteToRootFleetLogic = async (
    accountid,
    email,
    invitedby,
    roles,
    headerReferer
  ) => {
    let inviteid = uuidv4();
    let res = await this.accountSvcI.EmailInviteToRootFleet(
      accountid,
      inviteid,
      email,
      invitedby,
      roles,
      headerReferer
    );
    if (!res) {
      this.logger.error("Failed to create invite email");
      throw new Error("Failed to create invite email");
    }
    return {
      accountid: accountid,
      fleetid: res.fleetid,
      roles: roles,
      inviteid: res.inviteid,
      contact: email,
    };
  };

  MobileInviteToRootFleetLogic = async (
    accountid,
    mobile,
    invitedby,
    roles,
    headerReferer
  ) => {
    let inviteid = uuidv4();
    let res = await this.accountSvcI.MobileInviteToRootFleet(
      accountid,
      inviteid,
      mobile,
      invitedby,
      roles,
      headerReferer
    );
    if (!res) {
      this.logger.error("Failed to create invite sms");
      throw new Error("Failed to create invite sms");
    }
    return {
      accountid: accountid,
      fleetid: res.fleetid,
      roles: roles,
      inviteid: inviteid,
      contact: mobile,
    };
  };

  ListInvitesOfAccountLogic = async (accountid) => {
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

  ResendInviteLogic = async (accountid, inviteid, invitedby, headerReferer) => {
    let res = await this.accountSvcI.ResendInvite(
      accountid,
      inviteid,
      invitedby,
      headerReferer
    );
    if (!res) {
      this.logger.error("Failed to resend invite");
      throw new Error("Failed to resend invite");
    }
    return {
      accountid: accountid,
      fleetid: res.fleetid,
      roles: res.roles,
      inviteid: inviteid,
      contact: res.inviteemail,
    };
  };

  CancelEmailInviteLogic = async (accountid, inviteid, cancelledby) => {
    let result = await this.fmsAccountSvcI.CancelEmailInvite(
      accountid,
      inviteid,
      cancelledby
    );
    if (!result) {
      this.logger.error("Failed to cancel email invite");
      throw new Error("Failed to cancel email invite");
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

  ResendPlatformInviteLogic = async (inviteid, resendedby) => {
    let accountid = "ffffffff-ffff-ffff-ffff-ffffffffffff";
    let result = await this.accountSvcI.ResendInvite(
      accountid,
      inviteid,
      resendedby
    );
    if (!result) {
      this.logger.error("Failed to resend platform invite");
      throw new Error("Failed to resend platform invite");
    }
    return result;
  };

  ListPackagesForSubscriptionLogic = async (accountid) => {
    let defaultPkgs = await this.accountSvcI.GetDefaultAccountPkgs();
    if (!defaultPkgs) {
      defaultPkgs = [];
    }
    let customPkgs = await this.accountSvcI.GetCustomAccountPkgs(accountid);
    if (!customPkgs) {
      customPkgs = [];
    }

    // get active subscription info
    let subscription = await this.accountSvcI.GetSubscriptionInfo(accountid);
    let activepkgid = subscription?.pkgid;

    let pkgs = defaultPkgs.concat(customPkgs);
    pkgs = pkgs.filter((pkg) => pkg.modules.length > 0);
    for (let pkg of pkgs) {
      pkg.issubscribed = pkg.pkgid === activepkgid;
      let pkgcost = 0;
      for (let module of pkg.modules) {
        pkgcost += Number(module.creditspervehicleday);
      }
      pkg.pkgcost = pkgcost;
    }
    return { pkgs: pkgs };
  };

  CalculateSubscriptionCostLogic = async (
    accountid,
    pkgid,
    vehdays,
    discountpercent,
    startdate,
    enddate
  ) => {
    let pkg = await this.accountSvcI.GetPkgInfoWithModules(pkgid);
    if (!pkg) {
      this.logger.error("Package not found");
      throw new Error("Package not found");
    }

    let totalcredits = pkg.pkgcredits;
    let days = (enddate - startdate) / (1000 * 60 * 60 * 24);
    totalcredits = totalcredits * vehdays * days;
    let discountcredits = (totalcredits * discountpercent) / 100;
    let billablecredits = totalcredits - discountcredits;
    let costpercredit = 10;
    let billablecost = billablecredits * costpercredit;
    return {
      pkgid: pkgid,
      vehdays: vehdays,
      discountpercent: discountpercent,
      startdate: startdate,
      enddate: enddate,
      days: days,
      totalcredits: totalcredits,
      discountcredits: discountcredits,
      billablecredits: billablecredits,
      billablecost: billablecost,
    };
  };

  /**
   * @param {string} accountid
   * @param {string} pkgid
   * @param {string} createdby
   * @returns
   */
  CreateSubscriptionLogic = async (accountid, pkgid, createdby) => {
    let subscriptionmetadata = {
      startdate: Date.now(),
      enddate: Date.now() + 5 * 365 * 24 * 60 * 60 * 1000, // TODO: remove this hardcoded value
    };
    let res = await this.accountSvcI.CreateSubscription(
      accountid,
      pkgid,
      subscriptionmetadata,
      createdby
    );
    if (!res) {
      this.logger.error("Failed to create subscription");
      throw new Error("Failed to create subscription");
    }
    return {
      subscription: subscriptionmetadata,
    };
  };

  GetSubscriptionInfoLogic = async (accountid) => {
    let subscription = await this.accountSvcI.GetSubscriptionInfo(accountid);
    if (!subscription) {
      this.logger.error("Subscription not found");
      // throw new Error("Subscription not found");
    } else {
      subscription.issubscribed = true; // TODO: seems unnecessary
    }
    return { accountid: accountid, subscription: subscription };
  };

  GetAccountCreditsLogic = async (accountid) => {
    let credits = await this.fmsAccountSvcI.GetAccountCredits(accountid);
    if (!credits) {
      credits = 0;
    }
    return { accountid: accountid, credits: credits };
  };

  UpdateAccountCreditsLogic = async (accountid, credits, updatedby) => {
    let updatedcredits = await this.fmsAccountSvcI.UpdateAccountCredits(
      accountid,
      credits,
      updatedby
    );
    if (!updatedcredits) {
      this.logger.error("Failed to update account credits");
      throw new Error("Failed to update account credits");
    }
    return { accountid: accountid, credits: updatedcredits };
  };

  GetAccountCreditsOverviewLogic = async (accountid, starttime, endtime) => {
    let overview = await this.fmsAccountSvcI.GetAccountCreditsOverview(
      accountid,
      starttime,
      endtime
    );

    const chartData = {
      accountid: accountid,
      credits: {
        dates: [], // targetdate values for x-axis
        creditsadded: [],
        creditsconsumed: [],
      },
      vehicles: {
        dates: [], // targetdate values for x-axis
        totalvehicles: [],
        subscribedvehicles: [],
        connectedvehicles: [],
      },
    };

    overview.forEach((item) => {
      chartData.credits.dates.push(item.targetdate);
      chartData.vehicles.dates.push(item.targetdate);

      chartData.credits.creditsadded.push(item.creditsadded || 0);
      chartData.credits.creditsconsumed.push(-(item.creditsconsumed || 0));

      chartData.vehicles.totalvehicles.push(item.totalvehicles || 0);
      chartData.vehicles.subscribedvehicles.push(item.subscribedvehicles || 0);
      chartData.vehicles.connectedvehicles.push(item.connectedvehicles || 0);
    });

    return chartData;
  };

  GetAccountCreditsHistoryLogic = async (accountid, starttime, endtime) => {
    let history = await this.fmsAccountSvcI.GetAccountCreditsHistory(
      accountid,
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    // TODO: do we want to show credits delta
    return { accountid: accountid, history: history };
  };

  GetAccountVehicleCreditsHistoryLogic = async (
    accountid,
    vinno,
    starttime,
    endtime
  ) => {
    let isVehicleInAccount = await this.accountSvcI.IsVehicleInAccount(
      accountid,
      vinno
    );
    if (!isVehicleInAccount) {
      throw {
        errcode: "INPUT_ERROR",
        errdata: "Vehicle not found in account",
        message: "Vehicle not found in account",
      };
    }

    let history = await this.fmsAccountSvcI.GetAccountVehicleCreditsHistory(
      accountid,
      [vinno],
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    return history;
  };

  GetAccountAllFleetsCreditsHistoryLogic = async (
    accountid,
    starttime,
    endtime
  ) => {
    let allvehiclesinfo = await this.ListAccountVehiclesLogic(accountid);
    if (!allvehiclesinfo || allvehiclesinfo.vehicles.length === 0) {
      return [];
    }
    let vehicles = allvehiclesinfo.vehicles.map((v) => v.vinno);

    let history = await this.fmsAccountSvcI.GetAccountVehicleCreditsHistory(
      accountid,
      vehicles,
      starttime,
      endtime
    );
    if (!history) {
      history = [];
    }
    return history;
  };

  ListAccountVehiclesLogic = async (accountid) => {
    let vehicles = await this.accountSvcI.GetAccountVehicles(accountid);

    if (!vehicles) {
      vehicles = [];
    }

    vehicles = vehicles.map((vehicle) => {
      let status = "NOTSUBSCRIBED";

      if (vehicle.subscription && vehicle.subscription.state === 1) {
        status = "SUBSCRIBED";
      }

      return {
        ...vehicle,
        status: status,
      };
    });

    return { accountid: accountid, vehicles: vehicles };
  };

  SubscribeVehiclesLogic = async (accountid, vinnos, updatedby) => {
    // i think we should either subscribe all vehicles at once or let the user know that they can't subscribe to all and hence, force them to select fewer
    let res = await this.accountSvcI.SubscribeVehicles(
      accountid,
      vinnos,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to subscribe vehicles");
      throw new Error("Failed to subscribe vehicles");
    }
    return { accountid: accountid, vinnos: vinnos };
  };

  UnsubscribeVehicleLogic = async (accountid, vinno, updatedby) => {
    let res = await this.accountSvcI.UnsubscribeVehicle(
      accountid,
      vinno,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to unsubscribe vehicle");
      throw new Error("Failed to unsubscribe vehicle");
    }
    return {
      accountid: accountid,
      vinno: vinno,
      credits: res.credits,
    };
  };

  CheckChangeSubscriptionPackageLogic = async (accountid, newpkgid) => {
    let res = await this.accountSvcI.CheckChangeSubscriptionPackage(
      accountid,
      newpkgid
    );
    if (!res) {
      this.logger.error("Failed to check change subscription package");
      throw new Error("Failed to check change subscription package");
    }
    return { accountid: accountid, pkgid: newpkgid, subscriptioninfo: res };
  };

  ChangeSubscriptionPackageLogic = async (accountid, newpkgid, updatedby) => {
    let currentTime = new Date();
    let endTime = new Date(currentTime);
    endTime.setFullYear(endTime.getFullYear() + 5);

    let subscriptioninfo = {
      startdate: currentTime.toISOString(),
      enddate: endTime.toISOString(),
    };

    let res = await this.accountSvcI.ChangeSubscriptionPackage(
      accountid,
      newpkgid,
      subscriptioninfo,
      updatedby
    );
    if (!res) {
      this.logger.error("Failed to change subscription package");
      throw new Error("Failed to change subscription package");
    }

    const formattedSubscriptionInfo = {
      startdate: this.formatDateToDDMMMYYYY(subscriptioninfo.startdate),
      enddate: this.formatDateToDDMMMYYYY(subscriptioninfo.enddate),
    };

    return {
      accountid: accountid,
      pkgid: newpkgid,
      subscription: formattedSubscriptionInfo,
    };
  };

  GetSubscriptionHistoryLogic = async (accountid) => {
    let history = await this.accountSvcI.GetSubscriptionHistory(accountid);
    if (!history) {
      history = [];
    }
    return { accountid: accountid, history: history };
  };

  GetAllFleetsWithVinInfoLogic = async (accountid, recursive) => {
    try {
      let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
      if (!rootFleetId) {
        throw new Error("Root fleet not found for account");
      }

      let rootFleetHierarchy = await this.buildFleetHierarchyWithVinInfo(
        accountid,
        rootFleetId,
        recursive
      );

      return rootFleetHierarchy;
    } catch (error) {
      this.logger.error("Error in GetAllFleetsWithVinInfo:", error);
      throw error;
    }
  };

  buildFleetHierarchyWithVinInfo = async (accountid, fleetid, recursive) => {
    try {
      let fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(
        accountid,
        fleetid
      );
      if (!fleetInfo) {
        return null;
      }

      let vehicleCount = 0;
      let vehicles = [];
      if (recursive) {
        vehicles = await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          true
        );
        vehicleCount = vehicles ? vehicles.length : 0;
      } else {
        vehicles = await this.fmsAccountSvcI.GetVehicles(
          accountid,
          fleetid,
          false
        );
        vehicleCount = vehicles ? vehicles.length : 0;
      }

      let subFleets = await this.fmsAccountSvcI.GetSubFleets(
        accountid,
        fleetid,
        false
      );

      let fleetHierarchy = {
        fleetid: fleetInfo.fleetid,
        fleetname: fleetInfo.fleetname,
        noofvehicle: vehicleCount,
        vehicles: vehicles,
        childfleets: [],
      };

      if (subFleets && subFleets.length > 0) {
        for (let subFleet of subFleets) {
          let childHierarchy = await this.buildFleetHierarchyWithVinInfo(
            accountid,
            subFleet.fleetid,
            recursive
          );
          if (childHierarchy) {
            fleetHierarchy.childfleets.push(childHierarchy);
          }
        }
      }

      return fleetHierarchy;
    } catch (error) {
      this.logger.error(
        `Error building hierarchy for fleet ${fleetid}:`,
        error
      );
      try {
        let fleetInfo = await this.fmsAccountSvcI.GetFleetInfo(
          accountid,
          fleetid
        );
        return {
          fleetid: fleetInfo.fleetid,
          fleetname: fleetInfo.fleetname,
          noofvehicle: 0,
          childfleets: [],
        };
      } catch (fallbackError) {
        this.logger.error(
          `Fallback error for fleet ${fleetid}:`,
          fallbackError
        );
        return null;
      }
    }
  };

  AddVehicleToAccountLogic = async (accountid, vehicleinfo, assignedby) => {
    let res = await this.accountSvcI.AddVehicleToAccount(
      accountid,
      vehicleinfo,
      assignedby
    );
    if (!res) {
      this.logger.error("Failed to add vehicle to account");
      throw new Error("Failed to add vehicle to account");
    }

    let rootFleetId = await this.fmsAccountSvcI.GetRootFleetId(accountid);
    if (!rootFleetId) {
      rootFleetId = null;
    }
    // set and publish vehicle update
    const message = {
      srcfleetid: rootFleetId,
      dstfleetid: rootFleetId,
      srcaccountid: accountid,
      dstaccountid: accountid,
      action: "ADDED",
      description: "Vehicle added to account",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      accountid,
      message,
      this.redisSvc,
      this.logger
    );

    return { accountid: accountid, fleetid: res.fleetid, vehicle: res.vehicle };
  };

  RemoveVehicleFromAccountLogic = async (accountid, vinno, removedby) => {
    const vehicleExists = await this.platformSvcI.CheckVehicleExists(vinno);
    if (!vehicleExists) {
      throw {
        errcode: "VEHICLE_NOT_FOUND",
        message: "Vehicle not found",
      };
    }

    const vehicleFleetInfo = await this.accountSvcI.GetVehicleFleetInfo(vinno, accountid);
    if (!vehicleFleetInfo) {
      throw {
        errcode: "VEHICLE_NOT_IN_FLEET",
        message: "Vehicle not found in fleet",
      };
    }
    if (!vehicleFleetInfo.isowner) {
      throw {
        errcode: "VEHICLE_NOT_OWNED",
        message: "Vehicle is not owned by this account",
      };
    }

    let res = await this.accountSvcI.RemoveVehicleFromAccount(
      accountid,
      vinno,
      removedby
    );
    if (!res) {
      this.logger.error("Failed to remove vehicle from account");
      throw new Error("Failed to remove vehicle from account");
    }
    const message = {
      srcfleetid: vehicleFleetInfo.fleetid,
      dstfleetid: vehicleFleetInfo.fleetid,
      srcaccountid: accountid,
      dstaccountid: accountid,
      action: "REMOVED",
      description: "Vehicle removed from account",
      timestamp: new Date().toISOString(),
    }
    // set and publish vehicle update
    await publishVehicleUpdate(
      accountid,
      message,
      this.redisSvc,
      this.logger
    );

    return { accountid: accountid, vinno: vinno };
  };

  ListAssignableVehiclesLogic = async (accountid) => {
    let vehicles = await this.accountSvcI.GetAssignableVehicles(accountid);
    if (!vehicles) {
      vehicles = [];
    }
    return { vehicles: vehicles };
  };

  ListPendingAccountsLogic = async (searchtext, offset, limit, orderbyfield, orderbydirection, download) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = this.preprocessingAccountName(searchtext);
    }
    orderbyfield = preprocessingText(orderbyfield);
    orderbyfield = orderbyfield.toLowerCase();
    orderbydirection = preprocessingText(orderbydirection);
    let accounts = await this.accountSvcI.ListPendingAccounts(searchtext, offset, limit, orderbyfield, orderbydirection, download);
    if (!accounts) {
      accounts = [];
    }
    return accounts;
  };

  ListDoneAccountsLogic = async (searchtext, offset, limit, orderbyfield, orderbydirection, download) => {
    const emailregex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailregex.test(searchtext)) {
      searchtext = preprocessingText(searchtext);
    }
    orderbyfield = preprocessingText(orderbyfield);
    orderbyfield = orderbyfield.toLowerCase();
    orderbydirection = preprocessingText(orderbydirection);
    let accounts = await this.accountSvcI.ListDoneAccounts(searchtext, offset, limit, orderbyfield, orderbydirection, download);
    if (!accounts) {
      accounts = [];
    }
    return accounts;
  };

  formatDateToDDMMMYYYY(date) {
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const d = new Date(date);
    const day = d.getDate().toString().padStart(2, "0");
    const month = months[d.getMonth()];
    const year = d.getFullYear();

    return `${day} ${month} ${year}`;
  }

  IsAccountNameAvailableLogic = async (accountname) => {
    try {
      const result =  await this.platformSvcI.GetAccountByName(accountname);
      if(result){
        return false;
      }
      return true;
    } catch (error) {
      this.logger.error("IsAccountNameAvailableLogic error:", error);
      throw error;
    }
  };

  ListAllAccountsLogic = async () => {
    let accounts = await this.accountSvcI.ListAllAccounts();
    return accounts;
  };


  preprocessingAccountName = (name) => {
    return name
      .toUpperCase() // Convert to uppercase
      .replace(/[^A-Z0-9\s]/g, " ") // Replace anything other than alphabets, numbers, and spaces with space
      .replace(/\s+/g, " ") // Replace multiple whitespaces with single space
      .trim(); // Trim leading and trailing whitespaces
  };

  CreateCorporateAccountLogic = async (
    accountname,
    email,
    mobile,
    isenabled = true,
    createdby,
    accountcategory = "individual"
  ) => {
    const accountid = uuidv4();
    const rootfleetid = uuidv4();
    const rootfleetparentid = uuidv4();
    const accounttype = CUSTOMER_ACCOUNT_TYPE;
    const rootfleetname = ROOT_FLEET_NAME;
    const accountinfo = {
      primarycontact:{emaillist: [email], mobilelist: [mobile]},
    };
    const processedaccountname = this.preprocessingAccountName(accountname);
    let account = {
      accountid: accountid,
      rootfleetid: rootfleetid,
      rootFleetParentId: rootfleetparentid,
      rootFleetName: rootfleetname,
      accountname: processedaccountname,
      accounttype: accounttype,
      accountinfo: accountinfo,
      isenabled: isenabled,
      createdby: createdby,
      accountcategory: accountcategory,
    };

    try {
      const res = await this.accountSvcI.CreateAccount(account);
      if (!res) {
        this.logger.error("Failed to create account");
        throw new Error("Failed to create account");
      }
    } catch (error) {
      if (error.errcode === "ACCOUNT_ALREADY_EXISTS") {
        const existingaccount = await this.platformSvcI.GetAccountByName(processedaccountname);
        if (!existingaccount) {
          throw new Error("Account not found");
        }
        
        return {
          accountid: existingaccount.accountid,
          account: {
            accountid: existingaccount.accountid,
            accountname: existingaccount.accountname,
            email: existingaccount.accountinfo.email,
            mobile: existingaccount.accountinfo.mobile,
            isenabled: existingaccount.isenabled,
            createdat: existingaccount.createdat,
          },
          action: "ACCOUNT_ALREADY_EXISTS",
          alreadyExists: true,
        };  
      } else {
        throw error;
      }
    }
    
    delete account.rootfleetid;
    delete account.rootFleetParentId;
    delete account.rootFleetName;
    delete account.accounttype
    return {
      accountid: accountid,
      account: account,
      action: "ACCOUNT_CREATED",
    };
  };

  AccountsAvailableForTaggingLogic = async (vinno, searchtext, offset, limit) => {
    searchtext = preprocessingText(searchtext);
    let accounts = await this.accountSvcI.AccountsAvailableForTagging(PLATFORM_ACCOUNT_ID, vinno, searchtext, offset, limit);
    return accounts;
  };

  GetAccountCategoryLogic = async () => {
    let accountcategories = await this.accountSvcI.GetAccountCategory();
    return accountcategories;
  };
}
