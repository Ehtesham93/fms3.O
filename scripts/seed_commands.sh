#!/bin/bash

# Method 1: Using search_path in PGOPTIONS (your current approach)
echo "Method 1: Using PGOPTIONS with search_path"
PGPASSWORD=Z52DWfsAZIBtnOK PGOPTIONS="--search_path=devfmsauthsch,public" psql -p 22011 -U lmmintellicar_admin -h mahindra-tunnel.intellicar.io lmmintellicar

# Method 2: Using -c to set search_path after connection
echo "Method 2: Using -c to set search_path"
PGPASSWORD=Z52DWfsAZIBtnOK psql -p 22011 -U lmmintellicar_admin -h mahindra-tunnel.intellicar.io lmmintellicar -c "SET search_path TO devfmsauthsch, public;"

# Method 3: Connect and then set schema interactively
echo "Method 3: Interactive connection with schema setting"
PGPASSWORD=Z52DWfsAZIBtnOK psql -p 22011 -U lmmintellicar_admin -h mahindra-tunnel.intellicar.io lmmintellicar << EOF
SET search_path TO devfmsauthsch, public;
\dt
EOF 


PGPASSWORD=Z52DWfsAZIBtnOK PGOPTIONS="--search_path=devfmsauthsch" psql -p 22011 -U lmmintellicar_admin -h mahindra-tunnel.intellicar.io lmmintellicar -f scripts/drop_all_tables_devfmsauthsch.sql


PGPASSWORD=Z52DWfsAZIBtnOK PGOPTIONS="--search_path=devfmsauthsch" psql -p 22011 -U lmmintellicar_admin -h mahindra-tunnel.intellicar.io lmmintellicar < db_create.psql