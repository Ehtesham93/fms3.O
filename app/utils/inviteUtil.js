import { FLEET_INVITE_EXPIRY_TIME } from "./constant.js";

export function shouldUpdateExistingInvite(existingInviteRoles, targetRoles) {
  // check if any of the target roles are not in the existing invite roles
  for (const roleid of targetRoles) {
    if (!existingInviteRoles.includes(roleid)) {
      return false;
    }
  }
  return true;
}

export async function updateInviteExpiryAndSendEmail(
  accountid,
  fleetid,
  inviteid,
  info,
  currtime,
  headerReferer,
  email,
  txclient
) {
  let expiresat = new Date(currtime.getTime() + FLEET_INVITE_EXPIRY_TIME);

  // Update expiry in fleet_invite_pending (primary source of truth now)
  let query = `
      UPDATE fleet_invite_pending SET expiresat = $1, updatedat = $2 WHERE inviteid = $3
    `;
  let result = await txclient.query(query, [expiresat, currtime, inviteid]);
  if (result.rowCount !== 1) {
    throw new Error("Failed to update expiry for invite pending");
  }

  query = `
                  SELECT accountname FROM account WHERE accountid = $1 AND isdeleted = false
              `;
  result = await txclient.query(query, [accountid]);
  if (result.rowCount !== 1) {
    throw new Error("Account not found");
  }
  const accountname = result.rows[0].accountname;

  query = `
                  SELECT name FROM fleet_tree WHERE accountid = $1 AND fleetid = $2
              `;
  result = await txclient.query(query, [accountid, fleetid]);
  if (result.rowCount !== 1) {
    throw new Error("Fleet not found");
  }
  const fleetname = result.rows[0].name;

  // get email invite template
  let emailTemplate = await getInviteEmailTemplate(
    accountid,
    fleetid,
    inviteid,
    accountname,
    fleetname,
    headerReferer,
    email
  );

  query = `
                  INSERT INTO pending_email (email, nextattempt, nretriespending) VALUES ($1, $2, $3)
              `;
  result = await txclient.query(query, [emailTemplate, currtime, 5]);
  if (result.rowCount !== 1) {
    throw new Error("Failed to create pending email");
  }
}

// mark invite as expired
export async function markInviteAsExpired(
  accountid,
  fleetid,
  inviteid,
  currtime,
  expiredstatus,
  txclient
) {
  let query = `
      UPDATE fleet_invite_pending SET invitestatus = $1, updatedat = $2 WHERE inviteid = $3
    `;
  let result = await txclient.query(query, [expiredstatus, currtime, inviteid]);
  if (result.rowCount !== 1) {
    throw new Error("Failed to mark invite as expired");
  }
}

export async function isRedundantInvite(
  accountid,
  fleetid,
  email,
  targetRoleIds,
  txclient
) {
  let query = `
        SELECT userid FROM email_pwd_sso WHERE ssoid = $1
    `;
  let result = await txclient.query(query, [email]);
  if (result.rowCount !== 0) {
    // email is already registered. check if it is part of this fleet with same role
    let userid = result.rows[0].userid;
    query = `
                SELECT roleid FROM fleet_user_role WHERE accountid = $1 AND fleetid = $2 AND userid = $3
            `;
    result = await txclient.query(query, [accountid, fleetid, userid]);
    if (result.rowCount !== 0) {
      // check if we are assigning any new role to this user
      let useroleid = result.rows[0].roleid;
      let newrolefound = false;
      for (let roleid of targetRoleIds) {
        if (useroleid !== roleid) {
          newrolefound = true;
          break;
        }
      }
      if (!newrolefound) {
        return true;
      }
    }
  }
  return false;
}

export async function getInviteEmailTemplate(
  accountid,
  fleetid,
  inviteid,
  accountname,
  fleetname,
  headerReferer,
  email
) {
  try {
    let subject = `Nemo Fleet Invite to ${accountname} - ${fleetname}`;
    let inviteLink = `${headerReferer}/auth/register?inviteid=${inviteid}`;
    let body = `<!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title></title>
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
          <table
            width="100%"
            cellpadding="0"
            cellspacing="0"
            style="background-color: #ffffff"
          >
            <tr>
              <td>
                <table
                  align="center"
                  cellpadding="0"
                  cellspacing="0"
                  width="500"
                  style="margin: auto"
                >
                  <tr>
                    <td style="padding: 30px 10px 10px">
                      <div style="display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <img src="https://nemo.intellicar.io/nemo3/vehicle/model/img/mahindra_logo.png" alt="Nemo Logo" style="width: 100px;" />
                        <p
                          style="font-size: 29px; font-weight: 600; line-height: 35px"
                        >
                          Hi, Welcome to NEMO
                        </p>
                      </div>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        You've been invited to join NEMO, Mahindra Last
                        Mile Mobility's powerful connected mobility solution.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        To get started and access
                        <strong>${fleetname}</strong> fleet in 
                        <strong>${accountname}</strong> account, please accept your
                        invitation by clicking the link below.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td align="center" style="padding: 20px">
                      <a
                        href="${inviteLink}"
                        target="_blank"
                        style="
                          background-color: #1c4792;
                          color: #ffffff;
                          text-decoration: none;
                          display: inline-block;
                          padding: 10px 30px;
                          border-radius: 7px;
                          font-size: 16px;
                          font-weight: 600;
                          font-family: 'IBM Plex Sans Condensed', sans-serif;
                        "
                      >
                        Accept Invitation
                      </a>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 14px">
                        If the invitation button is disabled due to your corporate email settings, copy and paste the below link into your browser
                      </p>
                      <p style="text-align: center; font-size: 12px; word-break: break-all; color: #666;">
                        ${inviteLink}
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 10px">
                      <p style="text-align: center; font-size: 13px">
                        With NEMO, you'll have access to comprehensive tools 
                        to streamline your operations, maximize efficiency, and deliver
                        great value to your fleet. Looking forward to having you onboard!
                      </p>
                      <br />
                      <p style="text-align: center; font-size: 13px">
                        If you weren't expecting this invitation, please disregard
                        this email.
                      </p>
                    </td>
                  </tr>
          
                  <tr>
                    <td style="padding: 18px">
                      <p style="text-align: center; font-size: 13px; color: #000000">
                        Best Regards,<br />
                        Nemo Platform Team<br />
                        <span style="color: #a0a0a0"
                          >Mahindra Last Mile Mobility Ltd.</span
                        >
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>`;

    let emailTemplate = {
      from: {
        name: "Nemo",
        email: "nemo3@intellicar.in",
      },
      to: [
        {
          name: email,
          email: email,
        },
      ],
      subject: subject,
      bodycontent: {
        content: [
          {
            type: "text/html",
            value: body,
          },
        ],
      },
    };

    let jsonTemplate = JSON.stringify(emailTemplate);

    return jsonTemplate;
  } catch (error) {
    throw new Error("Failed to generate invite email template");
  }
}
