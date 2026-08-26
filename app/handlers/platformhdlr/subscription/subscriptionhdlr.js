import crypto from "crypto";
import { UAParser } from "ua-parser-js";
import z from "zod";

import {
  ADMIN_ROLE_ID,
  INVITE_RATE_LIMIT_PER_HOUR,
} from "../../../utils/constant.js";
import { CheckUserPerms } from "../../../utils/permissionutil.js";
import {
  APIResponseBadRequest,
  APIResponseError,
  APIResponseForbidden,
  APIResponseInternalErr,
  APIResponseOK,
} from "../../../utils/responseutil.js";
import { validateAllInputs } from "../../../utils/validationutil.js";
import SubscriptionHdlrImpl from "./subscriptionhdlr_impl.js";
// import { parseQueryInt } from "../../../utils/commonutil.js";

export default class SubscriptionHdlr {
  constructor(
    subscriptionSvcI,
    logger
  ) {
    this.subscriptionSvcI = subscriptionSvcI;
    this.logger = logger;
    this.subscriptionHdlrImpl = new SubscriptionHdlrImpl(
      subscriptionSvcI,
      logger
    );
  }

  RegisterRoutes(router) {
    router.get("/listsubscriptions", this.ListSubscriptions);
    router.get("/filtercounts", this.ListSubscriptionFilterCounts);
  }
  ListSubscriptions = async (req, res, next) => {
    try {
        let schema = z.object({
          filter: z
            .string({ message: "Invalid Filter format" })
            .transform((val) => val.toLowerCase())
            .refine((val) => ["all", "active", "inactive", "upforrenewal", "expired"].includes(val), { message: "Invalid Filter value" }).default("all"),
        });

        let { filter } = validateAllInputs(schema, {
          filter: req.query.filter,
        });
        let result = await this.subscriptionHdlrImpl.ListSubscriptionsLogic(filter);
        APIResponseOK(req, res, result, "Subscriptions fetched successfully");
    } catch (e) {
      this.logger.error("ListSubscriptions error: ", e);
      if(e.errcode === "INPUT_ERROR") {
        APIResponseBadRequest(req, res, e.errcode, e.errdata, e.message);
      } else {
        APIResponseInternalErr(req, res, "LIST_SUBSCRIPTIONS_ERR", e.toString(), "List subscriptions failed");
      }
    }
  }
  ListSubscriptionFilterCounts = async (req, res, next) => {
    try {
        let result = await this.subscriptionHdlrImpl.ListSubscriptionFilterCountsLogic();
        APIResponseOK(req, res, result, "Subscription filter counts fetched successfully");
    } catch (e) {
      this.logger.error("ListSubscriptionFilterCounts error: ", e);
      APIResponseInternalErr(req, res, "LIST_SUBSCRIPTION_FILTER_COUNTS_ERR", e.toString(), "List subscription filter counts failed");
    }
  }
}