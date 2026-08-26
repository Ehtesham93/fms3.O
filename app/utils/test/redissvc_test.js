import config from "../../config/config.js";
import RedisSvc from "../redissvc.js";

const logger = console; // Use console for logging

async function runRedisTest() {
  const redisSvc = new RedisSvc(config.redis, logger);

//   // 1. Set 100 test values
//   console.log("Setting 100 test values...");
//   for (let i = 0; i < 100; i++) {
//     const key = `testkey_${i}`;
//     const value = `value_${i}`;
//     const [res, err] = await redisSvc.set(key, value);
//     if (err) {
//       console.error(`Error setting ${key}:`, err);
//     }
//   }

//   // 2. Get and verify those 100 values
//   console.log("Getting and verifying 100 test values...");
//   let allMatch = true;
//   for (let i = 0; i < 100; i++) {
//     const key = `testkey_${i}`;
//     const expected = `value_${i}`;
//     const [val, err] = await redisSvc.get(key);
//     if (err || val !== expected) {
//       allMatch = false;
//       console.error(`Mismatch or error for ${key}: got=${val}, expected=${expected}, err=${err}`);
//     }
//   }
//   if (allMatch) {
//     console.log("All values matched!");
//   }

//   // 3. Delete those 100 keys
//   console.log("Deleting 100 test keys...");
//   for (let i = 0; i < 100; i++) {
//     const key = `testkey_${i}`;
//     const [res, err] = await redisSvc.del(key);
//     if (err) {
//       console.error(`Error deleting ${key}:`, err);
//     }
//   }

//   // 4. Try to get them again to verify deletion
//   console.log("Verifying deletion of 100 test keys...");
//   let allDeleted = true;
//   for (let i = 0; i < 100; i++) {
//     const key = `testkey_${i}`;
//     const [val, err] = await redisSvc.get(key);
//     if (err || val !== null) {
//       allDeleted = false;
//       console.error(`Key not deleted or error for ${key}: got=${val}, err=${err}`);
//     }
//   }
//   if (allDeleted) {
//     console.log("All keys deleted successfully!");
//   }

//   // Disconnect
//   await redisSvc.disconnect();
// }

// runRedisTest().catch(console.error);
// console.log("Testing get method with VIN keys on different nodes...");
  
// const testKeys = [
//   "vininfo.MA1AN2ZA7RJF75127",
//   "vininfo.MA1AG2ZA7R5L95301",
//   "caninfo.MA1CA2ZA7RJD46379",
//   "caninfo.MA1AG2ZA7R5D78900",
//   "gpsinfo.MA1CA2ZA7PJE47303",
//   "gpsinfo.MA1AA2ZA7PJH22895",
//   "gpsinfo.MA1CA2ZA7RJD46379",
//   "gpsinfo.MA1AG2ZA7R5D78900",
//   "caninfo.MA1CA2ZA7PJE47303",
//   "caninfo.MA1AA2ZA7PJH22895",
//   "gpsinfo.MA1AN2ZA7RJF75127",
//   "gpsinfo.MA1AG2ZA7R5L95301",
//   "caninfo.MA1AN2ZA7RJF75127", 
//   "caninfo.MA1AG2ZA7R5L95301",
// ];

// for (const key of testKeys) {
//   console.log(`\nTesting key: ${key}`);
//   const [val, err] = await redisSvc.get(key);
  
//   if (err) {
//     console.error(`Error getting ${key}:`, err);
//   } else if (val === null) {
//     console.log(`Key ${key} not found (null)`);
//   } else {
//     console.log(`Key ${key} found:`, val);
//   }
// }
const testKeys = [
    "vininfo.MA1AN2ZA7RJF75127",
    "vininfo.MA1AG2ZA7R5L95301",
    "caninfo.MA1CA2ZA7RJD46379",
    "caninfo.MA1AG2ZA7R5D78900",
    "gpsinfo.MA1CA2ZA7PJE47303",
    "gpsinfo.MA1AA2ZA7PJH22895",
    "gpsinfo.MA1CA2ZA7RJD46379",
    "gpsinfo.MA1AG2ZA7R5D78900",
    "caninfo.MA1CA2ZA7PJE47303",
    "caninfo.MA1AA2ZA7PJH22895",
    "gpsinfo.MA1AN2ZA7RJF75127",
    "gpsinfo.MA1AG2ZA7R5L95301",
    "caninfo.MA1AN2ZA7RJF75127", 
    "caninfo.MA1AG2ZA7R5L95301",
  ];

    for (const key of testKeys) {
      console.log(`\nTesting key: ${key}`);
      const [val, err] = await redisSvc.get(key);
      
      if (err) {
        console.error(`Error getting ${key}:`, err);
      } else if (val === null) {
        console.log(`Key ${key} not found (null)`);
      } else {
        console.log(`Key ${key} found:`, val);
      }
    }

  const [val, err] = await redisSvc.get(testKeys);
  if (err) {
    console.error(`Error getting list of keys:`, err);
  } else {
    console.log(`List of keys:`, val);
  }

// Disconnect
await redisSvc.disconnect();
}

runRedisTest().catch(console.error);