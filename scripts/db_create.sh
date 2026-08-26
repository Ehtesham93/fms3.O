#!/bin/bash -x
## 127.0.0.1 5432 inventory inventoryuser inventoryuserpwd@123 inventory inventoryschema inventoryuser inventoryuserpwd@123
## 1 2 ....
PGPASSWORD=$9 PGOPTIONS="--search_path=$7,public" psql -p$2 -U$8 -h $1 $6 <db_create.psql
# PGPASSWORD=$9 PGOPTIONS="--search_path=$7,public" psql --echo-all -U$8 -h $1 $6 < db_create.psql
