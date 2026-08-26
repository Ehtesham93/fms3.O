import ClickHouseClient from "../utils/clickhouse.js";

let clickhouse;

async function checkConnection() {
  try {
    const status = await clickhouse.checkConnection();
    if (status.isConnected) {
      console.log("✅ Successfully connected to ClickHouse");
    } else {
      console.log("❌ Failed to connect to ClickHouse:", status.error);
    }
  } catch (error) {
    console.error("Error checking connection:", error);
  }
}

async function executeSimpleQuery() {
  try {
    const result = await clickhouse.query("SELECT * FROM gpsdata_675 LIMIT 5");
    if (result.success) {
      console.log("Query results:", result.data);
    } else {
      console.log("Query failed:", result.error);
    }
  } catch (error) {
    console.error("Error executing query:", error);
  }
}

async function executeQueryWithCallback() {
  console.log("\n--- Testing queryWithCallback ---");

  try {
    const result = await clickhouse.queryWithCallback(
      "SELECT * FROM gpsdata_675 LIMIT 3",
      (error, data, message) => {
        if (error) {
          console.log("❌ Callback - Query failed:", error.message);
        } else {
          console.log("✅ Callback - Query successful:", message);
          console.log(
            "📊 Callback - Data received:",
            data ? data.length : 0,
            "rows"
          );
          if (data && data.length > 0) {
            console.log(
              "📝 Callback - First row sample:",
              JSON.stringify(data[0], null, 2)
            );
          }
        }
      }
    );

    // Also check the returned result
    if (result.success) {
      console.log("✅ Return value - Query successful");
      console.log(
        "📊 Return value - Data:",
        result.data ? result.data.length : 0,
        "rows"
      );
    } else {
      console.log("❌ Return value - Query failed:", result.error);
    }
  } catch (error) {
    console.error("Error executing queryWithCallback:", error);
  }
}

async function cleanup() {
  try {
    const result = await clickhouse.close();
    if (result.success) {
      console.log("Connection closed successfully");
    } else {
      console.log("Failed to close connection:", result.error);
    }
  } catch (error) {
    console.error("Error during cleanup:", error);
  }
}

async function runExamples() {
  clickhouse = new ClickHouseClient();
  // await clickhouse.init();

  await checkConnection();
  // await executeSimpleQuery();
  await executeQueryWithCallback();
  await cleanup();
}

runExamples();
