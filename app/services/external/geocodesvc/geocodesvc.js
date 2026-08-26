import GeocodeSvcClient from "./geocodesvc_client.js";

export default class GeocodeSvc {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.geocodeSvcClient = new GeocodeSvcClient(config, logger);
  }

  GetReverseGeocode(latitude, longitude, locale, apikey) {
    return this.geocodeSvcClient.getReverseGeocode(
      latitude,
      longitude,
      locale,
      apikey
    );
  }
}
