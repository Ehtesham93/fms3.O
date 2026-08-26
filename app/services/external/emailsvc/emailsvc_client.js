import axios from "axios";

export default class EmailSvcClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  // async sendEmail(fromemail, toemail, subject, emailbody) {
  //     let url = `${this.config.emailsvc.url}${this.config.emailsvc.sendEmailPath}`;
  //     let body = {
  //         accountid: this.config.emailsvc.accountid,
  //         apikey: this.config.emailsvc.apikey,
  //         msg: {
  //             from: fromemail,
  //             to: toemail,
  //             subject: subject,
  //             body: emailbody
  //         }
  //     };
  //     try {
  //         let res = await axios.post(url, body);
  //         return res.data.data;
  //     } catch (err) {
  //         this.logger.error(`Error sending email to ${toemail}`, err);
  //         throw err;
  //     }
  // }

  async sendEmail(fromemail, toemail, subject, emailbody) {
    this.logger.info("Sending email to ", toemail);
    // console.log("Email body: ", emailbody);
    // console.log("Email subject: ", subject);
    let url = `${this.config.emailsvc.url}${this.config.emailsvc.sendEmailPath}`;
    let body = {
      from: fromemail,
      to: toemail,
      subject: subject,
      body: emailbody,
    };
    try {
      let res = await axios.post(url, body);
      return res.data.data;
    } catch (err) {
      this.logger.error(`Error sending email to ${toemail}`, err);
      throw err;
    }
  }
}
