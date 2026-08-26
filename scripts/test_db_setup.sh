#!/bin/bash -x

# Test database setup script for "seedfmscoresch" schema
# This script will create a new schema called "seedfmscoresch" and seed it with data

# Change to project root directory
cd "$(dirname "$0")/.."



# Set environment variables
export APP_ENV="LOCAL"
export SEED_DB="true"
export TARGETSCHEMA="devfmscoresch"

# Database credentials from dev_config.js
#PGHOST="rds-nemo-stage.c55qjjjzouym.ap-south-1.rds.amazonaws.com"
#PGPORT="5432"
PGHOST="localhost"
PGPORT="5432"
PGDB="lmmintellicar"
PGUSER="postgres"
PGPASSWORD="Classic@73093"

# Target database and schema for seedfmscoresch
TARGETDB="lmmintellicar"
TARGETUSERNAME="postgres"
TARGETPASSWORD="Classic@73093"

echo "=== Starting Test Database Setup ==="
echo "Host: $PGHOST"
echo "Database: $TARGETDB"
echo "Schema: $TARGETSCHEMA"
echo "User: $TARGETUSERNAME"
echo "Current directory: $(pwd)"
echo "================================"

# Step 1: Initialize database, schema, and user
echo "Step 1: Initializing database, schema, and user..."
node ./db_init.js $PGHOST $PGPORT $PGDB $PGUSER $PGPASSWORD $TARGETDB $TARGETSCHEMA $TARGETUSERNAME $TARGETPASSWORD

if [ $? -ne 0 ]; then
    echo "ERROR: Database initialization failed!"
    exit 1
fi

echo "Step 1 completed successfully!"

# Step 2: Create tables in the seedfmscoresch schema
echo "Step 2: Creating tables in seedfmscoresch schema..."
PGPASSWORD=$TARGETPASSWORD PGOPTIONS="--search_path=$TARGETSCHEMA,public" psql -p$PGPORT -U$TARGETUSERNAME -h $PGHOST $TARGETDB < /db_create.psql

if [ $? -ne 0 ]; then
    echo "ERROR: Table creation failed!"
    exit 1
fi

echo "Step 2 completed successfully!"

# Step 3: Seed the database with test data
echo "Step 3: Seeding database with data..."
node ./db_seed.js

if [ $? -ne 0 ]; then
    echo "ERROR: Database seeding failed!"
    exit 1
fi

echo "Step 3 completed successfully!"

echo "=== Test Database Setup Completed Successfully! ==="
echo "Schema: $TARGETSCHEMA"
echo "You can now test your application with this schema."
echo "================================================"