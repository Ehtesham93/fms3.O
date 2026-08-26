export const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const NEGATIVE_CREDIT_THRESHOLD = 0;
export const ACCOUNT_CREATION_CREDITS = 100000;

// admin uuid
export const ADMIN_ROLE_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const VIEW_ROLE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
export const ADMIN_USER_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const PLATFORM_ACCOUNT_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const PLATFORM_ROOT_FLEET_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";
export const PLATFORM_ROOT_FLEET_PARENT_ID =
  "00000000-0000-0000-0000-000000000000";

// account types
export const PLATFORM_ACCOUNT_TYPE = "platform";
export const CUSTOMER_ACCOUNT_TYPE = "customer";
export const ROOT_FLEET_NAME = "Home";

// sso types
export const EMAIL_PWD_SSO = "EMAIL_PWD";
export const MAHINDRA_SSO = "MAHINDRA_SSO";
export const MOBILE_SSO = "MOBILE";

// fleet invite types
export const FLEET_INVITE_STATUS = {
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
};

export const FLEET_INVITE_TYPE = {
  EMAIL: "email",
  MOBILE: "mobile",
};

export const ACCOUNT_VEHICLE_SUBSCRIPTION_STATE = {
  PENDING: 0,
  ENABLED: 1,
  STAGED_FOR_DISABLE: 2,
  DISABLED: 3,
};

export const VEHICLE_ACTION = {
  ADDED: "ADDED",
  UPDATED: "UPDATED",
  TAGGED: "TAGGED",
  UNTAGGED: "UNTAGGED",
  REMOVED: "REMOVED",
};

export const PLATFORM_ROLE_TYPE = "platform";
export const ACCOUNT_ROLE_TYPE = "account";
export const CUSTOMER_TYPE_INDIVIDUAL = "individual";
export const CUSTOMER_TYPE_CORPORATE = "corporate";

// token related constants
export const COOKIE_MAX_AGE = 31 * 24 * 60 * 60 * 1000;
export const TOKEN_EXPIRY_TIME = 8 * 60 * 60;
export const REFRESH_TOKEN_EXPIRY_TIME = 30 * 24 * 60 * 60;
export const PASSWORD_EXPIRE_TIME = 90; // in days

export const INVITE_RATE_LIMIT_PER_HOUR = 3;

export const PARAM_FAMILY_CODE_REGULAR_DATA = "regulardata";

export const DEFAULT_PACKAGE_INFO = {
  graceperiod: 30,
  creditfactor: 1,
  vehiclecount: 10,
};

export const FLEET_INVITE_EXPIRY_TIME = 7 * 24 * 60 * 60 * 1000;
export const BATTERY_THRESOLD = 25;

export const CONSOLE_MODULE_CODE = "consolemgmt";
export const ADMIN_PERMISSION = "all.all.all";
export const VIEW_PERMISSION = "all.all.view";

export const GEOCODE_DEFAULT_LOCALE = "en";
export const GEOCODE_ALLOWED_LOCALES = [
  "en",
  "hi",
  "mr",
  "ta",
  "te",
  "ur",
  "pa",
  "kn",
  "ml",
  "or",
  "as",
  "bh",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "fi",
  "fr",
  "ga",
  "gl",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "nb",
  "nl",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "sl",
  "sv",
  "tr",
  "uk",
  "vi",
  "zh",
];
export const GEOCODE_REGION_CODE = "IN";
export const GEOCODE_CACHE_TTL = 10 * 60; // 10 minutes
export const GEOCODE_API_KEY_NAME = "GOOGLE_MAPS_API_KEY_1";

export const GOOGLE_MAPS_ORDERED_RESULT_TYPES = [
  "street_address", // used for addresses like "123 Main St"
  "premise", // used for addresses like "123 Main St"
  "route", // used for addresses like "Main St"
  "neighborhood", // used for addresses like "Brooklyn"
  "locality", // used for addresses like "New York"
  "sublocality", // used for addresses like "New York, NY"
  "administrative_area_level_1", // used for addresses like "NY"
  "administrative_area_level_2", // used for addresses like "NY"
  "administrative_area_level_3", // used for addresses like "NY"
  "administrative_area_level_4", // used for addresses like "NY"
  "administrative_area_level_5", // used for addresses like "NY"
  "postal_code", // used for addresses like "10001"
  "country", // used for addresses like "USA"
  "plus_code", // used for addresses like "10001+1000"
];

export const ORANGE_COLOR = "FF9F0A";
export const BLUE_COLOR = "0A84FF";
export const GREEN_COLOR = "30D158";

export const DRIVING_MODES = {
  // 'treo':[{mode:'eco', color:GREEN_COLOR},{mode:'boost', color:ORANGE_COLOR},{mode:'eccopluse', color:BLUE_COLOR}],
  'treo':[{mode:'eco', color:GREEN_COLOR},{mode:'boost', color:ORANGE_COLOR}],
  'a301':[{mode:'range', color:GREEN_COLOR},{mode:'race', color:ORANGE_COLOR},{mode:'ride', color:BLUE_COLOR}],
  'zeo':[{mode:'eco', color:GREEN_COLOR},{mode:'boost', color:ORANGE_COLOR}],
};

export const DRIVING_MODE_TYPE = {
  ECO: 'eco',
  BOOST: 'boost',
  RANGE: 'range',
  RACE: 'race',
  RIDE: 'ride',
};