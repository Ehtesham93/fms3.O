import {
  GEOCODE_DEFAULT_LOCALE,
  GEOCODE_API_KEY_NAME,
  GEOCODE_CACHE_TTL,
  GOOGLE_MAPS_ORDERED_RESULT_TYPES,
} from "../../../utils/constant.js";

export default class LivetrackinghdlrImpl {
  constructor(
    livetrackingsvcI,
    geocodeSvcI,
    redisSvcI,
    platformSvcI,
    logger,
    config
  ) {
    this.livetrackingsvcI = livetrackingsvcI;
    this.geocodeSvcI = geocodeSvcI;
    this.redisSvcI = redisSvcI;
    this.platformSvcI = platformSvcI;
    this.logger = logger;
    this.config = config;
  }

  GetVehiclesLogic = async (accountid, fleetid, recursive) => {
    let result = await this.livetrackingsvcI.getVehicles(
      accountid,
      fleetid,
      recursive
    );
    if (!result) {
      this.logger.error("Failed to get vehicles");
      throw new Error("Failed to get vehicles");
    }
    return result;
  };

  GetVehicleInfoLogic = async (accountid, vinno) => {
    const vehicleExists = await this.livetrackingsvcI.checkVehicleExists(
      accountid,
      vinno
    );
    if (!vehicleExists) {
      throw new Error("VEHICLE_DOES_NOT_EXIST_IN_ACCOUNT");
    }

    let result = await this.livetrackingsvcI.getVehicleInfo(accountid, vinno);
    if (!result) {
      this.logger.error("Failed to get vehicle info");
      throw new Error("Failed to get vehicle info");
    }
    if (result.delivered_date) {
      const deliveredDate = new Date(result.delivered_date);
      const now = new Date();
      const diffMs = now - deliveredDate;

      const totalSeconds = Math.floor(Math.abs(diffMs) / 1000);
      const days = Math.floor(totalSeconds / (24 * 60 * 60));
      const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
      const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
      const seconds = totalSeconds % 60;
      result.vehicleage = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    } else {
      result.vehicleage = null;
    }
    return result;
  };

  GetReverseGeocodeLogic = async (
    latFloat,
    lngFloat,
    locale = GEOCODE_DEFAULT_LOCALE
  ) => {
    let defaultResponse = {
      latitude: latFloat,
      longitude: lngFloat,
      locale: locale,
      formatted_address: `${latFloat},${lngFloat}`,
    };
    // trim latitude and longitude to 6 decimal places
    let latTrimmed = latFloat.toFixed(6);
    let lngTrimmed = lngFloat.toFixed(6);

    // get it from cache
    let cachedData = await this._getReverseGeocodeFromCache(
      latTrimmed,
      lngTrimmed,
      locale
    );
    if (cachedData && cachedData.formatted_address) {
      return {
        ...defaultResponse,
        formatted_address: cachedData.formatted_address,
      };
    }

    // get from google maps api
    let result = await this._getReverseGeocodeFromGoogleMapsAPI(
      latTrimmed,
      lngTrimmed,
      locale
    );
    let bestAddress = this._getBestAddressFromGoogleMapsAPIResult(
      result?.results
    );
    if (!bestAddress) {
      this.logger.error(
        "Failed to get reverse geocode from google maps api, result: ",
        {
          latitude: latTrimmed,
          longitude: lngTrimmed,
          locale: locale,
          result: JSON.stringify(result),
        }
      );
      return defaultResponse;
    }

    // cache the data
    let dataToCache = {
      formatted_address: result.results[0].formatted_address,
    };
    await this.redisSvcI.set(
      this._getCacheKeyForReverseGeocode(latTrimmed, lngTrimmed, locale),
      JSON.stringify(dataToCache),
      GEOCODE_CACHE_TTL
    );

    return {
      ...defaultResponse,
      formatted_address: result.results[0].formatted_address,
    };
  };

  _getCacheKeyForReverseGeocode = (latTrimmed, lngTrimmed, locale) => {
    return `REVERSE_GEOCODE:${latTrimmed}:${lngTrimmed}:${locale}`;
  };

  _getReverseGeocodeFromCache = async (latTrimmed, lngTrimmed, locale) => {
    let cacheKey = this._getCacheKeyForReverseGeocode(
      latTrimmed,
      lngTrimmed,
      locale
    );
    let [cachedData, redisError] = await this.redisSvcI.get(cacheKey);
    if (redisError) {
      this.logger.error("Redis error:", redisError);
      return null;
    }
    if (cachedData) {
      try {
        cachedData = JSON.parse(cachedData);
        return cachedData;
      } catch (error) {
        this.logger.error(
          "Failed to parse cached data for key: " + cacheKey,
          error
        );
      }
    }
    return null;
  };

  _getReverseGeocodeFromGoogleMapsAPI = async (lat, lng, locale) => {
    // TODO: add cache for api key
    let apiKey = await this.platformSvcI.GetAPIKey(
      this.config.geocodesvc.apikeyPlatform,
      this.config.geocodesvc.apikeyEnvironment
    );
    if (!apiKey || !apiKey[GEOCODE_API_KEY_NAME]) {
      this.logger.error("Failed to get API key from db");
      return null;
    }

    let result = await this.geocodeSvcI.GetReverseGeocode(
      lat,
      lng,
      locale,
      apiKey[GEOCODE_API_KEY_NAME]
    );
    if (!result) {
      this.logger.error("Failed to get geocode from google maps api");
      return null;
    }

    return result;
  };

  _getBestAddressFromGoogleMapsAPIResult = (results) => {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return null;
    }
    for (const type of GOOGLE_MAPS_ORDERED_RESULT_TYPES) {
      for (const result of results) {
        if (Array.isArray(result.types) && result.types.includes(type)) {
          return result.formatted_address;
        }
      }
    }
    return results[0].formatted_address;
  };
}
