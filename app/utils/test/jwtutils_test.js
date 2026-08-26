import JWTUtils from "../jwtutils.js";
import { CreateED25519KeyPair, keyToHex } from "../eccutils.js";

let keypair = CreateED25519KeyPair();
keypair.privateKey = keyToHex(keypair.privateKey);
keypair.publicKey = keyToHex(keypair.publicKey);

console.log("CreateED25519KeyPair", keypair);

let jwtUtils = new JWTUtils();

let payload = {
  userid: "38",
  email: "smiddela@intellicar.in",
  mobile: "-",
  name: "smiddela",
  updatedat: 1709673768483,
  ssoid: "114448683267346822087",
};

let token = await jwtUtils.GenerateJWT(payload, keypair.privateKey, "12d");
console.log("generated token:", token);

let decodedtoken = await jwtUtils.ValidateJWT(token, keypair.publicKey);
if (decodedtoken == null) {
  console.error("TEST FAILED: ValidateJWT");
  process.exit();
}
console.log("decoded token:", decodedtoken);
console.log("JWT ENCODE/DECODE SUCCESSFULL");
