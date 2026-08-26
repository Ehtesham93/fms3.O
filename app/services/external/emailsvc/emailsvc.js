import EmailSvcClient from "./emailsvc_client.js";
import EmailSvcDB from "./emailsvc_db.js";
import { Sleep } from "../../../utils/commonutil.js";

export default class EmailSvc {
    constructor(pgPoolI, config, logger) {
        this.config = config;
        this.logger = logger;
        this.emailSvcClient = new EmailSvcClient(config, logger);
        this.emailSvcDB = new EmailSvcDB(pgPoolI);
    }

    async Start() {
        this.runPendingEmails();
    }

    async runPendingEmails() {
        for (;;) {
            try {
                let pendingEmails = await this.emailSvcDB.getPendingEmails();
                for (let email of pendingEmails) {
                    let emailobj = email.email;
                    if (email.nretriespending <= 0) {
                        await this.emailSvcDB.deletePendingEmail(email.id);
                        continue;
                    }
                    try {
                        let res = await this.emailSvcClient.sendEmail(emailobj.from, emailobj.to, emailobj.subject, emailobj.bodycontent);
                        await this.emailSvcDB.deletePendingEmail(email.id);
                    } catch (err) {
                        await this.emailSvcDB.updatePendingEmail(email.id, email.nextattempt);
                    }
                }
            } catch (err) {
                this.logger.error(`Error processing pending email`, err);
            }
            try {
                await Sleep(5 * 1000);
            } catch (err) {
                this.logger.error(`Error sleeping`, err);
            }
        }
    }
}