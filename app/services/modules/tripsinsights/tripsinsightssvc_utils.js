export default function clhTripTimeBucketRange(starttime, endtime) {
  const daysInMillis = 30 * 86400000;
  const minbucket = Math.floor(starttime / daysInMillis);
  const maxbucket = Math.floor(endtime / daysInMillis);

  const count = maxbucket - minbucket + 1;
  if (count <= 0) {
    return [];
  }

  const utctimeb = [];
  for (let i = 0; i < count; i++) {
    utctimeb.push(minbucket + i);
  }

  return utctimeb;
}
