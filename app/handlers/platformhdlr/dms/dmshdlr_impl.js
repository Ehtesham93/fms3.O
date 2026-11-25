import axios from "axios";
import moment from 'moment';
import https from 'https';
import path from 'path';
import { v4 as uuidv4 } from "uuid";
import util from 'util';
const sleepFn = util.promisify(setTimeout);
import config from "../../../config/config.js";
import {
  ACCOUNT_ROLE_TYPE,
  CUSTOMER_TYPE_CORPORATE,
  CUSTOMER_TYPE_INDIVIDUAL,
  PLATFORM_ROLE_TYPE,
  ENTITY_TYPE_INDIVIDUAL,
  ENTITY_TYPE_INDETERMINATE,
  ENTITY_TYPE_BUSINESS,
  VIEW_ROLE_ID
} from "../../../utils/constant.js";
import { EncryptPassword } from "../../../utils/eccutil.js";
import { preprocessingText, isEmailLegit } from "../../../utils/commonutil.js";
import crypto from "crypto";
import { classifyEntityType, compareBusinessNames, preprocessingname, compareHumanNames } from "../../../utils/heuristicutil.js";

export default class DmsHdlrImpl {
  constructor(
    dmsSvcI,
    platformSvcI,
    redisSvc,
    pUserHdlr,
    accountHdlr,
    vehicleHdlr,
    logger
  ) {
    this.dmsSvcI = dmsSvcI;
    this.platformSvcI = platformSvcI;
    this.redisSvc = redisSvc;
    this.pUserHdlr = pUserHdlr;
    this.accountHdlr = accountHdlr;
    this.vehicleHdlr = vehicleHdlr;
    this.logger = logger;
    this.dmsRedisKey = `dms.accesstoken`;
  }

  getCustomerGender = function(data){
    if(!data || !data.gender)
        return "Others";

    let normalizedGender = null;
    let incomingGender = data.gender.toLowerCase()

    if(incomingGender == "male" || incomingGender == "m")
        normalizedGender = "Male";
    else if(incomingGender == "female" || incomingGender == "f")
        normalizedGender = "Female";
    else
        normalizedGender = "Others";
    
    return normalizedGender;
  }

  getCustomerCompleteAddress = function(data){
    let doorAndStreetAddress = ''
    if(data.door)
        doorAndStreetAddress += data.door 
    if(data.streetName){
        if (doorAndStreetAddress) 
            doorAndStreetAddress += ', ';
        doorAndStreetAddress += data.streetName   
    }
    if(doorAndStreetAddress)
        data.address1 = doorAndStreetAddress + ', ' + data.address1
    
    return (data.address2 ?  data.address1 + ', ' + data.address2 : data.address1) + ', ' + data.district + ', ' + data.state
  }

  formatDateFromDMS = function (inputDate){
      if(!inputDate)
          return null;
      if(inputDate.indexOf('/') != -1)
          inputDate =  inputDate.split("/").reverse().join("-");
      return inputDate;
  }
  
  getSecondsUntil(dmsTimeString){
      const [datePart, timePart] = dmsTimeString.split(' ');
      const [day, month, year] = datePart.split('/');
      const [hours, minutes, seconds] = timePart.split(':');
      const isoString = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+05:30`; // IST offset
      const targetDate = new Date(isoString);
      const now = new Date();
      // Subtracting dates gives milliseconds; divide by 1000 to get seconds
      return Math.floor((targetDate - now) / 1000);
  }

  GetDmsAuthToken = async() => {
      let [getResult, getError] = await this.redisSvc.get(this.dmsRedisKey);
      if(!getResult){
          let authResponse;
          try {
            this.logger.info("Retrieving new Auth Token from DMS Auth URL");
            let authOptions = await this.GetAuthOptions();
            authResponse = await axios(authOptions);
            if (authResponse.status == 200 && authResponse.data && authResponse.data.isSuccessFul == '1') {
                this.logger.info("Obtained new Auth Token from DMS ");
                    let redisValue = {
                  ...authResponse.data
                };
                let expiresin = this.getSecondsUntil(authResponse.data.tokenExpiry) - 10; 
                let [setResult, setError] = await this.redisSvc.set(this.dmsRedisKey, JSON.stringify(redisValue), expiresin);
                if(setError){
                  throw new Error("Failed to set redis");
                }
                return this.GetDmsAuthToken();
            } else {
                this.logger.info("Unable to Obtain new Auth Token from DMS Auth URL, so Sleeping for 2 mins and then retry");
                await sleepFn(2*60*1000); // 2mins
                return this.GetDmsAuthToken();
            }
          } catch (error) {
              this.logger.error(error);
              this.logger.info("Obtained unexpected AXIOS Error in response, so Sleeping for 2 mins and then retry ");
              await sleepFn(2*60*1000); // 2mins
              return this.GetDmsAuthToken();
          }
      }
      if(getResult){
          let redisValue = JSON.parse(getResult);
          return redisValue.authToken;
      }
  } 

  GetAuthOptions = async()=>{
    return {
        method: 'POST',
        url: config.dms.dmsHostName + config.dms.dmsAuthURL,
        headers: {
            'Content-Type': 'application/json'
        },
        data: {
            "userId": config.dms.dmsAuthUsername,
            "password": config.dms.dmsAuthPassword
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false
        })
    };
  }

  GetVehicleDetailsOption = async(vin,authToken) => {
      return {
          method: 'POST',
          url:  config.dms.dmsHostName + config.dms.dmsVehicleDetailsURL,
          headers: {
              'Content-Type': 'application/json',
              'authToken': authToken
          },
          data: {
              "vin": vin
          },
          httpsAgent: new https.Agent({
              rejectUnauthorized: false
          })
      };
  };

  GetVehiclesListOption = async(startDate,endDate,authToken) => {
      return {
          method: 'POST',
          url:  config.dms.dmsHostName + config.dms.dmsVehicleListURL,
          headers: {
              'Content-Type': 'application/json',
              'authToken': authToken
          },
          data: {
            "startDate": startDate,
            "endDate": endDate,
            "fromIndex": "1",
            "toIndex": "10000"
          },
          httpsAgent: new https.Agent({
              rejectUnauthorized: false
          }),
          timeout: 2 * 60 * 1000, // 2 minutes
      };
  };

  ConsumeSoldVehiclesDataFromDms = async (
   userid,
   vinNumbers,
   startDate,
   endDate,
   operationId
  ) => {
    let adhocRunResult = {};
    try {
      let dmsDataArr = [];
      if(vinNumbers && vinNumbers.length){
        for (let i = 0; i < vinNumbers.length; i++) {
          const vinno = vinNumbers[i];
          const soldInfo = await this.GetDmsSoldVehicleDataForVin(vinno);
          dmsDataArr.push(soldInfo);
        }
      }  
      if(startDate && endDate){
          const soldVehiclesArr = await this.GetDmsSoldVehicleDataForRange(startDate,endDate);
          dmsDataArr.push(...soldVehiclesArr);
      }
      // Excluding Non LMM Vehicle models.
      let nonLmmModels = ['atom','e2o','e2oplus','kuv','supro','verito','s210','xuv400']
      dmsDataArr = dmsDataArr.filter((v)=>{
          if(!v || !v.vin)
              v.vin = 'NO_VIN';
          if(v['Message'] === 'No data found'){
            adhocRunResult[v.vin] = 'NO_DMS_DATA_SKIPPED';
            return false;
          }
          if(!v.vehicleModel || !v.vehicleVariant ||  !v.customerName || !v.customerContactMobile){
            adhocRunResult[v.vin] = 'INSUFFICIENT_DMS_DATA_SKIPPED'
            return false;
          }
          const vehicleModel = v.vehicleModel.toLowerCase().replace(/[^a-z0-9]/gi, "").trim();
          let nonLmmSkipped = false;
          for (let i = 0; i < nonLmmModels.length; i++) {
              const nonLmmModel = nonLmmModels[i];
              if(vehicleModel.indexOf(nonLmmModel) != -1){
                nonLmmSkipped = true;
                break;
              }
          }
          if(nonLmmSkipped){
            adhocRunResult[v.vin] = 'NON_LMM_MODEL_SKIPPED'
            return false;
          } else {
            return true;
          }
      });

      for (let i = 0; i < dmsDataArr.length; i++) {
        const dmsVinResp = dmsDataArr[i];
        let dbVehicleInfo;
        let vehicleAccount;
        let customIsUpdateFlag;
        try {
          dbVehicleInfo = await this.vehicleHdlr.vehicleHdlrImpl.GetVehicleInfoLogic(
                                dmsVinResp.vin
                              );
          if(!dbVehicleInfo || (dbVehicleInfo && dbVehicleInfo.length == 0)){
            adhocRunResult[dmsVinResp.vin] = 'VEHICLE_NOT_PRESENT_IN_DB_SKIPPED';
            continue; // Goto next Vehicle
          }

          vehicleAccount = await this.vehicleHdlr.vehicleHdlrImpl.GetVehicleAccountDetailsLogic(
                              dmsVinResp.vin
                            );
          if(vehicleAccount && vehicleAccount.accounts && vehicleAccount.accounts.length){
              let ownerAccount = vehicleAccount.accounts.filter((v)=> v.isowner)
              if(ownerAccount && ownerAccount.length)
                customIsUpdateFlag = true;
              else 
                customIsUpdateFlag = false; // No Owner Account
          } else {
              customIsUpdateFlag = false; // No Owner Account
          }
        } catch (error) {
          if(error.message && error.message.indexOf("not found") != -1)
            adhocRunResult[dmsVinResp.vin] = 'VEHICLE_NOT_PRESENT_IN_DB_SKIPPED';
          else 
            adhocRunResult[dmsVinResp.vin] = 'VEHICLE_ERROR_SKIPPED';

          continue; // Goto next Vehicle
        }

        let kycSchemaObject = {

          userid: userid,
          vinNumber: dmsVinResp.vin,

          kycAgreement: "1",          // Considering Customer has accepted KYC 
          isUpdate: customIsUpdateFlag,
          wyhMobile: dmsVinResp.customerContactMobile,
          registrationNumber: dmsVinResp.licensePlate,

          vehicleModel: dmsVinResp.vehicleModel,
          vehicleVariant: dmsVinResp.vehicleVariant,
          
          vehicleColour: dmsVinResp.vehicleColour,
          engineNo: dmsVinResp.engineNo,
          dealer: dmsVinResp.dealer,
          deliveredDate: dmsVinResp.deliveredDate,
          retailsSaleDate: dmsVinResp.retailsSaleDate,
          vehicleCity: dmsVinResp.vehicleCity,

          name: dmsVinResp.customerName,
          mobileNumber: dmsVinResp.customerContactMobile ,
          email: dmsVinResp.customerContactEmail ,
          adharNumber: null ,
          gender: dmsVinResp.customerGender,

          door: null,
          streetName: null, 
          address1: dmsVinResp.customerAddress,
          address2: null,
          pinCode: dmsVinResp.customerAddressPincode,
          district: dmsVinResp.customerAddressCity,
          state: null,

          customerType: dmsVinResp.customerType ,
          corporateType: dmsVinResp.corporateType ,
          customerDateOfBirth: dmsVinResp.customerDateOfBirth,
          customerAddressCity: dmsVinResp.customerAddressCity,
          customerAddressCountry: dmsVinResp.customerAddressCountry,

        };
        
        let result = await this.ConsumeVehicleKycSchemaData(kycSchemaObject);
        // Individual vehicle based DMS API LOGS with operationId: 99
        kycSchemaObject.operationId = operationId;
        result.resultcode = result.resultcode || result.status;
        result.statuscode = 200;
        await this.dmsSvcI.StoreDmsApiLogs(kycSchemaObject,result,null);
        adhocRunResult[dmsVinResp.vin] = result.resultcode || 'FAILED';
        await sleepFn(1*1000); //1second
      }
      return adhocRunResult;
    } catch (error) {
      this.logger.error("Execution of DMS Adhoc Run stopped with error", error);
      this.logger.error("Execution of DMS Adhoc Run stopped with result ", adhocRunResult);
      error.adhocRunResult = adhocRunResult;
      throw error;
    }
  };

  GetDmsSoldVehicleDataForVin = async (vin) => {
    this.logger.info(`Fetching Vehicle sold Info  for ${vin} from DMS API ...`)
    let response;
    try {
        let authToken = await this.GetDmsAuthToken();
        let vehicleDetailsOption = await this.GetVehicleDetailsOption(vin,authToken);
        response = await axios(vehicleDetailsOption);
        if(response.data['IsSuccessful'] == '0'){
            if(response.data['Message'] && response.data['Message'].indexOf("many") != -1){
                this.logger.info("Obtained many in response 'Message', so Sleeping for 10 mins ");
                await sleepFn(2*60*1000); // 2mins
                return this.GetDmsSoldVehicleDataForVin(vin);
            } 
            else if(!response.data['Message'] && response.data['MessageCode'] == '20'){
                this.logger.info("Received MessageCode without Message in response, so Sleeping for 10 min ");
                await sleepFn(2*60*1000); // 2mins
                return this.GetDmsSoldVehicleDataForVin(vin);
            } 
            else if(response.data['Message'].indexOf("expired") != -1)
            {
                await this.redisSvc.del(this.dmsRedisKey); // DELETE TOKEN FROM CACHE
                return this.GetDmsSoldVehicleDataForVin(vin);
            }
        } else {
          // Data Processing
          if(response.data && response.data['isSuccessful']== '1' && response.data.data && response.data.data.length){
            return response.data.data[0]; // Object is returned
          } 
          else {
            return {  // Object is returned
              vin,
              ...response.data
            };
          }
        }
    } catch (error) {
        this.logger.error(error);
        this.logger.info("Obtained unexpected AXIOS Error in response, so Sleeping for 2 mins and then retry ");
        await sleepFn(2*60*1000); // 2mins
        return this.GetDmsSoldVehicleDataForVin(vin);
    }
  }

  GetDmsSoldVehicleDataForRange = async (startDate,endDate) => {
    this.logger.info(`Fetching all Sold Vehicles from DMS between startDate ${startDate} and endDate ${endDate} `);
    let response;
    try {
        let authToken = await this.GetDmsAuthToken();
        let vehiclesListOption = await this.GetVehiclesListOption(startDate,endDate,authToken);
        response = await axios(vehiclesListOption);
        if(response.data['IsSuccessful'] == '0'){
            if(response.data['Message'] && response.data['Message'].indexOf("many") != -1){
                this.logger.info("Obtained many in response 'Message', so Sleeping for 10 mins ");
                await sleepFn(2*60*1000); // 2mins
                return this.GetDmsSoldVehicleDataForRange(startDate,endDate);
            } 
            else if(!response.data['Message'] && response.data['MessageCode'] == '20'){
                this.logger.info("Received MessageCode without Message in response, so Sleeping for 10 min ");
                await sleepFn(2*60*1000); // 2mins
                return this.GetDmsSoldVehicleDataForRange(startDate,endDate);
            } 
            else if(response.data['Message'].indexOf("expired") != -1)
            {
                await this.redisSvc.del(this.dmsRedisKey); // DELETE TOKEN FROM CACHE
                return this.GetDmsSoldVehicleDataForRange(startDate,endDate);
            }
        } else {
          // Data Processing
          if(response.data['isSuccessful']== '1' && response.data.data && response.data.data.length){
            return response.data.data; // Array is returned
          }
          else {
            return [{ // Array is returned
              vin: "FETCH_BY_RANGE",
              startDate,
              endDate,
              ...response.data
            }]
          }
        }
    } catch (error) {
        this.logger.error(error);
        this.logger.info("Obtained unexpected AXIOS Error in response, so Sleeping for 2 mins and then retry ");
        await sleepFn(2*60*1000); // 2mins
        return this.GetDmsSoldVehicleDataForRange(startDate,endDate);
    }
  }
  

  ConsumeVehicleKycSchemaData = async ( kycSchemaObject ) => {
    try {
      const {
          userid,
          vinNumber,

          kycAgreement,
          isUpdate,
          wyhMobile,
          registrationNumber,

          vehicleModel,
          vehicleVariant,
          
          vehicleColour,
          engineNo,
          dealer,
          deliveredDate,
          retailsSaleDate,
          vehicleCity,

          name,
          mobileNumber,
          email,
          adharNumber,
          gender,

          door,
          streetName, 
          address1,
          address2,
          pinCode,
          district,
          state,

          customerType,
          corporateType,
          customerDateOfBirth,
          customerAddressCity,
          customerAddressCountry,
      } = kycSchemaObject;

      // Vehicle Onboarding Logic
      let vehicleResult;
      if(vehicleModel && vehicleVariant){
        let vehicleOnboardInput =  {
              vin: vinNumber ,

              licensePlate: registrationNumber,
              mobileNo: mobileNumber,
              tgu_imei_no: null,
              fuelType: null,

              vehicleModel: vehicleModel,
              vehicleVariant: vehicleVariant,
              vehicleColour: vehicleColour,
              
              engineNo: engineNo,
              dealer: dealer,
              deliveredDate: this.formatDateFromDMS(deliveredDate),
              retailsSaleDate: this.formatDateFromDMS(retailsSaleDate),
              vehicleCity: vehicleCity,
        };

        vehicleResult = await this.vehicleHdlr.vehicleHdlrImpl.OnboardVehicleLogic(
                                            vehicleOnboardInput,
                                            "onboarding",
                                            userid
                                          );
        if(vehicleResult){
          if(vehicleResult.action == 'already_exists')
            this.logger.info(`VEHICLE Upsert - vinno ${vehicleResult.vinno} - ${vehicleResult.message} along with DMS data`);
          else if(vehicleResult.action == 'upserted')
            this.logger.info(`VEHICLE Upsert - vinno ${vehicleResult.vinno} - ${vehicleResult.message} with DMS data`);
          else if(vehicleResult.action == 'pending_review')
            this.logger.info(`VEHICLE Upsert - vinno ${vehicleResult.vinno} - ${vehicleResult.message} with DMS data`);
          else if(vehicleResult.action == 'reviewed_and_created')
            this.logger.info(`VEHICLE Upsert - vinno ${vehicleResult.vinno} - ${vehicleResult.message} with DMS data`);
          else 
            this.logger.info(`VEHICLE Upsert - vinno ${vehicleResult.vinno} - ${vehicleResult.message} - Unknown action`);
        }
      }

      let dbVehicleInfo = await this.vehicleHdlr.vehicleHdlrImpl.GetVehicleInfoLogic(
                                vinNumber
                              );
      let vehicleAccount = await this.vehicleHdlr.vehicleHdlrImpl.GetVehicleAccountDetailsLogic(
                              vinNumber
                            );

      if(kycAgreement == "0"){ // Irrespective of isUpdate flag value
        // Account Creation will be skipped. Vehicle will remain orphan.
        if(vehicleAccount && vehicleAccount.isassigned){
              let removeResult  = await this.pUserHdlr.pUserHdlrImpl.DeleteKycLogic(
                                                  userid,
                                                  vinNumber,
                                                  dbVehicleInfo.mobile, // 'mobileNumber' is new Mobile number
                                                  "2"
                                                );
              vehicleResult.resultcode = removeResult.resultcode;
              vehicleResult.statuscode = removeResult.statuscode || 206; 
              vehicleResult.errcode = removeResult.errcode || null; 
              vehicleResult.message += (', ' + removeResult.message);
              if(removeResult.resultcode != 'SUCCESS')
                vehicleResult.message += (', ' + `Unable to remove Vehicle's owner Account Info`);                                 
        } else {
          vehicleResult.resultcode = 'SUCCESS';
          vehicleResult.statuscode = 206; 
          vehicleResult.message += (', ' +'Since Customer has not accepted kycAgreement, so Account KYC records are not captured for this VIN');
        }
        return vehicleResult;
      } else if(kycAgreement == "1"){
        // Account Creation will be DONE. Vehicle will be mapped to Account.
        if(isUpdate == false){
            // Proceed with Account User Onboarding Logic for the Vehicle vinno
        } else if(isUpdate == true){
            // Ownership change scenario
          if(vehicleAccount && vehicleAccount.isassigned){ // Vehicle Owner already exists
            let ownerAccount = vehicleAccount.accounts.find((v)=>v.isowner === true);
            const ownerNameInNemo3 = this.pUserHdlr.pUserHdlrImpl.getNameWithoutPostfixedMobile(ownerAccount.accountname);
            const nameMatchResult =  this.pUserHdlr.pUserHdlrImpl.doesDmsCustomerNameMatchesOwnerName(vinNumber, ownerNameInNemo3, name);
            if(nameMatchResult == "SAME"){
                vehicleResult.resultcode = 'SUCCESS';
                vehicleResult.statuscode = 206; 
                vehicleResult.errcode = 'VEHICLE_ALREADY_EXISTS_WITH_SAME_CUSTOMER'; 
                vehicleResult.message += (', ' + `Vehicle is already owned by same Owner name`);
                vehicleResult.message += (', ' + `Skipping Account User Onboarding logic`);
                this.logger.info(`VEHICLE vinno ${vehicleResult.vinno} - ${vehicleResult.message}`);
                // Skiping Account User Onboarding Logic
                return vehicleResult;
            } else if(nameMatchResult == "DIFFERENT") {
                let removeResult  = await this.pUserHdlr.pUserHdlrImpl.DeleteKycLogic(
                                                  userid,
                                                  vinNumber,
                                                  dbVehicleInfo.mobile, // 'mobileNumber' is new Mobile number
                                                  "2"
                                                );
                vehicleResult.resultcode = removeResult.resultcode;
                vehicleResult.statuscode = removeResult.statuscode || 206; 
                vehicleResult.errcode = removeResult.errcode || null; 
                vehicleResult.message += (', ' + removeResult.message);
                if(removeResult.resultcode != 'SUCCESS')
                  vehicleResult.message += (', ' + `Unable to remove Vehicle's owner Account Info`);                                 
                this.logger.info(vehicleResult.message);
                // Proceeding with Account User Onboarding Logic
            }
          }
        }
      }

      // Account User Onboarding Logic
      const customerName = preprocessingname(name);
      const customerAddress = this.getCustomerCompleteAddress({
        door,
        streetName, 
        address1,
        address2,
        pinCode,
        district,
        state
      });
      const customerGender = this.getCustomerGender({
        gender
      });
      const nemo_user_mobile = mobileNumber;
      const nemo3_account_id = null;
      const userrole = null;

      const result = await this.pUserHdlr.pUserHdlrImpl.OnboardUserAccountLogic(
        userid,
        corporateType || null,            // corporatetype,
        customerAddress,
        customerAddressCity || district,  // customeraddresscity
        customerAddressCountry || 'INDIA', 
        pinCode,
        email,
        mobileNumber,
        this.formatDateFromDMS(customerDateOfBirth) || null,      
                                          // customerdateofbirth
        customerGender,
        customerName,
        customerType || null,             // customertype
        registrationNumber,
        vinNumber,
        nemo_user_mobile,
        "onboarding",
        null,                             // taskid
        null,                             // accountname
        nemo3_account_id,
        userrole
      );

      return result;
    } catch (error) {
      throw error;   
    }
  }
}
