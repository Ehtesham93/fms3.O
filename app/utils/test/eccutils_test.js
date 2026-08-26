import { CreateED25519KeyPair } from "../eccutils.js";
import crypto from "node:crypto";

let ed25519keypair = CreateED25519KeyPair();
console.log(ed25519keypair.privateKey.toString("base64"));
console.log(
  ed25519keypair.publicKey
    .export({ format: "der", type: "spki" })
    .toString("hex")
);
console.log(
  ed25519keypair.privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("hex")
);

const keypair = crypto.generateKeyPairSync(
  "ed25519",
  crypto.ED25519KeyPairOptions
);

console.log(keypair.publicKey.export({ format: "pem", type: "spki" }));
console.log(
  keypair.publicKey.export({ format: "der", type: "spki" }).toString("hex")
);
console.log(keypair.publicKey.export({ format: "jwk", type: "spki" }));

console.log(keypair.privateKey.export({ format: "pem", type: "pkcs8" }));
console.log(
  keypair.privateKey.export({ format: "der", type: "pkcs8" }).toString("hex")
);
console.log(keypair.privateKey.export({ format: "jwk", type: "pkcs8" }));
