// import { v4 as uuidv4 } from "uuid";
// import { EmailMobileValidation } from "../../../utils/commonutil.js";
// import {
//   CUSTOMER_ACCOUNT_TYPE,
//   PLATFORM_ACCOUNT_ID,
//   PLATFORM_ACCOUNT_TYPE,
//   PLATFORM_ROOT_FLEET_ID,
//   PLATFORM_ROOT_FLEET_PARENT_ID,
//   ROOT_FLEET_NAME,
// } from "../../../utils/constant.js";
// import { publishVehicleUpdate } from "../../../utils/redisnotification.js";

import { preprocessingText } from "../../../utils/commonutil.js";

export default class SubscriptionHdlrImpl {
  constructor(
    subscriptionSvcI,
    logger
  ) {
    this.subscriptionSvcI = subscriptionSvcI;
    this.logger = logger;
  }

  ListSubscriptionsLogic = async (filter) => {
    try {
        let processedfilter = preprocessingText(filter);
        let result = await this.subscriptionSvcI.ListSubscriptions(processedfilter);
        return result;
    } catch (e) {
        this.logger.error("ListSubscriptionsLogic error: ", e);
        throw e;
    }
  }
  ListSubscriptionFilterCountsLogic = async () => {
    try {
        let result = await this.subscriptionSvcI.ListSubscriptionFilterCounts();
        return result;
    } catch (e) {
        this.logger.error("ListSubscriptionFilterCountsLogic error: ", e);
        throw e;
    }
  }
}