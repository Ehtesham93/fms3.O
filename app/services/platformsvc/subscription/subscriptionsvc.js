import SubscriptionSvcDB from "./subscriptionsvc_db.js";

export default class SubscriptionSvc {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
    this.subscriptionSvcDB = new SubscriptionSvcDB(pgPoolI, logger, config);
  }

  ListSubscriptionFilterCounts = async () => {
    try {
      let result = await this.subscriptionSvcDB.listSubscriptionFilterCounts();
      return {
        total: result.total,
        activesubscriptions: result.active,
        inactivesubscriptions: result.inactive,
        upforrenewal: result.upforrenewal,
        expiredsubscriptions: result.expired,
      };
    } catch (e) {
      this.logger.error("ListSubscriptionFilterCounts error: ", e);
      throw e;
    }
  }

  ListSubscriptions = async (filter) => {
    try {
        let result = await this.subscriptionSvcDB.listSubscriptions(filter);
        return result;
    } catch (e) {
        this.logger.error("ListSubscriptions error: ", e);
        throw e;
    }
  }
}