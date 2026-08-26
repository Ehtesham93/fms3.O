/**
 * Gets the environment prefix for Redis topics
 * @returns {string} - Environment prefix ("dev", "stg", or "local")
 */
const getEnvironmentPrefix = () => {
  if (process.env.APP_ENV === "PRODUCTION") {
    return "";
  } else if (process.env.APP_ENV === "STAGING") {
    return "stg.";
  } else if (process.env.APP_ENV === "DEVELOPMENT") {
    return "dev.";
  } else {
    return "local.";
  }
};

/**
 * Publishes an account update notification to Redis
 * @param {string} accountid - The account ID
 * @param {object} message - The message to publish
 * @param {object} redisSvc - Redis service instance
 * @param {object} logger - Logger instance
 * @returns {Promise<boolean>} - Success status
 */
export const publishAccountUpdate = async (
  accountid,
  message,
  redisSvc,
  logger
) => {
  try {
    // Create the data to store and publish
    const redismessage = JSON.stringify(message);

    const envPrefix = getEnvironmentPrefix();
    const key = `${envPrefix}updates.account.${accountid}.vehicle`;

    // Set the key with the data (persistent state)
    const [setResult, setError] = await redisSvc.set(key, redismessage);
    if (setError) {
      logger.error(`Failed to set key ${key}:`, setError);
    } else {
      logger.info(`Account update data set for key: ${key}`);
    }

    // Publish to the same key as topic (real-time notification)
    const [publishResult, publishError] = await redisSvc.publish(key, redismessage);
    if (publishError) {
      logger.error(`Failed to publish to topic ${key}:`, publishError);
    } else {
      logger.info(
        `Account update event published to topic: ${key} (${publishResult} subscribers)`
      );
    }

    return !setError && !publishError;
  } catch (error) {
    logger.error("Error in publishAccountUpdate:", error);
    return false;
  }
};

/**
 * Publishes a vehicle update notification specifically
 * @param {string} accountid - The account ID
 * @param {object} message - The message to publish
 * @param {object} redisSvc - Redis service instance
 * @param {object} logger - Logger instance
 * @returns {Promise<boolean>} - Success status
 */
export const publishVehicleUpdate = async (
  accountid,
  message,
  redisSvc,
  logger
) => {
  return await publishAccountUpdate(
    accountid,
    message,
    redisSvc,
    logger
  );
};


/**
 * Publishes a vehicle modification update notification to Redis
 * @param {string} vinno - The vehicle VIN number
 * @param {string} action - The action performed ("added", "updated", "removed")
 * @param {object} redisSvc - Redis service instance
 * @param {object} logger - Logger instance
 * @returns {Promise<boolean>} - Success status
 */
export const  publishVehicleModificationUpdate = async (
  vinno,
  action,
  message,
  redisSvc,
  logger
) => {
  try {
    // Create the data to store and publish
    const updateData = {
      timestamp: new Date().toISOString(),
      message: message,
      action: action,
    };

    const envPrefix = getEnvironmentPrefix();
    const key = `${envPrefix}vehicle.${vinno}.${action}`;
    const redismessage = JSON.stringify(updateData);

    // Set the key with the data (persistent state)
    const [setResult, setError] = await redisSvc.set(key, redismessage);
    if (setError) {
      logger.error(`Failed to set key ${key}:`, setError);
    } else {
      logger.info(`Vehicle modification update data set for key: ${key}`);
    }

    // Publish to the same key as topic (real-time notification)
    const [publishResult, publishError] = await redisSvc.publish(key, redismessage);
    if (publishError) {
      logger.error(`Failed to publish to topic ${key}:`, publishError);
    } else {
      logger.info(
        `Vehicle modification update event published to topic: ${key} (${publishResult} subscribers)`
      );
    }

    return !setError && !publishError;
  } catch (error) {
    logger.error("Error in publishVehicleModificationUpdate:", error);
    return false;
  }
};

/**
 * Publishes a vehicle update notification specifically
 * @param {string} vinno - The vehicle VIN number
 * @param {string} action - The action performed ("added", "updated", "removed")
 * @param {object} redisSvc - Redis service instance
 * @param {object} logger - Logger instance
 * @returns {Promise<boolean>} - Success status
 */
export const publishVehicleCreationUpdate = async (
  vinno,
  action,
  redisSvc,
  logger
) => {
  return await publishVehicleModificationUpdate(
    vinno,
    action,
    redisSvc,
    logger
  );
};