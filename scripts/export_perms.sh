#!/bin/bash

# Default values
DEFAULT_SCHEMA="devfmsscoresch"
DEFAULT_OUTPUT_FILE="./consolemgmt_permissions.csv"
DEFAULT_PREFIX="consolemgmt"

# Check if schema name is provided as argument
if [ $# -eq 0 ]; then
    SCHEMA_NAME=$DEFAULT_SCHEMA
    OUTPUT_FILE=$DEFAULT_OUTPUT_FILE
    PREFIX=$DEFAULT_PREFIX
    echo "No arguments provided, using default schema: $SCHEMA_NAME, prefix: $PREFIX, output: $OUTPUT_FILE"
elif [ $# -eq 1 ]; then
    SCHEMA_NAME=$1
    OUTPUT_FILE=$DEFAULT_OUTPUT_FILE
    PREFIX=$DEFAULT_PREFIX
    echo "Using provided schema: $SCHEMA_NAME, prefix: $PREFIX, output: $OUTPUT_FILE"
elif [ $# -eq 2 ]; then
    SCHEMA_NAME=$1
    PREFIX=$2
    OUTPUT_FILE="${PREFIX}_permissions.csv"
    echo "Using provided schema: $SCHEMA_NAME, prefix: $PREFIX, output: $OUTPUT_FILE"
elif [ $# -eq 3 ]; then
    SCHEMA_NAME=$1
    PREFIX=$2
    OUTPUT_FILE=$3
    echo "Using provided schema: $SCHEMA_NAME, prefix: $PREFIX, output: $OUTPUT_FILE"
else
    echo "Usage: $0 [schema_name] [prefix] [output_file]"
    echo "  schema_name: Optional. Defaults to '$DEFAULT_SCHEMA'"
    echo "  prefix: Optional. Defaults to '$DEFAULT_PREFIX' (filters permid LIKE 'prefix%')"
    echo "  output_file: Optional. Defaults to '{prefix}_permissions.csv'"
    echo "Examples:"
    echo "  $0                                    # Uses defaults (consolemgmt)"
    echo "  $0 fmsauthsch                         # Custom schema"
    echo "  $0 fmsauthsch consolemgmt             # Custom schema and prefix"
    echo "  $0 fmsauthsch consolemgmt my_perms.csv # Custom schema, prefix, and output file"
    exit 1
fi

echo "Exporting permissions from schema: $SCHEMA_NAME with prefix: $PREFIX to file: $OUTPUT_FILE"

# Method 1: Using COPY command (most efficient)
echo "Method 1: Using COPY command..."
PGPASSWORD=Classic@73093 psql -p 5432 -U postgres -h localhost lmmintellicar -c "\copy (SELECT permid FROM $SCHEMA_NAME.perm WHERE permid LIKE '$PREFIX%' ORDER BY permid) TO '$OUTPUT_FILE';"

if [ $? -eq 0 ]; then
    echo "Successfully exported to $OUTPUT_FILE"
    echo "File contents:"
    head -10 "$OUTPUT_FILE"
    echo "..."
    wc -l "$OUTPUT_FILE"
else
    echo "COPY method failed, trying alternative method..."
    
    # Method 2: Using psql output redirection
    echo "Method 2: Using psql output redirection..."
    PGPASSWORD=Classic@73093 psql -p 5432 -U postgres -h localhost lmmintellicar -c "SELECT permid FROM $SCHEMA_NAME.perm WHERE permid LIKE '$PREFIX%' ORDER BY permid;" -A -t > "$OUTPUT_FILE"
    
    if [ $? -eq 0 ]; then
        echo "Successfully exported to $OUTPUT_FILE"
        echo "File contents:"
        head -10 "$OUTPUT_FILE"
        echo "..."
        wc -l "$OUTPUT_FILE"
    else
        echo "Both methods failed. Please check your database connection and permissions."
        exit 1
    fi
fi

echo "Export completed!" 