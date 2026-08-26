export default function clhTimeBucketRange(starttime, endtime) {
    // Calculate minbucket and maxbucket
    const daysInMillis = 30 * 86400000; // 30 days in milliseconds
    const minbucket = Math.floor(starttime / daysInMillis);
    const maxbucket = Math.floor(endtime / daysInMillis);

    const count = maxbucket - minbucket + 1;
    if (count <= 0) {
      return []; // Return an empty array if the count is 0 or less
    }

    const utctimeb = [];
    for (let i = 0; i < count; i++) {
      utctimeb.push(minbucket + i);
    }

    return utctimeb;
  }

//   export default function getHistoryBasedBindTimes(fleetid, vinno, starttime, endtime, accountid, userid) {
//     try {
//       // Get fleet access check
//       const fleetids = await this.fleetSvcI.getAllFleetsSubTrees(userid, accountid, "listreport");
//       if (!fleetids || fleetids.length < 1) {
//         throw new Error('Invalid user');
//       }

//       const hasfleetaccess = fleetids.includes(fleetid);
//       if (!hasfleetaccess) {
//         throw new Error('Invalid user');
//       }

//       const query = `
//         SELECT addedat, removedat 
//         FROM vehiclefleethist 
//         WHERE accountid = $1 
//         AND vinno = $2 
//         AND fleetid = ANY($3) 
//         AND (removedat > $4 OR removedat = $5) 
//         AND addedat < $6 
//         ORDER BY addedat
//       `;

//       const result = await this.pgPoolI.query(query, [
//         accountid,
//         vinno,
//         fleetids,
//         starttime - 1,
//         0,
//         endtime + 1
//       ]);

//       const bindtimes = result.rows.map(row => [row.addedat, row.removedat]);

//       if (bindtimes.length < 1) {
//         throw new Error('No bind data');
//       }

//       // Adjust the time ranges
//       if (bindtimes[0][0] < starttime) {
//         bindtimes[0][0] = starttime;
//       }

//       if (bindtimes[0][1] < endtime) {
//         bindtimes[0][1] = endtime;
//         bindtimes.length = 1; // Equivalent to bindtimes = bindtimes[:1] in Go
//       } else if (bindtimes[bindtimes.length - 1][1] > endtime || bindtimes[bindtimes.length - 1][1] === 0) {
//         bindtimes[bindtimes.length - 1][1] = endtime;
//       }

//       return bindtimes;

//     } catch (error) {
//       throw error;
//     }
//   }
