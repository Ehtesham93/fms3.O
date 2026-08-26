export default function clhChargeTimeBucketRange(starttime, endtime) {
  // Calculate minbucket and maxbucket for monthly buckets
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
