import axios from "axios";
import {
  GOOGLE_MAPS_ORDERED_RESULT_TYPES,
  GEOCODE_REGION_CODE,
} from "../../../utils/constant.js";

export default class GeocodeSvcClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.orderedResultTypes = GOOGLE_MAPS_ORDERED_RESULT_TYPES.join("|");
  }

  async getReverseGeocode(latitude, longitude, locale, apikey) {
    let url = `${this.config.geocodesvc.url}${this.config.geocodesvc.getReverseGeocodePath}`;
    let params = {
      latlng: `${latitude},${longitude}`,
      result_type: this.orderedResultTypes,
      region: GEOCODE_REGION_CODE,
      language: locale,
      key: apikey,
    };
    try {
      let res = await axios.get(url, { params });
      return res.data;
    } catch (err) {
      this.logger.error(
        `Error getting reverse geocode for latitude ${latitude} and longitude ${longitude}`,
        err
      );
      throw err;
    }
  }
}
