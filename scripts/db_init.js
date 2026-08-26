import pg from "pg";
main();
async function main() {
  if (process.argv.length < 11) {
    console.log(
      "Run as node db_init.js <PGHOST> <PGPORT> <PGDB> <PGUSER> <PGPASSWORD> <TARGETDB> <TARGETSCHEMA> <TARGETUSERNAME> <TARGETPASSWORD>"
    );
    console.log(
      "Ex: node db_init.js 127.0.0.1 5432 apiuser apiuser <ROOTPASSWORD> ione ionesch ioneuser <TARGETUSERPASSWORD>"
    );
    process.exit(1);
  }

  // console.log(process.argv.length);

  let pghost = process.argv[2];
  let pgport = process.argv[3];
  let pgdb = process.argv[4];
  let pguser = process.argv[5];
  let pgpassword = process.argv[6];
  let targetdb = process.argv[7];
  let targetschema = process.argv[8];
  let targetusername = process.argv[9];
  let targetpassword = process.argv[10];

  console.log(
    "Connecting to pghost at " +
      pghost +
      ":" +
      pgport +
      " db:" +
      pgdb +
      ", with user:" +
      pguser
  );

  console.log(
    "Going to create db:" +
      targetdb +
      "(" +
      targetschema +
      ")" +
      ", with targetuser:" +
      targetusername +
      "(" +
      targetpassword +
      ")"
  );

  let pgclient = new pg.Client({
    user: pguser,
    host: pghost,
    database: pgdb,
    password: pgpassword,
    port: pgport,
  });

  // 1. First connect to the db create the target database...
  try {
    await pgclient.connect();
    console.log("DB Connected...");
  } catch (error) {
    console.log("Connect failed", error);
    process.exit(1);
  }

  // 2. Create the database...
  try {
    // 2.1 Create database...
    let dblistres = await pgclient.query(
      "SELECT * FROM pg_database WHERE datname = $1",
      [targetdb]
    );
    if (dblistres.rowCount == 0) {
      // Use string interpolation for CREATE DATABASE (no parameterized queries allowed)
      await pgclient.query(`CREATE DATABASE "${targetdb}"`);
    }
    console.log("1. Database created..");

    await pgclient.end();
    pgclient = new pg.Client({
      user: pguser,
      host: pghost,
      database: targetdb,
      password: pgpassword,
      port: pgport,
    });
    await pgclient.connect();

    // 2.2 Create user...
    let userlistres = await pgclient.query(
      "select usename from pg_user where usename = $1",
      [targetusername]
    );

    if (userlistres.rowCount == 0) {
      // Use string interpolation for CREATE USER (no parameterized queries allowed)
      await pgclient.query(`CREATE USER "${targetusername}" WITH PASSWORD '${targetpassword}'`);
    }
    console.log("2. User created..");

    // 3.1 Create schema..
    let nsplistres = await pgclient.query(
      "select * from pg_catalog.pg_namespace where nspname= $1",
      [targetschema]
    );

    //   console.log(nsplistres.rows);
    if (nsplistres.rowCount == 0) {
      // Use string interpolation for CREATE SCHEMA (no parameterized queries allowed)
      await pgclient.query(`CREATE SCHEMA "${targetschema}"`);
    }
    await pgclient.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");

    // 3.2 Grant schema permission to user...
    // Use string interpolation for GRANT (no parameterized queries allowed)
    await pgclient.query(`GRANT ALL ON SCHEMA "${targetschema}" TO "${targetusername}"`);
    await pgclient.query(`GRANT USAGE ON SCHEMA public TO "${targetusername}"`);

    console.log("3. Schema created..");

    // 4. Create all the extensions required at the database level...
    // 4.1 Enable uuid...
    await pgclient.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 5. Relogin with the given user...
    await pgclient.end();
    pgclient = new pg.Client({
      user: targetusername,
      host: pghost,
      database: targetdb,
      password: targetpassword,
      port: pgport,
    });
    await pgclient.connect();

    // 5. Check the given user login...
    let nowres = await pgclient.query("select NOW()");
    if (nowres.rowCount == 0) {
      // Some failure..
      process.exit(1);
    }
  } catch (error) {
    console.log("Create target db/schema/user failed", error);
  }
  // X. Close the pgclient connection...
  await pgclient.end();
  console.log("DB Disconnected...");
  process.exit(0);
}