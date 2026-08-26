export default class AlertSvcDB {
    /**
     *
     * @param {PgPool} pgPoolI
     */
    constructor(pgPoolI, logger) {
      this.pgPoolI = pgPoolI;
      this.logger = logger;
    }

  ListAlerts =  async () => {
    try {
      let query = `
        SELECT alertid, alertsubject FROM alert
      `;
      let result = await this.pgPoolI.Query(query);
      return result.rows;
    } catch (error) {
      throw new Error("Failed to list alerts");
    }
  };

  GetAlert = async (alertid, faultid) => {
    let [txclient, err] = await this.pgPoolI.StartTransaction();
    if (err) {
      throw err;
    }
    try {
      let query = `
        SELECT alertid, faultid, category, alerttype, severity, cta, alertsubject, notification_subject, description, notifyapp, notifyfms, notifyvmc FROM alert WHERE alertid = $1 AND faultid = $2
      `;
      let result = await txclient.query(query, [alertid, faultid]);
      if (result.rowCount !== 1) {
        throw new Error("Alert not found");
      }
      await this.pgPoolI.TxCommit(txclient);
      return result.rows[0];
    } catch (error) {
      await this.pgPoolI.TxRollback(txclient);
      throw new Error("Failed to get alert");
    }
  };

  async CreateAlert(alert){
        let [txclient, err] = await this.pgPoolI.StartTransaction();
        if (err) {
            throw err;
        }
        try {  
            let checkQuery = `
                    SELECT alertid, faultid FROM alert WHERE alertid = $1 AND faultid = $2
            `;
            let checkResult = await txclient.query(checkQuery, [alert.alertid, alert.faultid]);
            if (checkResult.rowCount > 0) {
                const rollback = await this.pgPoolI.TxRollback(txclient);
                if (rollback) {
                    throw new Error("Alert already exists for this fault");
                } 
                const error = new Error("Alert already exists for this fault");
                error.errcode = "ALERT_ALREADY_EXISTS";
                error.errdata = {
                alertid: alert.alertid,
                faultid: alert.faultid,
                };
                throw error; 
            }

            let query = `
                INSERT INTO alert (alertid, faultid, category, alerttype, severity, cta, alertsubject, notification_subject, description, notifyapp, notifyfms, notifyvmc) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `;
            let result = await txclient.query(query, [
                alert.alertid,
                alert.faultid,
                alert.category,
                alert.alerttype,
                alert.severity,
                alert.cta,
                alert.alertsubject,
                alert.notification_subject,
                alert.description,
                alert.notifyapp,
                alert.notifyfms,
                alert.notifyvmc,
            ]);
            if (result.rowCount !== 1) {
                throw new Error("Failed to create alert");
            }
            await this.pgPoolI.TxCommit(txclient);
            return alert; 
        } catch (error) {
            await this.pgPoolI.TxRollback(txclient);
            throw error;
        }
    };

    async UpdateAlert(alertid, faultid, updateFields) {
        let [txclient, err] = await this.pgPoolI.StartTransaction();
        if (err) {
            throw err;
        }
        try {
            const Fields = { ...updateFields };
            let allowedKeys = [
                "category",
                "alerttype",
                "severity",
                "cta",
                "alertsubject",
                "notification_subject",
                "description",
                "notifyapp",
                "notifyfms",
                "notifyvmc",
            ];
            let keys = [];
            let values = [];
            for (const key of allowedKeys) {
                if (Fields.hasOwnProperty(key)) {
                    keys.push(`${key} = $${keys.length + 1}`);
                    values.push(Fields[key]);
                }
            }

            if (keys.length === 0) {
                throw new Error("No valid fields provided for update");
            }

            const alertIdIndex = values.length + 1;
            values.push(alertid);

            const faultIdIndex = values.length + 1;
            values.push(faultid);

            let query = `
                UPDATE alert 
                SET ${keys.join(", ")} 
                WHERE alertid = $${alertIdIndex} AND faultid = $${faultIdIndex}
            `;
            let result = await txclient.query(query, values);
            if (result.rowCount !== 1) {
                throw new Error("Failed to update alert");
            }
           
            await this.pgPoolI.TxCommit(txclient);
            return true;
        } catch (error) {
            await this.pgPoolI.TxRollback(txclient);
            throw error;
        }
    };

    async DeleteAlert(alertid, faultid) {
        let [txclient, err] = await this.pgPoolI.StartTransaction();
        if (err) {
            throw err;
        }
        try {
            let query = `
                DELETE FROM alert WHERE alertid = $1 AND faultid = $2
            `;
            let result = await txclient.query(query, [alertid, faultid]);
            if (result.rowCount !== 1) {
                throw new Error("Failed to delete alert");
            }
            await this.pgPoolI.TxCommit(txclient);
            return alert;
        } catch (error) {
            await this.pgPoolI.TxRollback(txclient);
            throw error;
        }
    };
  }