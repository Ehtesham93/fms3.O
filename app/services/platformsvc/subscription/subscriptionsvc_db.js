// import { v4 as uuidv4 } from "uuid";
// import {
//   ACCOUNT_CREATION_CREDITS,
//   ACCOUNT_VEHICLE_SUBSCRIPTION_STATE,
//   ADMIN_ROLE_ID,
//   FLEET_INVITE_EXPIRY_TIME,
//   FLEET_INVITE_STATUS,
//   FLEET_INVITE_TYPE,
//   VEHICLE_ACTION,
//   VIEW_ROLE_ID,
//   ADMIN_PERMISSION,
//   VIEW_PERMISSION,
// } from "../../../utils/constant.js";
// import {
//   getInviteEmailTemplate,
//   isRedundantInvite,
//   markInviteAsExpired,
//   updateInviteExpiryAndSendEmail,
// } from "../../../utils/inviteUtil.js";
// import { addPaginationToQuery } from "../../../utils/commonutil.js";

export default class SubscriptionSvcDB {
  constructor(pgPoolI, logger, config) {
    this.pgPoolI = pgPoolI;
    this.logger = logger;
    this.config = config;
  }


  listSubscriptionFilterCounts = async () => {
    try {
      const query = `
                       SELECT 
                            COUNT(DISTINCT a.accountid) AS total,
                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE ass.status = 'ACTIVE' 
                                AND avs.endsat > NOW()
                            ) AS active,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE ass.accountid IS NULL
                                OR ass.status != 'ACTIVE' 
                                OR avs.endsat < NOW()
                            ) AS inactive,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE ass.status = 'ACTIVE' 
                                AND avs.endsat < NOW()
                            ) AS expired,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE ass.status = 'ACTIVE' 
                                AND avs.endsat > NOW()
                                AND avs.endsat <= NOW() + INTERVAL '2 weeks'
                            ) AS upforrenewal

                        FROM account a
                        LEFT JOIN account_vehicle_subscription avs 
                            ON avs.accountid = a.accountid
                        LEFT JOIN account_subscription_status as ass 
                            ON ass.accountid = a.accountid
                        WHERE a.isdeleted = false
                        AND a.isenabled = true AND a.accountcategory = 'corporate'
      `; 
      const result = await this.pgPoolI.Query(query);
      return result.rows[0];
    } catch (e) {
      this.logger.error("listSubscriptionFilterCounts error: ", e);
      throw e;
    }
  }


  listSubscriptions = async (filter) => {
    try {
      const query = `
        WITH subscription_data AS (
                  SELECT 
                    a.accountid,
                    a.accountname,
                    COUNT(DISTINCT avs.vinno) AS noofvehicles,
                    MAX(avs.endsat) AS subscriptionvalidity,
                    MAX(p.pkgname) AS subscriptionplan,
                    MAX(ac.credits) AS credits,
                    MAX(ass.status) AS account_status
                  FROM account a
                  LEFT JOIN account_vehicle_subscription avs 
                    ON avs.accountid = a.accountid
                  LEFT JOIN account_subscription_status ass 
                    ON ass.accountid = a.accountid
                  LEFT JOIN account_package_subscription aps 
                    ON aps.accountid = a.accountid
                  LEFT JOIN package p 
                    ON p.pkgid = aps.pkgid
                  LEFT JOIN account_credits ac 
                    ON ac.accountid = a.accountid
                  WHERE a.isdeleted = false
                    AND a.isenabled = true 
                    AND a.accountcategory = 'corporate'
                  GROUP BY a.accountid, a.accountname
                )
                SELECT *,
                  CASE
                    WHEN account_status = 'ACTIVE'
                      AND subscriptionvalidity > NOW()
                      AND subscriptionvalidity <= NOW() + INTERVAL '2 weeks'
                      THEN 'UPFORRENEWAL'
                    WHEN account_status = 'ACTIVE'
                      AND subscriptionvalidity > NOW()
                      THEN 'ACTIVE'
                    WHEN account_status = 'ACTIVE'
                      AND subscriptionvalidity < NOW()
                      THEN 'EXPIRED'
                    ELSE 'INACTIVE'
                  END AS subscriptionstatus
                FROM subscription_data
                WHERE
                  ($1 = 'ALL')
                  OR (
                    CASE
                      WHEN account_status = 'ACTIVE'
                        AND subscriptionvalidity > NOW()
                        AND subscriptionvalidity <= NOW() + INTERVAL '2 weeks'
                        THEN 'UPFORRENEWAL'
                      WHEN account_status = 'ACTIVE'
                        AND subscriptionvalidity > NOW()
                        THEN 'ACTIVE'
                      WHEN account_status = 'ACTIVE'
                        AND subscriptionvalidity < NOW()
                        THEN 'EXPIRED'
                      ELSE 'INACTIVE'
                    END = $1
                  )
      `;
  
      const result = await this.pgPoolI.Query(query, [filter]);
      return result.rows;
  
    } catch (e) {
      this.logger.error("listSubscriptions error: ", e);
      throw e;
    }
  };

  oldListSubscriptions = async () => {
    try {
      const query = `SELECT 
                            a.accountid,
                            a.accountname,
                            COUNT(DISTINCT avs.vinno) AS noofvehicles,

                            gen_random_uuid() AS subscriptionid,  -- or uuid_generate_v4()

                            CASE 
                                WHEN avs.state = 1 AND avs.endsat > NOW() 
                                    AND avs.endsat <= NOW() + INTERVAL '2 weeks'
                                    THEN 'Upforrenewal'

                                WHEN avs.state = 1 AND avs.endsat > NOW() 
                                    THEN 'Active'

                                WHEN avs.state = 1 AND avs.endsat < NOW() 
                                    THEN 'Expired'

                                WHEN avs.accountid IS NULL 
                                    OR avs.state != 1 
                                    THEN 'Inactive'

                            END AS subscriptionstatus,

                            p.pkgname AS subscriptionplan,
                            avs.endsat AS subscriptionvalidity,
                            ac.credits AS credits

                        FROM account a
                        LEFT JOIN account_vehicle_subscription avs 
                            ON avs.accountid = a.accountid
                        LEFT JOIN account_package_subscription aps 
                            ON aps.accountid = a.accountid
                        LEFT JOIN package p 
                            ON p.pkgid = aps.pkgid
                        LEFT JOIN account_credits ac 
                            ON ac.accountid = a.accountid

                        WHERE a.isdeleted = false
                        AND a.isenabled = true AND a.accountcategory = 'corporate'

                        GROUP BY 
                            a.accountid, 
                            a.accountname,
                            avs.state,
                            avs.endsat, 
                            p.pkgname,
                            ac.credits,
                            avs.accountid

                   `;
      const result = await this.pgPoolI.Query(query);
      const filterCounts = await this.oldSubscriptionListFilterCounts();
      return {
        activesubscriptions: filterCounts.active,
        inactivesubscriptions: filterCounts.inactive,
        upforrenewal: filterCounts.upforrenewal,
        expiredsubscriptions: filterCounts.expired,
        subscriptions: result.rows,
      };
    } catch (e) {
      this.logger.error("listSubscriptions error: ", e);
      throw e;
    }
  };

  oldSubscriptionListFilterCounts = async () => {
    try {
      const query = ` SELECT 
                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE avs.state = 1 
                                AND avs.endsat > NOW()
                            ) AS active,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE avs.accountid IS NULL
                                OR avs.state != 1 
                                OR avs.endsat < NOW()
                            ) AS inactive,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE avs.state = 1 
                                AND avs.endsat < NOW()
                            ) AS expired,

                            COUNT(DISTINCT a.accountid) FILTER (
                                WHERE avs.state = 1 
                                AND avs.endsat > NOW()
                                AND avs.endsat <= NOW() + INTERVAL '2 weeks'
                            ) AS upforrenewal

                        FROM account a
                        LEFT JOIN account_vehicle_subscription avs 
                            ON avs.accountid = a.accountid
                        WHERE a.isdeleted = false
                        AND a.isenabled = true AND a.accountcategory = 'corporate'
                `;
      const result = await this.pgPoolI.Query(query);
      return result.rows[0];
    } catch (e) {
      this.logger.error("subscriptionListFilterCounts error: ", e);
      throw e;
    }
  };
}
